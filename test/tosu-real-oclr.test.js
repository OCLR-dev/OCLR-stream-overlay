import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startSimulation } from '../tools/tosu-simulator/stack.js';
import { newSession, currentRound } from '../server/session/model.js';

// Explicit contract fixtures; no production key, real match or internet used.
const config = { mode: 'bearer', backend: 'https://oclr.invalid', origin: 'http://localhost:3000', key: 'unit-test-credential' };
const version = 'a'.repeat(64);
const archive = { editionSlug: 's10', capturedOn: '2026-10-24',
  teams: [{ id: 'alpha', name: 'Historical Alpha' }, { id: 'beta', name: 'Historical Beta' }], players: [],
  pools: [{ id: 'gs1', name: 'Historical Group Pool', maps: [{ slot: 'NM1', beatmapId: 991001, title: 'Published contract fixture' }, { slot: 'NM2', beatmapId: 991002, title: 'Second contract fixture' }] }],
  matches: [{ id: 'match-1', label: 'Historical match', stage: 'Group A', teamA: 'alpha', teamB: 'beta', poolId: 'gs1', score: [6, 4] }],
};
function remote(calls) {
  return async (url, options) => {
    calls.push({ url: String(url), method: options.method, authorization: options.headers.Authorization, origin: options.headers.Origin });
    const path = new URL(url).pathname;
    let data = [];
    if (path.endsWith('/s10')) data = { slug: 's10', overview: { kind: 'historical_archive' } };
    if (path.endsWith('/configuration')) data = { edition: { archive } };
    if (path.endsWith('/competition')) data = { fixtures: [] };
    if (path.endsWith('/bracket')) data = null;
    const meta = { apiVersion: '1', ...(path.endsWith('/players') ? { pagination: { page: 1, pageSize: 100, collectionVersion: version, total: 0, totalPages: 0, nextPage: null } } : {}) };
    return Response.json({ data, meta }, { headers: { 'X-OCLR-Read-Contract': '1.3.0' } });
  };
}
async function until(predicate) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (predicate()) return; await delay(30); }
  assert.fail('Expected simulator/API state did not arrive');
}
async function boot(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'oclr-tosu-real-api-'));
  const file = join(directory, 'session.json');
  await writeFile(file, JSON.stringify(newSession()));
  const calls = [];
  const stack = await startSimulation({ appPort: 0, wsPort: 0, sessionFile: file, oclrConfig: config, oclrFetch: remote(calls), ...options });
  t.after(async () => { await stack.stop(); await rm(directory, { recursive: true, force: true }); });
  await until(() => stack.store.live.tosu.status === 'live');
  return { ...stack, calls };
}
async function command(stack, type, payload = {}) {
  const res = await fetch(`${stack.appUrl}/api/session/command`, { method: 'POST', headers: { Origin: stack.appUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), version: stack.store.state.version, type, payload }) });
  const value = await res.json(); assert.equal(res.status, 200, value.error?.message); return value;
}
async function room(stack, patch = {}, action = 'set') {
  const res = await fetch(`${stack.simulatorUrl}/api/simulator/control`, { method: 'POST', headers: { Origin: stack.simulatorUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, patch }) });
  const value = await res.json(); assert.equal(res.status, 200, value.error); return value;
}
async function importHistory(stack) {
  await command(stack, 'load-edition', { edition: 's10' });
  return command(stack, 'import-match', { edition: 's10', fixtureId: 'match-1', poolId: 'gs1', leftTeamId: 'alpha', rightTeamId: 'beta', title: 'Historical API contract fixture', stage: 'group', mode: '4v4', source: '4x3' });
}

test('normal simulator reads archived competition through the real read-only proxy contract and keeps keys server-side', async t => {
  const stack = await boot(t);
  assert.equal(stack.store.state.pool.length, 0, 'normal mode never seeds fake competition data');
  const before = structuredClone(stack.store.state);
  const loaded = await command(stack, 'load-edition', { edition: 's10' });
  assert.deepEqual(stack.store.state, before, 'catalogue loading does not overwrite the match');
  assert.equal(loaded.catalog.kind, 'historical_archive'); assert.equal(loaded.catalog.fixtures.length, 1);
  assert.equal(stack.calls.length, 7);
  assert.ok(stack.calls.every(call => call.method === 'GET' && call.authorization === `Bearer ${config.key}` && call.origin === config.origin));
  const publicConfig = await (await fetch(`${stack.appUrl}/api/config`)).text();
  assert.ok(!publicConfig.includes(config.key)); assert.ok(!JSON.stringify(loaded).includes(config.key));
  const count = stack.calls.length;
  assert.equal((await fetch(`${stack.appUrl}/api/oclr/tournaments/s10`, { method: 'POST' })).status, 405);
  assert.equal(stack.calls.length, count, 'mutation never reaches the remote');
  assert.equal(loaded.live.sources.tosu, 'simulated'); assert.equal(loaded.live.sources.oclr, 'remote-read-only');
});

test('imported historical pool drives simulated maps and new game results, without copying historical wins', async t => {
  const stack = await boot(t); const imported = await importHistory(stack);
  assert.deepEqual(imported.session.series, { a: 0, b: 0 });
  const maps = stack.simulator.snapshot().maps;
  assert.ok(maps.some(m => m.beatmapId === 991001)); assert.ok(!maps.some(m => m.beatmapId === 710001));
  await room(stack, { leftName: 'Explicit room left', rightName: 'Explicit room right', growing: false });
  await command(stack, 'auto', { ...stack.store.state.auto, profile: 'stable-tourney', left: 'Explicit room left', right: 'Explicit room right' });
  await command(stack, 'set-action', { action: { kind: 'pick', team: 'a' }, queue: [{ kind: 'pick', team: 'b' }] });
  await delay(200);
  await room(stack, { mapId: 991001, ipcState: 1 });
  await until(() => currentRound(stack.store.state)?.status === 'prepared');
  assert.equal(stack.simulator.snapshot().frame.beatmap.title, 'Published contract fixture');
  await room(stack, { ipcState: 3 }); await until(() => currentRound(stack.store.state)?.status === 'playing');
  await room(stack, { ipcState: 4, left: 900, right: 800 }); await until(() => currentRound(stack.store.state)?.status === 'recorded');
  assert.deepEqual(stack.store.snapshot().session.series, { a: 1, b: 0 });
});

test('resetting only tosu preserves imported match, room team configuration and all competition records', async t => {
  const stack = await boot(t); await importHistory(stack);
  await room(stack, { leftName: 'Room left', rightName: 'Room right', mapId: 991001 });
  const before = structuredClone(stack.store.state);
  await room(stack, {}, 'reset');
  assert.deepEqual(stack.store.state, before);
  assert.deepEqual(stack.simulator.snapshot().roomTeams, { left: 'Room left', right: 'Room right' });
  assert.equal(stack.simulator.snapshot().offlineFixtures, false);
  assert.equal(stack.simulator.snapshot().maps[1].beatmapId, 991001);
});

test('invalid bearer stays blocked without anonymous fallback while simulated tosu continues', async t => {
  const auth = [];
  const stack = await boot(t, { oclrFetch: async (url, options) => {
    auth.push(options.headers.Authorization);
    return Response.json({ error: { code: 'INVALID_TOKEN' } }, { status: 401 });
  } });
  await assert.rejects(command(stack, 'load-edition', { edition: 's10' }));
  assert.equal(stack.store.live.oclr.status, 'blocked'); assert.equal(stack.store.live.oclr.error, 'INVALID_TOKEN');
  assert.deepEqual(auth, [`Bearer ${config.key}`]); assert.equal(stack.store.live.tosu.status, 'live');
  assert.deepEqual(stack.store.catalog.teams, []);
});

test('an explicit missing match file is rejected in normal simulation instead of creating a replacement', async () => {
  await assert.rejects(startSimulation({ appPort: 0, wsPort: 0, sessionFile: join(tmpdir(), `missing-oclr-${crypto.randomUUID()}.json`), oclrConfig: config }), { code: 'ENOENT' });
});

test('random-port tests cannot implicitly open the current persistent match or load real credentials', async () => {
  await assert.rejects(startSimulation({ appPort: 0, wsPort: 0 }), /隔离测试需明确指定/);
});
