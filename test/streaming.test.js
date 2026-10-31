import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamingSource, validateStreaming } from '../server/streaming.js';
import { createOverlayServer, readBoundedJson } from '../server/app.js';
import { SessionStore } from '../server/session/store.js';
const token = 'oclr_stream_' + 'x'.repeat(43);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const empty = () => ({ data: { nextFixture: null, stage: null, mappools: [] }, meta: { apiVersion: '1' } });
const fixture = () => ({ ...empty(), data: {
  nextFixture: { id: id(1), label: 'Match', roundName: 'Literal round', roundId: id(2), stageId: id(3), stage: 'knockout',
    status: 'scheduled', result: null, scheduledAt: '2026-11-01T00:00:00Z', pool: null,
    home: { label: 'home', team: { id: id(4), name: 'Red' } }, away: { label: 'away', team: { id: id(5), name: 'Blue' } } },
  stage: { id: id(3), kind: 'knockout', round: { id: id(2), name: 'Literal round', scoringRules: {
    mode: 'osu', teamType: 'team-vs', playersPerTeam: 4, series: { type: 'first_to', wins: 7 } } } }, mappools: [],
} });
const response = (body = empty(), status = 200, headers = {}) => new Response(JSON.stringify(body), { status,
  headers: { 'X-OCLR-Read-Contract': '1.4.0', ...headers } });
function source(fetchImpl) {
  const jobs = [];
  const s = new StreamingSource({ backend: 'https://oclr.org', fetchImpl, readJson: readBoundedJson,
    schedule: (fn, ms) => { jobs.push({ fn, ms }); return jobs.length; }, cancel: () => {} });
  return { s, jobs };
}

test('dedicated read has no cookies or Origin, preserves empty assignment, polls at 15s and keeps secret out of snapshots', async () => {
  const { s, jobs } = source(async (url, options) => {
    assert.equal(url, `https://oclr.org/api/v1/streaming/tournaments/s11/next?afterFixtureId=${id(1)}`);
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.headers.Origin, undefined);
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    return response();
  });
  await s.connect({ edition: 's11', token, afterFixtureId: id(1) });
  assert.equal(s.state.status, 'ready'); assert.equal(s.state.data.nextFixture, null);
  assert.equal(jobs[0].ms, 15000); assert.ok(!JSON.stringify(s).includes(token));
  s.disconnect(); assert.equal(s.state.data, null);
});

test('401/403 clear source, stop polling and never fall back; 429 and 503 back off', async () => {
  for (const status of [401, 403, 404, 429, 503]) {
    const { s, jobs } = source(async () => response({}, status, { 'Retry-After': '75' }));
    await s.connect({ edition: 's11', token });
    assert.equal(s.state.data, null);
    if (status < 429) assert.equal(jobs.length, 0);
    else assert.ok(jobs[0].ms >= (status === 429 ? 75000 : 30000));
  }
});

test('invalid contract, oversized JSON and malformed/cross-linked data never become ready', async () => {
  const bad = fixture(); bad.data.stage.round.id = id(99);
  const badPool = fixture(); badPool.data.mappools = [{ id: id(99), name: 'foreign pool', entries: [] }];
  for (const res of [response(empty(), 200, { 'X-OCLR-Read-Contract': '1.3.0' }), response(bad), response(badPool),
    new Response(' '.repeat(2 * 1024 * 1024 + 1), { headers: { 'X-OCLR-Read-Contract': '1.4.0' } })]) {
    const { s } = source(async () => res); await s.connect({ edition: 's11', token });
    assert.equal(s.state.status, 'stale'); assert.equal(s.state.data, null);
  }
  assert.throws(() => validateStreaming({ data: { nextFixture: null, stage: {}, mappools: [] }, meta: { apiVersion: '1' } }));
});

test('disconnect/reconnect discards a late response from previous credential', async () => {
  let finish;
  const { s } = source(() => new Promise(resolve => { finish = resolve; }));
  const pending = s.connect({ edition: 's11', token }); s.disconnect(); finish(response(fixture())); await pending;
  assert.equal(s.state.status, 'disconnected'); assert.equal(s.state.data, null);
});

test('explicit import copies authoritative scoring, no roster/result guesses; polling never changes a match', async () => {
  const { s } = source(async () => response(fixture()));
  const store = new SessionStore();
  await s.connect({ edition: 's11', token });
  assert.equal(store.state.match.fixtureId, null);
  await store.command(s.importCommand({ id: 'import-1', version: store.state.version, fixtureId: id(1) }));
  assert.equal(store.state.match.stage, 'final'); assert.equal(store.state.match.provenance, 'oclr-streaming');
  assert.deepEqual(store.state.match.teams.a.roster, []); assert.equal(store.state.rounds.length, 0);
  const before = structuredClone(store.state);
  await assert.rejects(store.command(s.importCommand({ id: 'import-2', version: store.state.version, fixtureId: id(1) })), /初始化/);
  assert.deepEqual(store.state, before);
  s.disconnect(); assert.deepEqual(store.state, before);
});

test('unknown/fixed-map scoring and stale data cannot import', async () => {
  for (const rules of [null, { mode: 'osu', teamType: 'team-vs', playersPerTeam: 4, series: { type: 'fixed_maps', count: 8 } }]) {
    const body = fixture(); body.data.stage.round.scoringRules = rules;
    const { s } = source(async () => response(body)); await s.connect({ edition: 's11', token });
    assert.equal(s.state.status, 'ready'); assert.throws(() => s.importCommand({ fixtureId: id(1) }), /赛制/);
  }
});

test('local credential endpoint enforces same-origin JSON, redacts upstream errors and never persists secret', async t => {
  const store = new SessionStore();
  const config = { port: 0, backend: 'https://oclr.org', origin: 'http://localhost:3000' };
  const server = createOverlayServer(config, async () => response(fixture()), undefined, store);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); config.port = server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${config.port}`;
  const post = (body, origin = base) => fetch(`${base}/api/streaming`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ action: 'connect', edition: 's11', token }, 'https://evil.example')).status, 403);
  assert.equal((await post({ action: 'connect', edition: 's11', token })).status, 200);
  for (const path of ['/api/session', '/api/config', '/api/streaming']) assert.ok(!(await (await fetch(base + path)).text()).includes(token));
  assert.ok(!JSON.stringify(store.state).includes(token));
  assert.equal((await post({ action: 'import', id: 'http-import', version: 0, fixtureId: id(1) })).status, 200);
  assert.equal(store.state.match.fixtureId, id(1));
  assert.equal((await fetch(`${base}/api/streaming?token=x`)).status, 400);
  assert.equal((await post({ action: 'disconnect' })).status, 200);
  assert.equal(store.state.match.fixtureId, id(1));
});

test('linked public pool is normalized without extra/private upstream fields', () => {
  const body = fixture(); const poolId = id(10);
  body.data.nextFixture.pool = { id: poolId, name: 'Published pool' };
  body.data.mappools = [{ id: poolId, name: 'Published pool', privateNote: 'must not copy', entries: [{
    id: id(11), category: 'NM', position: 1, beatmapId: 123, metadata: { setId: 12, title: 'Title', artist: 'Artist', difficulty: 'Difficulty' },
  }] }];
  const data = validateStreaming(body);
  assert.equal(data.mappools[0].entries[0].label, 'NM1');
  assert.equal(data.mappools[0].entries[0].setId, 12);
  assert.ok(!JSON.stringify(data).includes('privateNote'));
});

test('import checks current version and refuses stale or changed assignment', async () => {
  const { s } = source(async () => response(fixture())); await s.connect({ edition: 's11', token });
  assert.throws(() => s.importCommand({ fixtureId: id(99) }), /有效/);
  s.state.updatedAt = new Date(Date.now() - 31000).toISOString();
  assert.throws(() => s.importCommand({ fixtureId: id(1) }), /有效/);
});

test('missing stage remains visible with no inferred scoring or import', async () => {
  const body = fixture(); body.data.stage = null;
  const { s } = source(async () => response(body)); await s.connect({ edition: 's11', token });
  assert.equal(s.state.status, 'ready'); assert.equal(s.state.data.stage, null);
  assert.throws(() => s.importCommand({ fixtureId: id(1) }), /赛制/);
});

test('initialize archives match domain and permits explicit next import without losing undo', async () => {
  const { s } = source(async () => response(fixture())); await s.connect({ edition: 's11', token });
  const store = new SessionStore();
  await store.command(s.importCommand({ id: 'first', version: 0, fixtureId: id(1) }));
  await store.command({ id: 'initialize', version: 1, type: 'next-match', payload: {} });
  await store.command(s.importCommand({ id: 'second', version: 2, fixtureId: id(1) }));
  assert.equal(store.state.match.fixtureId, id(1)); assert.ok(store.snapshot().session.canUndo);
});
