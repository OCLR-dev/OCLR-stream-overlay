import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { newCustomSession, transition, currentRound, seriesOf, bpProgress } from '../server/session/model.js';
import { SessionStore } from '../server/session/store.js';
import { startCustomMatch } from '../server/custom-match.js';

const send = (s, type, payload = {}) => transition(s, { id: crypto.randomUUID(), version: s.version, type, payload });
function setup() {
  let s = send(newCustomSession(), 'setting', { field: 'bestOf', value: 9 });
  s = send(s, 'setting', { field: 'stageName', value: '独立阶段' });
  s = send(s, 'setting', { field: 'pool', value: [1, 2, 3].map(id => ({ id: `m${id}`, beatmapId: id, mod: id === 3 ? 'CA' : 'NM', label: id === 3 ? 'CA1' : `NM${id}` })) });
  s = send(s, 'auto', { ...s.auto, wsUrl: 'ws://127.0.0.1:24054/websocket/v2' });
  return s;
}
const prepared = () => send(setup(), 'prepare-round', { entryId: 'm1', pickedBy: 'a' });
const frame = (id, ipc, cleared = false) => ({ beatmap: { id }, tourney: { ipcState: ipc, scoreVisible: !cleared,
  teams: { left: 'L', right: 'R' }, totalScore: { left: cleared ? 0 : 900, right: cleared ? 0 : 800 },
  players: [{ side: 'left', osuId: cleared ? 0 : 1, score: cleared ? 0 : 900, mods: 'NF' }, { side: 'right', osuId: cleared ? 0 : 2, score: cleared ? 0 : 800, mods: 'NF' }] } });

test('v1 custom migration preserves BO, text rule, CA, source URL and undo; original bytes are backed up', async t => {
  let state = send(setup(), 'set-bp-rule', { value: 'pick red\nalternate blue' });
  state = send(state, 'apply-bp', { entryId: 'm1' });
  const legacy = s => {
    s.schema = 1;
    for (const key of ['selections', 'results', 'pendingResults', 'currentSelectionId', 'exRevision', 'rules']) delete s[key];
    for (const round of s.rounds) for (const key of ['selectionId', 'attemptId', 'resultId']) delete round[key];
  };
  legacy(state); for (const undo of state.undo) legacy(undo.state);
  const original = JSON.stringify(state);
  const dir = await mkdtemp(join(tmpdir(), 'oclr-custom-migrate-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'session.json'); await writeFile(file, original);
  const store = await SessionStore.open(file); t.after(() => store.close());
  assert.equal(store.state.schema, 2); assert.deepEqual(store.state.match, state.match);
  assert.deepEqual(store.state.pool, state.pool); assert.deepEqual(store.state.auto, state.auto);
  assert.equal(store.state.undo.length, state.undo.length); assert.equal(currentRound(store.state).entryId, 'm1');
  assert.equal(await readFile(file, 'utf8'), original);
  const backup = (await readdir(dir)).find(name => name.endsWith('.bak'));
  assert.ok(backup); assert.equal(await readFile(join(dir, backup), 'utf8'), original);
  await store.save(store.state);
  const restored = await SessionStore.open(file); t.after(() => restored.close());
  assert.deepEqual(restored.state, store.state);
  assert.equal(send(restored.state, 'undo').match.custom, true);
});

test('custom Pick keeps seven seconds, restarts only on a fresh room map and survives a failed due save', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const store = new SessionStore({ state: setup() }); t.after(() => store.close());
  await store.command({ id: crypto.randomUUID(), version: store.state.version, type: 'bp', payload: {} });
  await store.command({ id: crypto.randomUUID(), version: store.state.version, type: 'prepare-round', payload: { entryId: 'm1', pickedBy: 'a' } });
  t.mock.timers.tick(5000); await store.tail; assert.equal(store.state.scene, 'mappool');
  store.pickScene.observeRoomMap(store.state, 1);
  t.mock.timers.tick(6999); await store.tail; assert.equal(store.state.scene, 'mappool');
  const save = store.save.bind(store); store.save = async () => { throw new Error('test save failure'); };
  t.mock.timers.tick(1); await store.tail; await Promise.resolve(); assert.equal(store.state.scene, 'mappool');
  store.save = save; t.mock.timers.tick(1000); await store.tail; await Promise.resolve();
  assert.equal(store.state.scene, 'playing'); assert.equal(currentRound(store.state).status, 'prepared');
});

test('custom source loss preserves evidence across disk failure and later Ranking cannot backfill a win', async t => {
  const store = new SessionStore({ state: prepared() }); t.after(() => store.close());
  await store.frame(frame(1, 1), 1000); await store.frame(frame(1, 3), 1500);
  const state = structuredClone(store.state); const evidence = store.automation.checkpoint();
  const save = store.save.bind(store); store.save = async () => { throw new Error('test save failure'); };
  await assert.rejects(store.sourceStatus('disconnected'), /test save failure/);
  assert.deepEqual(store.state, state); assert.deepEqual(store.automation.checkpoint(), evidence);
  store.save = save; await store.frame(frame(1, 4), 2000); await store.frame(frame(1, 4), 2500);
  assert.ok(store.state.incident); assert.deepEqual(seriesOf(store.state), { a: 0, b: 0 });
});

test('custom cleared Ranking clients do not swallow the next explicit Pick', async t => {
  let state = send(setup(), 'set-action', { action: { kind: 'pick', team: 'a' }, queue: [{ kind: 'pick', team: 'b' }] });
  state = send(state, 'apply-bp', { entryId: 'm1' });
  const store = new SessionStore({ state }); t.after(() => store.close()); let now = 1000;
  for (const [id, ipc, cleared] of [[1, 1, false], [1, 3, false], [1, 4, false], [1, 4, false], [1, 4, true], [2, 1, true], [2, 1, true]]) await store.frame(frame(id, ipc, cleared), now += 500);
  assert.equal(currentRound(store.state).entryId, 'm2'); assert.equal(currentRound(store.state).status, 'prepared');
  assert.deepEqual(seriesOf(store.state), { a: 1, b: 0 });
});

test('custom EX is charged once, refunded for an explicit replay and preserves independent corrections', () => {
  let s = send(prepared(), 'ex', { team: 'a', remaining: { a: 2, b: 2 } });
  s = send(send(s, 'start'), 'ranking');
  s = send(s, 'record-result', { roundId: s.currentRoundId, winner: 'a' });
  assert.equal(s.ex.remaining.a, 1);
  s = send(s, 'correct-result', { roundId: s.currentRoundId, winner: 'b', reason: '裁判核对' }); assert.equal(s.ex.remaining.a, 1);
  s = send(s, 'referee-replay', { reason: '裁判重赛' }); assert.equal(s.ex.remaining.a, 2);
  s = send(send(s, 'start'), 'ranking');
  s = send(s, 'ex', { team: 'a', remaining: { a: 1, b: 2 } });
  s = send(s, 'record-result', { roundId: s.currentRoundId, winner: 'a' }); assert.equal(s.ex.remaining.a, 1);
});

test('shared correction controls keep custom configuration and can undo a cleared match', () => {
  let s = send(prepared(), 'correct-ban', { team: 'b', slot: 0, entryId: 'm2', empty: false });
  const match = structuredClone(s.match); const pool = structuredClone(s.pool); const auto = structuredClone(s.auto);
  s = send(s, 'start'); s = send(s, 'finish-round', { roundId: s.currentRoundId }); assert.equal(currentRound(s).status, 'ranking');
  s = send(s, 'clear-records'); assert.deepEqual(s.match, match); assert.deepEqual(s.pool, pool); assert.deepEqual(s.auto, auto);
  assert.equal(s.rounds.length, 0); assert.equal(s.rules.type, 'custom');
  s = send(s, 'undo'); assert.equal(currentRound(s).status, 'ranking'); assert.equal(s.bans.b[0], 'm2');
});

test('custom Warm-up now follows main display-only semantics without resetting a formal run', async t => {
  const store = new SessionStore({ state: prepared() }); t.after(() => store.close());
  await store.frame(frame(1, 1), 1000); await store.frame(frame(1, 3), 1500);
  const id = currentRound(store.state).runId;
  await store.command({ id: crypto.randomUUID(), version: store.state.version, type: 'warmup', payload: { enabled: true } });
  await store.frame(frame(1, 4), 2000); await store.frame(frame(1, 4), 2500);
  assert.equal(currentRound(store.state).runId, id); assert.deepEqual(seriesOf(store.state), { a: 1, b: 0 });
  assert.equal(store.state.warmup, true);
});

test('custom rules never acquire an OCLR phase plan or accept a streaming import', () => {
  const s = send(setup(), 'set-bp-rule', { value: 'ban blue\nban red\nban blue\nban red\nalternate red' });
  assert.deepEqual(bpProgress(s).phases, []);
  assert.throws(() => send(s, 'jump-bp-phase', { phase: 'ban2' }), /自定义/);
  assert.throws(() => send(newCustomSession(), 'import-streaming', {}), /不接入/);
});

test('custom HTTP rejects all OCLR entry points and reports the current source without loading credentials', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-custom-source-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const app = await startCustomMatch({ port: 0, guard: false, sessionFile: join(dir, 'session.json') }); t.after(() => app.stop());
  for (const path of ['/api/oclr/tournaments', '/api/streaming']) assert.equal((await fetch(app.appUrl + path)).status, 403);
  await app.store.command({ id: crypto.randomUUID(), version: app.store.state.version, type: 'auto', payload: { ...app.store.state.auto, wsUrl: 'ws://127.0.0.1:1/websocket/v2' } });
  const config = await (await fetch(app.appUrl + '/api/config')).json(); assert.equal(config.authMode, 'custom');
  assert.equal(config.tosuWsUrl, app.store.state.auto.wsUrl);
});

test('custom text-rule BP retraction restores the selection once without losing the remaining order', () => {
  let s = send(setup(), 'set-bp-rule', { value: 'ban blue\npick red\nalternate blue' });
  s = send(s, 'apply-bp', { entryId: 'm2' });
  s = send(s, 'apply-bp', { entryId: 'm1' });
  const selection = currentRound(s).selectionId;
  const next = structuredClone(s.queue);
  s = send(s, 'retract-bp', { selectionId: selection });
  assert.equal(currentRound(s), null); assert.equal(s.action.kind, 'pick'); assert.equal(s.action.team, 'a');
  assert.deepEqual(s.queue, next); assert.equal(s.bans.b[0], 'm2');
  s = send(s, 'apply-bp', { entryId: 'm3' });
  assert.notEqual(currentRound(s).selectionId, selection); assert.equal(currentRound(s).entryId, 'm3');
  s = send(send(s, 'start'), 'ranking');
  assert.equal(s.action.team, 'b'); assert.equal(s.action.kind, 'pick');
  assert.equal(s.match.bpRule, 'ban blue\npick red\nalternate blue');
});
