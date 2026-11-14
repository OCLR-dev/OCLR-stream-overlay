import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShowcaseStore } from '../server/showcase.js';
import { SessionStore } from '../server/session/store.js';
import { createOverlayServer } from '../server/app.js';
import { simulationSession } from '../tools/tosu-simulator/fixture.js';

function setup(t, options) {
  const session = new SessionStore({ state: simulationSession() });
  t.after(() => session.close());
  return { session, showcase: new ShowcaseStore(session, options) };
}
const choose = (showcase, index = 0, useTosu = false) => showcase.command({ poolToken: showcase.snapshot().poolToken, selectedId: showcase.snapshot().pool[index]?.id ?? null, useTosu });

test('Showcase selection persists separately and never changes competition state or its subscribers', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-showcase-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'showcase.json');
  const { session, showcase } = setup(t, { file });
  const original = structuredClone(session.state);
  let matchEvents = 0;
  const stop = session.subscribe(() => matchEvents++);
  await choose(showcase, 0);
  assert.equal(showcase.snapshot().currentMap.id, session.state.pool[0].id);
  await choose(showcase, 1, true);
  assert.deepEqual(session.state, original);
  assert.equal(matchEvents, 1);
  stop();
  const restored = new ShowcaseStore(session, { file });
  await restored.ready;
  assert.equal(restored.snapshot().selectedId, session.state.pool[1].id);
  assert.equal(restored.snapshot().useTosu, true);
  const bytes = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(bytes).sort(), ['poolToken', 'selectedId', 'useTosu']);
});

test('live match progress cannot replace the selected map; replacing or clearing a pool invalidates it', async t => {
  const { session, showcase } = setup(t);
  await choose(showcase);
  const first = showcase.snapshot();
  session.state.scene = 'playing';
  session.state.seriesAdjustment.a = 2;
  session.state.poolMarks = [{ entryId: first.selectedId, status: 'banned', team: 'a' }];
  session.emit();
  assert.equal(showcase.snapshot().selectedId, first.selectedId);
  assert.equal(showcase.snapshot().poolToken, first.poolToken);
  session.state.pool = [session.state.pool[1]];
  assert.equal(showcase.snapshot().currentMap, null);
  await assert.rejects(showcase.command({ poolToken: first.poolToken, selectedId: first.selectedId, useTosu: false }), /图池已更新/);
  await assert.rejects(showcase.command({ poolToken: showcase.snapshot().poolToken, selectedId: 'outside-pool', useTosu: false }), /已加载/);
  session.state.pool = [];
  assert.equal(showcase.snapshot().currentMap, null);
  assert.deepEqual(showcase.snapshot().pool, []);
});

test('optional ordinary-client parameters require matching selection and freshness; never use tourney ranges or change selection', async t => {
  const { session, showcase } = setup(t);
  await choose(showcase, 0, true);
  const selected = showcase.snapshot().currentMap;
  const beatmap = { id: selected.beatmapId, stats: { stars: { total: 0 }, cs: { converted: 0 } }, time: { lastObject: 0 } };
  session.live.tosu = { status: 'live', updatedAt: new Date().toISOString(), data: { beatmap, tourney: null } };
  assert.equal(showcase.snapshot().mapParameters.stats.stars.total, 0);
  assert.equal(showcase.snapshot().sourceStatus, 'matched');
  session.live.tosu.data.tourney = { ipcState: 1, teams: { left: '', right: '' }, players: [{ osuId: 0, name: '' }, { osuId: 0, name: '' }] };
  assert.equal(showcase.snapshot().sourceStatus, 'matched', 'ordinary v2 frames can contain empty tournament placeholders');
  for (const status of ['stale', 'disconnected', 'invalid-data']) {
    session.live.tosu.status = status;
    assert.equal(showcase.snapshot().mapParameters, null);
  }
  session.live.tosu.status = 'live';
  session.live.tosu.updatedAt = new Date(Date.now() - 6000).toISOString();
  assert.equal(showcase.snapshot().mapParameters, null);
  session.live.tosu.updatedAt = new Date().toISOString();
  session.live.tosu.data.tourney = { ipcState: 3, teams: { left: 'A', right: 'B' }, players: [] };
  assert.equal(showcase.snapshot().mapParameters, null);
  session.live.tosu.data.tourney = { players: [{ osuId: 123 }] };
  assert.equal(showcase.snapshot().mapParameters, null);
  session.live.tosu.data.tourney = null;
  session.live.tosu.data.beatmap = { ...beatmap, id: selected.beatmapId + 1 };
  assert.equal(showcase.snapshot().mapParameters, null);
  assert.equal(showcase.snapshot().selectedId, selected.id);
  await choose(showcase, 0, false);
  assert.equal(showcase.snapshot().sourceStatus, 'off');
});

test('unreadable Showcase settings are retained, and rejected writes leave both stores intact', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-showcase-bad-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'showcase.json');
  await writeFile(file, 'broken original');
  const { session, showcase } = setup(t, { file });
  const original = structuredClone(session.state);
  await showcase.ready;
  assert.match(showcase.snapshot().error, /无法读取/);
  await assert.rejects(choose(showcase), /无法读取/);
  assert.equal(await readFile(file, 'utf8'), 'broken original');
  assert.deepEqual(session.state, original);
});

test('standalone output SSE shares selections, reconnects and enforces same-origin bounded writes', async t => {
  const { session } = setup(t);
  const config = { port: 0 };
  const server = createOverlayServer(config, undefined, undefined, session);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.port = server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${config.port}`;
  const abort = new AbortController();
  t.after(() => abort.abort());
  const streams = await Promise.all([0, 1].map(() => fetch(base + '/api/showcase/events', { signal: abort.signal })));
  const readers = streams.map(response => response.body.getReader());
  await Promise.all(readers.map(reader => reader.read()));
  const original = structuredClone(session.state);
  const initial = await fetch(base + '/api/showcase').then(r => r.json());
  const input = { poolToken: initial.poolToken, selectedId: initial.pool[1].id, useTosu: false };
  const post = (body, headers = {}) => fetch(base + '/api/showcase', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...headers }, body });
  assert.equal((await post(JSON.stringify(input), { Origin: 'https://example.org' })).status, 403);
  assert.equal((await post('x'.repeat(8193))).status, 413);
  assert.equal((await post('{')).status, 400);
  assert.equal((await post(JSON.stringify(input))).status, 200);
  for (const reader of readers) {
    const message = new TextDecoder().decode((await reader.read()).value);
    assert.match(message, new RegExp(`"selectedId":"${input.selectedId}"`));
  }
  abort.abort();
  const reconnect = await fetch(base + '/api/showcase').then(r => r.json());
  assert.equal(reconnect.selectedId, input.selectedId);
  assert.equal((await fetch(base + '/api/showcase?token=x')).status, 400);
  assert.equal((await fetch(base + '/api/showcase', { method: 'DELETE' })).status, 405);
  assert.deepEqual(session.state, original);
});
