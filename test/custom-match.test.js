import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { newCustomSession, transition, targetOf, seriesOf, seriesComplete, currentRound, bpProgress } from '../server/session/model.js';
import { SessionStore } from '../server/session/store.js';
import { startCustomMatch } from '../server/custom-match.js';

const rule = 'ban ban-first\nban other-ban\nban ban-first\nban other-ban\nalternate pick-first';
const pool = [...Array.from({ length: 15 }, (_, i) => ({ id: `m${i}`, mod: 'NM', label: `NM${i + 1}`, beatmapId: 810000 + i, title: `隔离测试谱面 ${i + 1}` })), { id: 'tb', mod: 'TB', label: 'TB1', beatmapId: 819999 }];
const command = (s, type, payload = {}) => transition(s, { id: randomUUID(), version: s.version, type, payload });
const setting = (s, field, value) => command(s, 'setting', { field, value });
function setup() {
  let s = newCustomSession();
  s = setting(s, 'bestOf', 7); s = setting(s, 'stageName', '隔离测试 · 邀请赛');
  s = setting(s, 'pool', pool);
  s = command(s, 'set-bp-rule', { value: rule });
  s = command(s, 'set-roll', { a: null, b: null, winner: null, banFirst: 'b', pickFirst: 'a' });
  return s;
}
const apply = (s, i) => command(s, 'apply-bp', { entryId: `m${i}`, actionId: s.action?.id });
function opening(s = setup()) { for (let i = 0; i < 4; i++) s = apply(s, i); return s; }
const finish = s => command(command(s, 'start'), 'ranking');
const sig = s => s.action && [s.action.kind, s.action.team, s.action.slot];

test('custom sessions wait for explicit BO and BP; Roll never installs OCLR order', () => {
  let s = newCustomSession();
  assert.equal(targetOf(s), null); assert.equal(seriesComplete(s), false);
  s = command(s, 'set-roll', { winner: null, banFirst: 'b', pickFirst: 'a' });
  assert.equal(s.action, null); assert.deepEqual(s.queue, []);
  s = setting(s, 'stageName', '决赛'); assert.equal(targetOf(s), null);
  s = setting(s, 'bestOf', 5); assert.equal(targetOf(s), 3);
  assert.match(bpProgress(s).waiting, /等待自定义 BP/);
  assert.throws(() => setting(s, 'bestOf', 6), /奇数/);
  assert.throws(() => setting(s, 'bestOf', 33), /奇数/);
  assert.throws(() => command(s, 'set-stage', { stage: 'final' }), /阶段无效/);
  assert.throws(() => command(s, 'setup', {}), /禁止导入/);
  assert.throws(() => command(newCustomSession(), 'winner', { team: 'a' }), /尚未达到/);
});

test('non-OCLR opening has four consecutive Bans then alternating Picks; missing actors wait', () => {
  let s = command(newCustomSession(), 'set-bp-rule', { value: rule });
  assert.equal(s.action, null);
  s = setup();
  for (const [i, expected] of [['ban', 'b', 0], ['ban', 'a', 0], ['ban', 'b', 1], ['ban', 'a', 1]].entries()) {
    assert.deepEqual(sig(s), expected); s = apply(s, i);
  }
  for (let i = 4; i < 8; i++) {
    assert.deepEqual(sig(s), ['pick', i % 2 === 0 ? 'a' : 'b', null]);
    s = apply(s, i); assert.equal(s.action, null);
    assert.equal(bpProgress(s).canApply, false);
    s = finish(s); assert.equal(currentRound(s).status, 'ranking');
  }
  assert.deepEqual(seriesOf(s), { a: 0, b: 0 }, 'no requirement to award before the next Pick');
});

test('BP grammar validates and edits before start; started BP freezes rules but supports existing correction and undo', () => {
  let s = setup();
  assert.throws(() => command(s, 'set-bp-rule', { value: 'pick winner' }), /第 1 行/);
  assert.throws(() => command(s, 'set-bp-rule', { value: 'alternate red\nban blue' }), /最后一行/);
  assert.throws(() => command(s, 'set-bp-rule', { value: 'ban red\nban red\nban red' }), /两个 Ban/);
  s = command(s, 'set-bp-rule', { value: 'pick red\nban blue\nalternate blue' });
  assert.deepEqual(sig(s), ['pick', 'a', null]);
  s = apply(s, 0);
  assert.throws(() => command(s, 'set-bp-rule', { value: rule }), /BP 已开始/);
  const queue = s.queue;
  s = command(s, 'set-roll', { winner: null, banFirst: 'a', pickFirst: 'b' });
  assert.deepEqual(s.queue, queue);
  s = command(s, 'undo'); assert.equal(s.roll.banFirst, 'b');
  s = command(s, 'set-action', { action: { kind: 'pick', team: 'b' } });
  assert.equal(s.bpFlow.mode, 'manual');
});

test('prepared replacement and replay keep Pick identity and sequence; void restores original Pick', () => {
  let s = apply(opening(), 4); const id = s.currentRoundId; const actionId = currentRound(s).actionId; const queue = s.queue;
  s = apply(s, 5); assert.equal(s.currentRoundId, id); assert.equal(currentRound(s).actionId, actionId); assert.deepEqual(s.queue, queue);
  s = finish(s); const next = s.action;
  s = command(s, 'referee-replay', { reason: '隔离测试裁判确认重赛' });
  assert.equal(currentRound(s).replayOf, id); assert.equal(currentRound(s).actionId, actionId); assert.equal(s.action, null);
  s = finish(s); assert.deepEqual(s.action, next);
  s = command(s, 'referee-replay', { reason: '隔离重赛' });
  s = command(s, 'void-round', { reason: '重新选图' });
  assert.equal(s.action.id, actionId);
});

test('empty Ban, broadcast marks, manual recovery and undo remain separate from real BP', () => {
  let s = setup(); const action = s.action;
  s = command(s, 'map-mark', { entryId: 'm0', status: 'picked', team: 'a' });
  assert.deepEqual(s.action, action); assert.equal(s.rounds.length, 0);
  s = command(s, 'skip-ban', { actionId: s.action.id, reason: '隔离测试空 Ban' });
  assert.equal(s.emptyBans.b[0], true); assert.equal(s.action.team, 'a');
  s = command(s, 'undo'); assert.deepEqual(s.action, action);
  s = apply(opening(), 4); s = command(s, 'start');
  s = command(s, 'incident', { kind: 'abort', reason: '隔离测试中断' });
  assert.throws(() => command(s, 'ranking'), /异常尚未处理/);
  s = command(s, 'referee-replay', { reason: '裁判确认重赛' });
  s = finish(s); assert.equal(s.action.team, 'b');
});

test('BO edits validate score and target independently from phase; series end blocks actions; TB stays separate', () => {
  let s = apply(opening(), 4); s = finish(s);
  s = command(s, 'set-series', { a: 3, b: 0, reason: '隔离测试' });
  s = setting(s, 'stageName', '任意阶段名称'); assert.equal(targetOf(s), 4);
  assert.throws(() => setting(s, 'bestOf', 3), /超出/);
  s = setting(s, 'bestOf', 5); assert.equal(seriesComplete(s), true); assert.equal(bpProgress(s).canApply, false);
  assert.throws(() => apply(s, 5), /比赛已结束/);
  s = command(s, 'set-series', { a: 2, b: 2, reason: '测试 TB 边界' });
  assert.match(bpProgress(s).waiting, /TB/);
  assert.throws(() => apply(s, 5), /TB/);
  s = command(s, 'prepare-round', { entryId: 'tb', pickedBy: 'a', tiebreaker: true });
  assert.throws(() => command(s, 'ex', { team: 'a', remaining: { a: 2, b: 2 } }), /TB/);
  s = finish(s); assert.match(bpProgress(s).waiting, /TB 已结束/);
});

test('configuration, progress and undo survive file reload; initialization remains custom and clears binding', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'custom-session-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'session.json');
  const store = new SessionStore({ file, state: opening() });
  await store.save(store.state);
  const restored = await SessionStore.open(file); assert.deepEqual(restored.state, store.state);
  const s = command(restored.state, 'next-match');
  assert.equal(s.match.custom, true); assert.equal(s.match.bestOf, null); assert.equal(s.match.bpRule, ''); assert.equal(s.auto.wsUrl, '');
  assert.deepEqual(command(s, 'undo').match, restored.state.match);
});

async function until(fn, label) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (fn()) return; await delay(30); }
  assert.fail(`timeout: ${label}`);
}
test('custom runtime uses real isolated WebSocket, blocks OCLR and preserves correction against old Ranking/reconnect', { timeout: 15000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'custom-live-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const app = await startCustomMatch({ port: 0, simulatorPort: 0, sessionFile: join(dir, 'session.json'), guard: false });
  t.after(() => app.stop());
  const { store, simulator } = app;
  const cmd = (type, payload) => store.command({ id: randomUUID(), version: store.state.version, type, payload });
  await cmd('setting', { field: 'bestOf', value: 7 }); await cmd('setting', { field: 'pool', value: pool });
  await cmd('set-bp-rule', { value: rule }); await cmd('set-roll', { winner: null, banFirst: 'b', pickFirst: 'a' });
  await cmd('auto', { ...store.state.auto, profile: 'stable-tourney', wsUrl: simulator.wsUrl, left: 'TEST ROOM RED', right: 'TEST ROOM BLUE' });
  await until(() => store.live.tosu.status === 'live', 'connected'); await delay(150);
  assert.equal((await fetch(`${app.appUrl}/api/oclr/tournaments`)).status, 403);
  assert.equal((await fetch(`${app.appUrl}/.local/custom-match/session.json`)).status, 404);
  for (let i = 0; i < 5; i++) {
    simulator.set({ mapId: 810000 + i, ipcState: 1 });
    await until(() => i < 4 ? store.state.bpHistory.length === i + 1 : currentRound(store.state)?.status === 'prepared', `BP ${i}`);
  }
  simulator.set({ mapId: 810005 }); await until(() => currentRound(store.state).entryId === 'm5', 'replacement');
  simulator.set({ ipcState: 3 }); await until(() => currentRound(store.state).status === 'playing', 'Playing');
  simulator.set({ ipcState: 4, left: 100, right: 50 }); await until(() => currentRound(store.state).status === 'recorded', 'Ranking');
  const next = structuredClone(store.state.action);
  await cmd('retract-result', { roundId: store.state.currentRoundId, reason: '隔离测试撤回' });
  await delay(550); assert.deepEqual(seriesOf(store.state), { a: 0, b: 0 }); assert.deepEqual(store.state.action, next);
  await cmd('record-result', { roundId: store.state.currentRoundId, winner: 'b', keepDisplay: true });
  await delay(500); assert.deepEqual(seriesOf(store.state), { a: 0, b: 1 });
  const wrongUrl = 'ws://127.0.0.1:1/websocket/v2';
  await cmd('auto', { ...store.state.auto, wsUrl: wrongUrl });
  await until(() => store.live.tosu.status !== 'live', 'disconnect');
  assert.equal(store.state.auto.bp, true);
  await cmd('auto', { ...store.state.auto, wsUrl: simulator.wsUrl });
  await until(() => store.live.tosu.status === 'live', 'reconnect'); await delay(500);
  assert.deepEqual(seriesOf(store.state), { a: 0, b: 1 }); assert.deepEqual(store.state.action, next);
});

test('custom launcher rejects any existing non-custom session without replacing it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'custom-refuse-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'session.json');
  const original = new SessionStore({ file }); await original.save(original.state);
  await assert.rejects(startCustomMatch({ port: 0, sessionFile: file, guard: false }), /拒绝打开/);
  assert.deepEqual((await SessionStore.open(file)).state, original.state);
});

test('queued frames and status from a replaced WebSocket cannot contaminate the new source', async () => {
  const store = new SessionStore({ state: setup() });
  store.sourceToken = 2;
  await store.sourceStatus('connecting', 2);
  const before = structuredClone(store.live);
  await store.frame({ beatmap: { id: 810000 } }, Date.now(), 1);
  await store.sourceStatus('disconnected', 1);
  assert.deepEqual(store.live, before); assert.equal(store.state.bpHistory.length, 0);
});

test('explicit BO1 can play one ordinary configured Pick without guessing an initial TB', () => {
  let s = newCustomSession();
  s = setting(s, 'bestOf', 1); s = setting(s, 'pool', pool);
  s = command(s, 'set-bp-rule', { value: 'pick red' });
  assert.equal(bpProgress(s).canApply, true);
  s = finish(apply(s, 0));
  s = command(s, 'record-result', { roundId: s.currentRoundId, winner: 'a', keepDisplay: true });
  assert.equal(seriesComplete(s), true); assert.equal(bpProgress(s).canApply, false);
});
