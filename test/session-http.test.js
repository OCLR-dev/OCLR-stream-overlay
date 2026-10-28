import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverlayServer } from '../server/app.js';
import { SessionStore } from '../server/session/store.js';

async function start(t) {
  const store = new SessionStore(); const config = { port: 0 };
  const server = createOverlayServer(config, async () => { throw new Error('REMOTE_MUST_STAY_READ_ONLY'); }, undefined, store);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); config.port = server.address().port;
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return { store, base: `http://127.0.0.1:${config.port}` };
}
const post = (base, payload, headers = {}) => fetch(`${base}/api/session/command`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
const cmd = (s, type, payload = {}) => ({ id: crypto.randomUUID(), version: s.version, type, payload });

async function stream(base) {
  const abort = new AbortController();
  const response = await fetch(`${base}/api/session/events`, { signal: abort.signal });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  return { close() { abort.abort(); }, async next() {
    while (!buffer.includes('\n\n')) { const part = await reader.read(); if (part.done) throw new Error('STREAM_CLOSED'); buffer += decoder.decode(part.value, { stream: true }); }
    const boundary = buffer.indexOf('\n\n'); const message = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
    return JSON.parse(message.split('\n').find(line => line.startsWith('data: ')).slice(6));
  } };
}

test('two independent output subscribers receive the same command and refresh restores the server snapshot', async t => {
  const { base, store } = await start(t);
  const one = await stream(base); const two = await stream(base); t.after(() => { one.close(); two.close(); });
  assert.equal((await one.next()).session.id, (await two.next()).session.id);
  const response = await post(base, cmd(store.state, 'begin-roll')); assert.equal(response.status, 200);
  const [a, b] = await Promise.all([one.next(), two.next()]);
  assert.equal(a.session.scene, 'roll'); assert.deepEqual(a.session, b.session);
  const restored = await (await fetch(`${base}/api/session`)).json(); assert.equal(restored.session.version, a.session.version);
  assert.equal(restored.session.scene, 'roll'); assert.equal(restored.session.undo, undefined); assert.equal(restored.session.commandIds, undefined);
});

test('local writes require exact same Origin and JSON, while OCLR remains GET-only and private state files stay hidden', async t => {
  const { base, store } = await start(t); const c = cmd(store.state, 'bp');
  assert.equal((await post(base, c, { Origin: '' })).status, 403);
  assert.equal((await post(base, c, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await post(base, c, { 'Content-Type': 'text/plain' })).status, 403);
  assert.equal((await fetch(`${base}/api/oclr/tournaments`, { method: 'POST', headers: { Origin: base } })).status, 405);
  assert.equal((await fetch(`${base}/.local/session.json`)).status, 404);
  assert.equal((await fetch(`${base}/server/session/store.js`)).status, 404);
  assert.equal(store.state.version, 0);
  assert.equal((await post(base, c)).status, 200);
});

test('conflicting operator requests are serialized; repeated command ID applies once', async t => {
  const { base, store } = await start(t); const c = cmd(store.state, 'begin-roll');
  const results = await Promise.all([post(base, c), post(base, { ...c, id: crypto.randomUUID(), type: 'bp' })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const applied = store.state.history[0].id;
  const retry = await post(base, { ...c, id: applied }); assert.equal(retry.status, 200);
  assert.equal(store.state.version, 1); assert.equal(store.state.history.length, 1);
});

test('tosu awards and operator series correction are published to all output subscribers', async t => {
  const { base, store } = await start(t);
  const setup = { title: 'Isolated test', stage: 'group', mode: '3v3', source: '4x3', teams: { a: { name: 'Red', roster: [] }, b: { name: 'Blue', roster: [] } }, pool: [{ id: 'nm1', mod: 'NM', label: 'NM1', beatmapId: 100 }] };
  for (const [type, payload] of [ ['setup', setup], ['bp', {}], ['set-action', { action: { kind: 'pick', team: 'a' } }], ['apply-bp', { entryId: 'nm1' }], ['auto', { bp: true, scenes: true, locked: false, profile: 'stable-tourney', left: 'Red room', right: 'Blue room' }] ]) {
    assert.equal((await post(base, cmd(store.state, type, payload))).status, 200);
  }
  const one = await stream(base); const two = await stream(base); t.after(() => { one.close(); two.close(); });
  await one.next(); await two.next();
  const frame = ipcState => ({ beatmap: { id: 100 }, tourney: { ipcState, teams: { left: 'Red room', right: 'Blue room' }, players: [{ side: 'left', osuId: 1 }, { side: 'right', osuId: 2 }], totalScore: { left: 900, right: 800 } } });
  await store.frame(frame(1), 1000); await store.frame(frame(3), 1500); await store.frame(frame(4), 2000); await store.frame(frame(4), 2500);
  const [a, b] = await Promise.all([one.next(), two.next()]);
  assert.deepEqual(a.session.series, { a: 1, b: 0 }); assert.deepEqual(a.session.series, b.session.series);
  assert.equal(a.session.scene, 'map-result');
  assert.equal((await post(base, cmd(store.state, 'set-series', { a: 0, b: 1, reason: 'Operator correction' }))).status, 200);
  const [correctedA, correctedB] = await Promise.all([one.next(), two.next()]);
  assert.deepEqual(correctedA.session.series, { a: 0, b: 1 }); assert.deepEqual(correctedA.session.series, correctedB.session.series);
  await store.frame(frame(4), 3000); await store.frame(frame(4), 3500);
  assert.deepEqual(store.snapshot().session.series, { a: 0, b: 1 });
});
