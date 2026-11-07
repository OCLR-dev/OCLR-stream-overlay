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
function exhibitionFixture(series, scoring = {}) {
  const body = fixture();
  const { nextFixture, stage } = body.data;
  Object.assign(nextFixture, { stage: 'exhibition', label: 'Showmatch', roundName: 'Open exhibition', pool: { id: id(6), name: 'Show pool' } });
  for (const [side, name] of [['home', 'Crimson'], ['away', 'Azure']]) {
    nextFixture[side].team = { ...nextFixture[side].team, name, exhibition: true, avatarKey: null };
    nextFixture[side].label = name;
  }
  stage.kind = 'exhibition';
  stage.round.name = nextFixture.roundName;
  stage.round.scoringRules = series ? { ...stage.round.scoringRules, playersPerTeam: 2, series,
    aggregation: 'sum', failedScorePolicy: 'include', tiedMapPolicy: 'count_as_draw', ...scoring } : null;
  body.data.mappools = [{ ...nextFixture.pool, entries: [1, 2, 3].map(position => ({
    id: id(10 + position), beatmapId: 100 + position, category: 'NM', position, metadata: null,
  })) }];
  return body;
}
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
  const { s } = source(async url => response(new URL(url).search ? empty() : fixture()));
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

test('unknown scoring preserves manual setup while fixed-map scoring cannot import', async () => {
  for (const rules of [null, { mode: 'osu', teamType: 'team-vs', playersPerTeam: 4, series: { type: 'fixed_maps', count: 8 } }]) {
    const body = fixture(); body.data.stage.round.scoringRules = rules;
    const { s } = source(async url => response(new URL(url).search ? empty() : body)); await s.connect({ edition: 's11', token });
    assert.equal(s.state.status, 'ready');
    if (rules) assert.throws(() => s.importCommand({ fixtureId: id(1) }), /赛制/);
    else assert.equal(s.importCommand({ fixtureId: id(1) }).payload.stage, null);
  }
});

test('an open exhibition imports from a mixed task page and counts fixed-map draws without inventing a winner', async () => {
  const body = exhibitionFixture({ type: 'fixed_maps', count: 3, allowDraw: true });
  body.data.nextFixture.id = id(7);
  const { s } = source(async url => {
    const anchor = new URL(url).searchParams.get('afterFixtureId');
    return response(anchor === id(1) ? body : anchor ? empty() : fixture(), 200, { 'X-OCLR-Read-Contract': '1.29.0' });
  });
  const store = new SessionStore();
  let commandId = 0;
  const command = (type, payload = {}) => store.command({ id: `exhibition-${++commandId}`, version: store.state.version, type, payload });
  await s.connect({ edition: 's11', token });
  assert.deepEqual(s.snapshot().tasks.map(task => task.nextFixture.id), [id(1), id(7)]);
  assert.equal(s.snapshot().tasks[1].nextFixture.exhibition, true);
  s.select(id(7));
  await store.command(s.importCommand({ id: 'exhibition-import', version: 0, fixtureId: id(7) }));
  const { match } = store.state;
  assert.equal(match.stage, 'exhibition');
  assert.equal(match.mode, '2v2');
  assert.equal(match.exhibition.roundName, 'Open exhibition');
  assert.deepEqual(match.teams, { a: { id: id(4), name: 'Crimson', roster: [] }, b: { id: id(5), name: 'Azure', roster: [] } });
  assert.deepEqual(store.state.pool.map(e => e.beatmapId), [101, 102, 103]);
  await command('set-roll', { winner: 'a', pickFirst: 'a', banFirst: 'a' });
  assert.equal(store.state.action, null, 'the website feed does not contain the referee BP policy');
  await assert.rejects(command('set-stage', { stage: 'group' }), /初始化表演赛/);
  await assert.rejects(command('set-series', { a: 2, b: 2, reason: 'test' }), /赛制范围/);
  await assert.rejects(command('winner', { team: 'a' }), /尚未确认/);
  for (const [index, winner] of ['a', 'b', null].entries()) {
    await command('prepare-round', { entryId: id(11 + index), pickedBy: 'a' });
    await command('start');
    await command('ranking');
    await command('record-result', { roundId: store.state.currentRoundId, winner, keepDisplay: true });
  }
  assert.deepEqual(store.snapshot().session.exhibition, { limit: 3, played: 3, complete: true, winner: null, draw: true });
  assert.deepEqual(store.snapshot().session.series, { a: 1, b: 1 });
  await command('winner', { team: null });
  assert.equal(store.state.scene, 'victory');
  assert.equal(store.state.winner, null);
  await command('correct-result', { roundId: store.state.currentRoundId, winner: 'b', reason: 'test correction' });
  assert.equal(store.snapshot().session.exhibition.winner, 'b');
  assert.equal(store.state.phase, 'bp');
  await command('winner', { team: 'b' });
  assert.equal(store.state.winner, 'b');
  await command('next-match');
  assert.equal(store.state.match.stage, 'group');
  assert.equal(store.state.match.exhibition, undefined);
  assert.equal(store.snapshot().session.exhibition, undefined);
});

test('first-to and missing exhibition rules remain distinct from the official target', async () => {
  for (const series of [{ type: 'first_to', wins: 3 }, null]) {
    const body = exhibitionFixture(series, { playersPerTeam: 1, teamType: 'head-to-head' });
    if (!series) body.data.stage = null;
    const { s } = source(async url => response(new URL(url).search ? empty() : body));
    await s.connect({ edition: 's11', token });
    const store = new SessionStore();
    await store.command(s.importCommand({ id: 'import', version: 0, fixtureId: id(1) }));
    assert.equal(store.state.match.stage, 'exhibition');
    assert.equal(store.state.match.mode, series ? '1v1' : '4v4');
    assert.equal(store.state.match.exhibition.autoResults, false);
    assert.deepEqual(store.state.match.exhibition.series, series);
    if (series) await assert.rejects(store.command({ id: 'bad-score', version: 1, type: 'set-series',
      payload: { a: 3, b: 3, reason: 'invalid first-to tie' } }), /赛制范围/);
    await store.command({ id: 'score', version: 1, type: 'set-series', payload: { a: 3, b: 1, reason: 'test' } });
    assert.equal(store.snapshot().session.exhibition.winner, series ? 'a' : null);
    assert.equal(store.snapshot().session.exhibition.complete, !!series);
  }
  const mismatched = exhibitionFixture({ type: 'first_to', wins: 3 });
  mismatched.data.stage.kind = 'knockout';
  assert.throws(() => validateStreaming(mismatched), /INVALID_RESPONSE/);
});

test('automatic exhibition wins require a supported total and the configured number of players on each side', async () => {
  for (const [aggregation, teamSize, expected] of [['sum', 2, 1], ['sum', 1, 0], ['average', 2, 0]]) {
    const body = exhibitionFixture({ type: 'first_to', wins: 1 }, { aggregation });
    const { s } = source(async url => response(new URL(url).search ? empty() : body));
    await s.connect({ edition: 's11', token });
    const store = new SessionStore();
    await store.command(s.importCommand({ id: 'import', version: 0, fixtureId: id(1) }));
    await store.command({ id: 'pick', version: 1, type: 'prepare-round', payload: { entryId: id(11), pickedBy: 'a' } });
    const players = ['left', 'right'].flatMap((side, team) => Array.from({ length: teamSize }, (_, index) => ({
      side, osuId: team * 10 + index + 1, score: (team === 0 ? 900 : 800) / teamSize,
    })));
    for (const [index, ipcState] of [1, 3, 4, 4, 4].entries()) {
      await store.frame({ beatmap: { id: 101 }, tourney: { ipcState, teams: { left: 'Crimson', right: 'Azure' },
        totalScore: { left: 900, right: 800 }, players } }, 1000 + 500 * index);
    }
    const { session } = store.snapshot();
    assert.equal(session.rounds[0].status, expected ? 'recorded' : 'ranking');
    assert.deepEqual(session.series, { a: expected, b: 0 });
    assert.equal(session.exhibition.complete, !!expected);
  }
});

test('local credential endpoint enforces same-origin JSON, redacts upstream errors and never persists secret', async t => {
  const store = new SessionStore();
  const config = { port: 0, backend: 'https://oclr.org', origin: 'http://localhost:3000' };
  const server = createOverlayServer(config, async url => response(new URL(url).search ? empty() : fixture()), undefined, store);
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
  const { s } = source(async url => response(new URL(url).search ? empty() : fixture())); await s.connect({ edition: 's11', token });
  assert.throws(() => s.importCommand({ fixtureId: id(99) }), /有效/);
  s.state.updatedAt = new Date(Date.now() - 31000).toISOString();
  assert.throws(() => s.importCommand({ fixtureId: id(1) }), /有效/);
});

test('missing stage remains selectable without inferred scoring', async () => {
  const body = fixture(); body.data.stage = null;
  const { s } = source(async url => response(new URL(url).search ? empty() : body)); await s.connect({ edition: 's11', token });
  assert.equal(s.state.status, 'ready'); assert.equal(s.state.data.stage, null);
  assert.equal(s.importCommand({ fixtureId: id(1) }).payload.stage, null);
});

test('initialize archives match domain and permits explicit next import without losing undo', async () => {
  const { s } = source(async url => response(new URL(url).search ? empty() : fixture())); await s.connect({ edition: 's11', token });
  const store = new SessionStore();
  await store.command(s.importCommand({ id: 'first', version: 0, fixtureId: id(1) }));
  await store.command({ id: 'initialize', version: 1, type: 'next-match', payload: {} });
  await store.command(s.importCommand({ id: 'second', version: 2, fixtureId: id(1) }));
  assert.equal(store.state.match.fixtureId, id(1)); assert.ok(store.snapshot().session.canUndo);
});

test('one-time automatic handoff validates state and edition, rejects replay and cancellation', async () => {
  const { s } = source(async () => response());
  const login = s.beginAuthorization('s11', 'http://127.0.0.1:3001');
  assert.equal(new URL(login.authorizationUrl).pathname, '/streaming/s11/connect');
  assert.ok(!JSON.stringify(s.snapshot()).includes(login.state));
  await assert.rejects(s.completeAuthorization({ edition: 's10', state: login.state, token }), /过期/);
  await assert.rejects(s.completeAuthorization({ edition: 's11', state: 'z'.repeat(43), token }), /过期/);
  await s.completeAuthorization({ edition: 's11', state: login.state, token });
  assert.equal(s.state.status, 'ready');
  await assert.rejects(s.completeAuthorization({ edition: 's11', state: login.state, token }), /过期/);
  const cancel = s.beginAuthorization('s11', 'http://localhost:3001'); s.disconnect();
  await assert.rejects(s.completeAuthorization({ ...cancel, token }), /过期/);
  assert.throws(() => s.beginAuthorization('s11', 'https://evil.example'));
});

test('assigned tasks can be selected independently, pagination stays read-only', async () => {
  let job;
  const s = new StreamingSource({ backend: 'https://oclr.org', readJson: readBoundedJson,
    fetchImpl: async url => {
      const anchor = new URL(url).searchParams.get('afterFixtureId');
      const n = anchor ? Number(anchor.slice(-12)) + 1 : 1;
      if (n > 7) return response();
      const body = fixture(); body.data.nextFixture.id = id(n); body.data.nextFixture.label = `Task ${n}`;
      return response(body);
    }, schedule: (fn) => { job = fn; return 1; }, cancel: () => {} });
  await s.connect({ edition: 's11', token });
  assert.equal(s.state.tasks.length, 5); assert.equal(s.state.hasMore, true);
  s.select(id(3)); assert.equal(s.importCommand({ fixtureId: id(3) }).payload.fixtureId, id(3));
  assert.throws(() => s.select(id(99)), /有效|任务/);
  await s.page(id(5)); assert.equal(s.state.tasks.length, 2); assert.equal(s.state.hasMore, false);
  assert.equal(s.state.data.nextFixture.id, id(6));
  s.select(id(7)); assert.equal(s.state.data.nextFixture.id, id(7));
  await s.page(null); assert.equal(s.state.data.nextFixture.id, id(1));
  assert.equal(typeof job, 'function');
  s.disconnect(); assert.equal(s.state.tasks.length, 0);
});

test('unknown scoring task imports with explicit manual stage and mode preserved', async () => {
  const body = fixture(); body.data.stage = null;
  const { s } = source(async url => response(new URL(url).search ? empty() : body));
  await s.connect({ edition: 's11', token });
  const store = new SessionStore(); store.state.match.stage = 'elimination'; store.state.match.mode = '3v3';
  await store.command(s.importCommand({ id: 'missing-rules', version: 0, fixtureId: id(1) }));
  assert.equal(store.state.match.stage, 'elimination'); assert.equal(store.state.match.mode, '3v3');
});
