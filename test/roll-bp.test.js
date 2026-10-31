import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bpProgress, currentRound, newSession, seriesOf, transition } from '../server/session/model.js';
import { SessionStore } from '../server/session/store.js';

const pool = [...Array.from({ length: 32 }, (_, i) => ({ id: `m${i}`, label: `FM${i + 1}`, mod: 'FM', beatmapId: 810000 + i })),
  { id: 'tb', label: 'TB1', mod: 'TB', beatmapId: 819999 }];
const cmd = (s, type, payload = {}) => transition(s, { id: randomUUID(), version: s.version, type, payload });
const roll = (banFirst = 'a', pickFirst = 'b') => ({ a: 90, b: 50, winner: 'a', banFirst, pickFirst });
const setup = () => cmd(newSession(), 'setup', { title: '隔离 BP 回归 · 合成数据', stage: 'group', mode: '4v4', source: '4x3',
  teams: { a: { name: '红队', roster: [] }, b: { name: '蓝队', roster: [] } }, pool });
function harness(state = cmd(setup(), 'set-roll', roll())) {
  const store = new SessionStore({ state }); let now = 0;
  return { store, get s() { return store.state; },
    cmd(type, payload = {}) { return store.command({ id: randomUUID(), version: store.state.version, type, payload }); },
    async bind() { await this.cmd('auto', { ...this.s.auto, profile: 'stable-tourney', left: 'Red room', right: 'Blue room' }); },
    frame(map = 899999, ipcState = 1, totals = { left: null, right: null }) {
      now += 500;
      return store.frame({ beatmap: { id: map }, tourney: { ipcState, teams: { left: 'Red room', right: 'Blue room' }, totalScore: totals,
        players: [{ side: 'left', osuId: 1, score: totals.left }, { side: 'right', osuId: 2, score: totals.right }] } }, now);
    },
    async change(i, ipc = 1) { await this.frame(810000 + i, ipc); await this.frame(810000 + i, ipc); },
    async apply(i) { await this.cmd('apply-bp', { entryId: `m${i}`, actionId: this.s.action?.id }); },
    async firstPick() { await this.apply(0); await this.apply(1); await this.apply(2); },
    async end(i, totals) { await this.frame(810000 + i, 3); await this.frame(810000 + i, 4, totals); await this.frame(810000 + i, 4, totals); },
  };
}
const signature = a => a && [a.kind, a.team, a.kind === 'ban' ? a.slot : a.ordinal];

for (const banFirst of ['a', 'b']) for (const pickFirst of ['a', 'b']) test(`Roll ${banFirst} Ban first / ${pickFirst} Pick first drives the complete interleaved order`, async () => {
  const other = t => t === 'a' ? 'b' : 'a';
  const h = harness(cmd(setup(), 'set-roll', roll(banFirst, pickFirst)));
  await h.bind(); await h.frame();
  const expected = [['ban', banFirst, 0], ['ban', other(banFirst), 0], ['pick', pickFirst, 1], ['pick', other(pickFirst), 1],
    ['ban', banFirst, 1], ['ban', other(banFirst), 1], ['pick', pickFirst, 2], ['pick', other(pickFirst), 2],
    ['pick', pickFirst, 3], ['pick', other(pickFirst), 3], ['pick', pickFirst, 4]];
  for (const [i, action] of expected.entries()) {
    assert.deepEqual(signature(h.s.action), action);
    await h.change(i);
    const consumed = h.s.bpHistory.length;
    await h.frame(810000 + i); await h.frame(810000 + i);
    assert.equal(h.s.bpHistory.length, consumed, 'one stable map is never reused by the next action');
    if (action[0] === 'pick') {
      assert.equal(h.s.action, null);
      assert.equal(currentRound(h.s).status, 'prepared');
      const next = structuredClone(h.s.queue);
      await h.frame(810000 + i, 4); await h.frame(810000 + i, 4);
      assert.equal(currentRound(h.s).status, 'prepared', 'old Ranking cannot complete a prepared Pick');
      assert.deepEqual(h.s.queue, next);
      await h.end(i);
      assert.equal(currentRound(h.s).status, 'ranking');
      const nextAction = structuredClone(h.s.action);
      await h.frame(810000 + i, 4); await h.frame(810000 + i, 4);
      assert.deepEqual(h.s.action, nextAction);
    }
  }
  assert.deepEqual(seriesOf(h.s), { a: 0, b: 0 }, 'unrecorded results do not block subsequent BP');
});

test('Roll needs two explicit choices, permits equal teams and rebuilds only before the first real BP', () => {
  let s = cmd(setup(), 'set-roll', { ...roll(), pickFirst: null });
  assert.equal(s.action, null); assert.deepEqual(s.queue, []);
  s = cmd(s, 'set-roll', roll('b', 'b'));
  assert.deepEqual(signature(s.action), ['ban', 'b', 0]);
  s = cmd(s, 'set-roll', roll('a', 'a'));
  assert.deepEqual(signature(s.action), ['ban', 'a', 0]);
  s = cmd(s, 'set-roll', { ...roll(), banFirst: null });
  assert.equal(s.action, null);
  const viaOldCommand = cmd(setup(), 'roll', { ...roll(), enterBp: false });
  assert.equal(viaOldCommand.scene, 'roll'); assert.equal(viaOldCommand.phase, 'bp'); assert.ok(viaOldCommand.action);
});

test('loading setup metadata after Roll keeps the already established opening action and order', () => {
  const s = cmd(setup(), 'set-roll', roll());
  const next = cmd(s, 'setup', { ...s.match, pool: s.pool });
  assert.deepEqual(next.action, s.action); assert.deepEqual(next.queue, s.queue); assert.deepEqual(next.bpFlow, s.bpFlow);
});

test('prepared replacements preserve the Pick identity, count, owner, EX and future order', async () => {
  const h = harness(); await h.bind(); await h.frame(); await h.firstPick();
  const before = structuredClone(currentRound(h.s)); const queue = structuredClone(h.s.queue);
  await h.cmd('ex', { team: 'b', remaining: { a: 2, b: 1 } });
  await h.change(3);
  assert.equal(currentRound(h.s).id, before.id); assert.equal(currentRound(h.s).actionId, before.actionId);
  assert.equal(currentRound(h.s).pickedBy, 'b'); assert.equal(h.s.rounds.length, 1); assert.equal(h.s.action, null);
  assert.deepEqual(h.s.queue, queue); assert.equal(h.s.ex.team, 'b');
  await h.cmd('prepare-round', { entryId: 'm4', pickedBy: 'b', ifCurrentRoundId: before.id });
  assert.equal(currentRound(h.s).actionId, before.actionId); assert.deepEqual(h.s.queue, queue);
});

test('Playing cannot be skipped by a display change, manual preparation or a BP action', async () => {
  const h = harness(); await h.firstPick(); await h.cmd('start'); await h.cmd('display', { scene: 'mappool' });
  await assert.rejects(h.apply(3), /尚未结束/);
  await assert.rejects(h.cmd('prepare-round', { entryId: 'm3', pickedBy: 'a' }), /尚未结束/);
  assert.equal(currentRound(h.s).status, 'playing');
});

test('winning team and later manual result never reorder Picks or consume the next Ban twice', async () => {
  const h = harness(); await h.firstPick(); await h.cmd('start');
  const first = currentRound(h.s).id;
  await h.cmd('record-result', { roundId: first, winner: 'b', keepDisplay: true });
  assert.deepEqual(signature(h.s.action), ['pick', 'a', 1]);
  await h.apply(3); await h.cmd('start'); await h.cmd('ranking');
  const ban = structuredClone(h.s.action);
  await h.cmd('record-result', { roundId: currentRound(h.s).id, winner: 'b', keepDisplay: true });
  assert.deepEqual(h.s.action, ban); assert.deepEqual(signature(ban), ['ban', 'a', 1]);
  await h.cmd('correct-result', { roundId: first, winner: 'a', reason: '核对实际胜方' });
  assert.deepEqual(h.s.action, ban);
});

test('second first-Pick replay returns the pending second Ban without consuming a new Pick', async () => {
  const h = harness(); await h.firstPick(); await h.cmd('start'); await h.cmd('ranking');
  await h.apply(3); await h.cmd('start'); await h.cmd('ranking');
  const ban = structuredClone(h.s.action); const queue = structuredClone(h.s.queue); const old = currentRound(h.s).id;
  await h.cmd('referee-replay', { reason: '裁判确认重赛' });
  assert.equal(currentRound(h.s).replayOf, old); assert.equal(h.s.action, null); assert.deepEqual(h.s.queue[0], ban);
  await h.cmd('start'); await h.cmd('ranking');
  assert.deepEqual(h.s.action, ban); assert.deepEqual(h.s.queue, queue);
  assert.equal(h.s.bpHistory.filter(item => item.kind === 'pick').length, 2);
  await h.apply(4);
  await assert.rejects(h.cmd('referee-replay', { reason: '迟到的重赛决定' }), /先撤销后续 BP/);
});

test('prestart abort, active abort and replay preserve the same selection until a real finish', async () => {
  const h = harness(); await h.firstPick(); const pickId = currentRound(h.s).id; const queue = structuredClone(h.s.queue);
  await h.cmd('incident', { kind: 'abort', reason: '尚未开打' }); await h.cmd('resolve-incident', { reason: '恢复准备' });
  await h.cmd('referee-replay', { reason: '未开打继续原图' }); assert.equal(currentRound(h.s).id, pickId);
  await h.cmd('start'); await h.cmd('incident', { kind: 'abort', reason: '已开打中止' });
  await assert.rejects(h.cmd('ranking'), /异常尚未处理/);
  await h.cmd('referee-replay', { reason: '裁判确认重新开打' });
  assert.deepEqual(h.s.queue, queue); assert.equal(h.s.action, null);
});

test('Roll corrections during play preserve the run, BP, score and observer finish', async () => {
  const h = harness(); await h.bind(); await h.frame(); await h.firstPick(); await h.change(2); await h.frame(810002, 3);
  const round = structuredClone(currentRound(h.s)); const queue = structuredClone(h.s.queue);
  await h.frame(810002, 4);
  await h.cmd('set-roll', roll('b', 'a'));
  assert.deepEqual(currentRound(h.s), round); assert.deepEqual(h.s.queue, queue); assert.equal(bpProgress(h.s).rollChanged, true);
  await h.frame(810002, 4);
  assert.deepEqual(signature(h.s.action), ['pick', 'a', 1]); assert.equal(currentRound(h.s).status, 'ranking');
});

test('manual correction of the current action and future queue persists and can be undone', async () => {
  const h = harness(); await h.apply(0); const before = structuredClone(h.s);
  await h.cmd('set-plan', { queue: [{ kind: 'pick', team: 'b' }] });
  assert.equal(h.s.action.id, before.action.id); assert.equal(bpProgress(h.s).mode, 'manual');
  await h.cmd('undo'); assert.deepEqual(h.s.bpFlow, before.bpFlow); assert.deepEqual(h.s.queue, before.queue);
  await h.cmd('set-action', { action: { kind: 'ban', team: 'b', slot: 1 } });
  await h.apply(1); assert.equal(h.s.bans.b[1], 'm1');
  await h.cmd('set-roll', roll('b', 'b')); assert.equal(h.s.bpFlow.mode, 'manual');
});

test('broadcast markers stay independent; explicit empty Ban and its undo consume exactly one action', async () => {
  const h = harness(); const before = structuredClone(h.s.action);
  await h.cmd('map-mark', { entryId: 'm0', status: 'picked', team: 'b' });
  assert.deepEqual(h.s.action, before); assert.equal(h.s.bpHistory.length, 0);
  const request = { id: randomUUID(), version: h.s.version, type: 'skip-ban', payload: { actionId: before.id, reason: '裁判确认放弃' } };
  await h.store.command(request); await h.store.command(request);
  assert.equal(h.s.emptyBans.a[0], true); assert.equal(h.s.bpHistory.length, 1); assert.deepEqual(signature(h.s.action), ['ban', 'b', 0]);
  await assert.rejects(h.cmd('skip-ban', request.payload), /动作已改变/);
  await h.cmd('undo'); assert.equal(h.s.emptyBans.a[0], false); assert.deepEqual(h.s.action, before);
});

test('pending map cannot be transferred to a manual recovery, corrected action, or undo', async () => {
  const h = harness(); await h.bind(); await h.frame(); await h.frame(810000);
  await h.apply(1); const next = h.s.action.id;
  await h.frame(810000); await h.frame(810000); assert.equal(h.s.action.id, next); assert.equal(h.s.bans.b[0], null);
  await h.cmd('undo'); await h.frame(810000); await h.frame(810000); assert.equal(h.s.bans.a[0], null);
  await h.change(2); assert.equal(h.s.bans.a[0], 'm2');
});

test('restore, subscribers and reconnect never replay a Ban or old Ranking', async t => {
  const h = harness(); await h.bind(); await h.frame(); await h.change(0);
  const dir = await mkdtemp(join(tmpdir(), 'oclr-roll-bp-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const persisted = new SessionStore({ state: h.s, file: join(dir, 'session.json') }); await persisted.save(h.s);
  const restored = await SessionStore.open(persisted.file); const copy = harness(restored.state);
  const stops = [copy.store.subscribe(() => {}), copy.store.subscribe(() => {})];
  await copy.frame(810000, 4); await copy.frame(810000, 4); assert.equal(copy.s.bans.b[0], null);
  await copy.store.sourceStatus('disconnected'); await copy.frame(810001, 4); await copy.frame(810001, 4);
  assert.equal(copy.s.bans.b[0], null);
  await copy.change(2); assert.equal(copy.s.bans.b[0], 'm2');
  stops.forEach(stop => stop());
});

test('legacy sessions, manual queues, empty manual intent and in-progress BP are never enrolled or reordered', () => {
  for (let s of [cmd(setup(), 'set-action', { action: { kind: 'ban', team: 'b', slot: 1 } }),
    cmd(setup(), 'set-plan', { queue: [{ kind: 'pick', team: 'b' }] }), cmd(setup(), 'set-plan', { queue: [] })]) {
    delete s.bpFlow;
    const before = structuredClone(s); s = cmd(s, 'set-roll', roll());
    assert.deepEqual(s.action, before.action); assert.deepEqual(s.queue, before.queue); assert.equal(s.bpFlow, undefined);
  }
  let old = cmd(setup(), 'set-action', { action: { kind: 'pick', team: 'a' } });
  old = cmd(old, 'apply-bp', { entryId: 'm0' }); delete old.bpFlow;
  const before = structuredClone(old); old = cmd(old, 'set-roll', roll());
  assert.deepEqual(old.rounds, before.rounds); assert.deepEqual(old.queue, before.queue);
  const store = new SessionStore({ state: old }); assert.deepEqual(store.state, old);
});

test('series completion blocks new BP; score correction reopens the retained action without replaying it', async () => {
  const h = harness(); const action = structuredClone(h.s.action);
  await h.cmd('set-series', { a: 6, b: 2, reason: '已结束' });
  assert.equal(bpProgress(h.s).stopped, true);
  await assert.rejects(h.apply(0), /比赛已结束/);
  await assert.rejects(h.cmd('skip-ban', { actionId: action.id, reason: '空 Ban' }), /当前不是/);
  await h.cmd('set-series', { a: 5, b: 2, reason: '比分修正' });
  assert.deepEqual(h.s.action, action); await h.apply(0); assert.equal(h.s.bans.a[0], 'm0');
});

test('ordinary Pick excludes TB, regular-map boundary waits without consuming it, TB is a separate manual round', async () => {
  const h = harness(); await h.firstPick();
  await assert.rejects(h.cmd('apply-bp', { entryId: 'tb' }), /TB 单独/);
  await assert.rejects(h.cmd('adjust-round', { entryId: 'tb', pickedBy: 'b' }), /TB 单独/);
  await h.cmd('start'); await h.cmd('ranking'); await h.apply(3); await h.cmd('start'); await h.cmd('ranking');
  await h.apply(4); await h.apply(5);
  for (let i = 6; i < 14; i++) { await h.apply(i); await h.cmd('start'); await h.cmd('ranking'); }
  assert.equal(bpProgress(h.s).stopped, true); await assert.rejects(h.apply(14), /常规选图已结束/);
  const action = structuredClone(h.s.action); const picks = h.s.bpHistory.length;
  await assert.rejects(h.cmd('prepare-round', { entryId: 'tb', pickedBy: 'a' }), /单独的 TB/);
  await h.cmd('prepare-round', { entryId: 'tb', pickedBy: 'a', tiebreaker: true });
  assert.equal(h.s.action, null); assert.equal(h.s.bpHistory.length, picks); assert.equal(currentRound(h.s).source, 'manual-tb');
  assert.equal(bpProgress(h.s).canReplace, true);
  await assert.rejects(h.cmd('apply-bp', { entryId: 'm15' }), /TB 单独/);
  await assert.rejects(h.cmd('ex', { team: 'a', remaining: { a: 2, b: 2 } }), /TB/);
  await h.cmd('start'); await h.cmd('ranking'); assert.equal(h.s.action, null); assert.deepEqual(h.s.queue[0], action);
  assert.equal(bpProgress(h.s).stopped, true);
});

test('voiding a selection restores its original Pick rather than advancing to second bans', async () => {
  const h = harness(); await h.firstPick(); const original = structuredClone(currentRound(h.s).bpAction);
  await h.cmd('void-round', { reason: '原选图取消，重选' });
  assert.deepEqual(h.s.action, original); await h.apply(3); assert.equal(currentRound(h.s).pickedBy, 'b');
  assert.deepEqual(signature(h.s.queue[0]), ['pick', 'a', 1]);
});

test('missing tosu room data waits with intent on and current BP ready, without claiming a room operation', async () => {
  const h = harness(); const before = structuredClone(h.s.action);
  await h.store.frame({ beatmap: { id: 810000 }, tourney: null });
  assert.equal(h.s.auto.bp, true); assert.deepEqual(h.s.action, before);
  assert.match(h.store.live.note, /等待 tosu/); assert.equal(h.s.bpHistory.length, 0);
});

test('initialization allows a fresh automatic Roll flow despite older manual actions in the audit trail', () => {
  let s = cmd(setup(), 'set-action', { action: { kind: 'pick', team: 'a' } });
  s = cmd(s, 'next-match');
  s = cmd(s, 'set-roll', roll());
  assert.deepEqual(signature(s.action), ['ban', 'a', 0]);
  assert.equal(s.bpFlow.mode, 'roll');
});

test('recording an older legacy pending result never activates or consumes the newer round queue', () => {
  let s = cmd(setup(), 'set-action', { action: { kind: 'pick', team: 'a' } });
  s = cmd(s, 'apply-bp', { entryId: 'm0' }); s = cmd(s, 'start'); const old = currentRound(s).id;
  // Shape of a pre-upgrade session which allowed selecting the next map before
  // explicitly ending the old one. No new code creates this state.
  s.rounds.push({ ...structuredClone(currentRound(s)), id: 'legacy-next', entryId: 'm1', status: 'prepared', runId: null });
  s.currentRoundId = 'legacy-next'; s.phase = 'bp';
  s = cmd(s, 'set-plan', { queue: [{ kind: 'pick', team: 'b' }] });
  const queue = structuredClone(s.queue); const current = structuredClone(currentRound(s));
  s = cmd(s, 'record-result', { roundId: old, winner: 'a', keepDisplay: true });
  assert.deepEqual(s.queue, queue); assert.equal(s.action, null); assert.deepEqual(currentRound(s), current);
});
