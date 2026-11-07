import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionStore } from '../server/session/store.js';
import { newSession, transition, currentRound } from '../server/session/model.js';
import { retainRankingScores } from '../ui/rankingScoreHold.ts';
import { resultTeamScores, playingPickTeam } from '../ui/liveScores.ts';

const send = (state, type, payload = {}) => transition(state, { id: randomUUID(), version: state.version, type, payload });
function harness(prepared = false) {
  let s = send(newSession(), 'setup', { title: 'Warm-up test', stage: 'group', mode: '3v3', source: '4x3',
    teams: { a: { name: 'Red', roster: [] }, b: { name: 'Blue', roster: [] } },
    pool: [1, 2, 3].map(i => ({ id: `m${i}`, label: `NM${i}`, mod: 'NM', beatmapId: 1000 + i })) });
  s = send(s, 'bp');
  s = send(s, 'set-action', { action: { kind: prepared ? 'pick' : 'ban', team: 'a', slot: 0 }, queue: [{ kind: 'pick', team: 'b' }] });
  if (prepared) s = send(s, 'apply-bp', { entryId: 'm1' });
  let store = new SessionStore({ state: s }); let now = Date.now();
  return {
    get store() { return store; }, get s() { return store.state; },
    cmd(type, payload = {}) { return store.command({ id: randomUUID(), version: store.state.version, type, payload }); },
    feed(id, ipc, left = 900, right = 800) {
      return store.frame({ beatmap: { id }, tourney: { ipcState: ipc, teams: { left: 'Red', right: 'Blue' }, totalScore: { left, right },
        players: [{ side: 'left', osuId: 1, score: left }, { side: 'right', osuId: 2, score: right }] } }, now += 500);
    },
    restart() { const saved = structuredClone(store.state); store.close(); store = new SessionStore({ state: saved }); },
  };
}
const formal = s => JSON.stringify([s.action, s.queue, s.bans, s.poolMarks, s.rounds, s.currentRoundId, s.phase, s.scene, s.winner, s.seriesAdjustment, s.ex, s.bpHistory]);

test('Warm-up suppresses every formal automatic path, for pool and non-pool maps, and survives restart', async t => {
  const h = harness(); t.after(() => h.store.close());
  await h.feed(999, 1); await h.cmd('warmup', { enabled: true });
  const before = formal(h.s);
  for (const id of [1001, 888, 1002]) for (const ipc of [1, 1, 3, 3, 4, 4, 1]) await h.feed(id, ipc);
  assert.equal(formal(h.s), before);
  assert.equal(h.s.warmup, true);
  assert.deepEqual(h.store.snapshot().session.series, { a: 0, b: 0 });
  assert.deepEqual([h.s.auto.bp, h.s.auto.scenes, h.s.auto.results], [true, true, true]);
  h.restart(); assert.equal(h.s.warmup, true);
  await h.feed(1001, 4); assert.equal(formal(h.s), before);
  await assert.rejects(h.cmd('apply-bp', { entryId: 'm1' }), /Warm-up/);
  await assert.rejects(h.cmd('record-result', { winner: 'a' }), /Warm-up/);
  await assert.rejects(h.cmd('winner-soon', { team: 'a' }), /Warm-up/);
  assert.equal(h.s.winnerPending, null);
});

test('entering Warm-up during the 5-second Winner countdown cancels the formal confirmation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = harness(); t.after(() => h.store.close());
  await h.cmd('set-series', { a: 6, b: 0, reason: '终局比分' });
  await h.cmd('winner-soon', { team: 'a' });
  assert.equal(h.s.winnerPending?.team, 'a');
  await h.cmd('warmup', { enabled: true });
  t.mock.timers.tick(5000); await h.store.tail;
  assert.equal(h.s.winner, null);
  assert.equal(h.s.winnerPending, null);
  assert.equal(h.s.warmup, true);
});

test('ending Warm-up requires a fresh room return; old heat map never consumes formal BP', async t => {
  const h = harness(); t.after(() => h.store.close());
  await h.feed(999, 1); await h.cmd('warmup', { enabled: true });
  await h.feed(1002, 3); await assert.rejects(h.cmd('warmup', { enabled: false }), /返回房间/);
  await h.feed(1002, 4); await assert.rejects(h.cmd('warmup', { enabled: false }), /返回房间/);
  await h.feed(1002, 1); await h.cmd('warmup', { enabled: false });
  await h.feed(1002, 1); assert.equal(h.s.bans.a[0], null);
  await h.feed(1001, 1); await h.feed(1001, 1);
  assert.equal(h.s.bans.a[0], 'm1');
});

test('warmup cancels delayed Pick display; after return the prepared formal round can start and score normally', async t => {
  const h = harness(true); t.after(() => h.store.close());
  await h.feed(1001, 1); await h.cmd('warmup', { enabled: true });
  assert.equal(h.store.pickScene.pending, null);
  const before = formal(h.s);
  for (const ipc of [3, 3, 4, 4, 1]) await h.feed(1001, ipc);
  assert.equal(formal(h.s), before); assert.equal(currentRound(h.s).status, 'prepared');
  await h.cmd('warmup', { enabled: false });
  await h.feed(1001, 3); await h.feed(1001, 3);
  assert.equal(currentRound(h.s).status, 'playing');
  await assert.rejects(h.cmd('warmup', { enabled: true }), /正式本局/);
  await h.feed(1001, 4, 900, 800); await h.feed(1001, 4, 900, 800); await h.feed(1001, 4, 900, 800);
  assert.equal(currentRound(h.s).status, 'recorded');
  assert.deepEqual(h.store.snapshot().session.series, { a: 1, b: 0 });
});

test('Warm-up never reuses a saved formal score or Pick owner for display', async t => {
  const h = harness(true); t.after(() => h.store.close());
  const round = currentRound(h.s);
  Object.assign(round, { status: 'recorded', resultSource: 'tosu', winner: 'a', finalScore: { a: 9999, b: 8888 } });
  await h.feed(1001, 1);
  await h.cmd('warmup', { enabled: true });
  await h.feed(1001, 4, 120, 240);
  const envelope = h.store.snapshot();
  const hold = retainRankingScores(envelope, 'synced', 'playing', null);
  assert.deepEqual(hold.scores, { left: 120, right: 240 });
  assert.deepEqual(resultTeamScores(envelope, 'synced'), { left: 120, right: 240 });
  assert.equal(playingPickTeam(envelope.session, envelope.session.pool[0]), null);
  assert.deepEqual(envelope.session.series, { a: 1, b: 0 });
  await h.feed(1001, 1); await h.cmd('warmup', { enabled: false });
  // Even a late replay of the warmup's Ranking cannot retract the old win.
  await h.feed(1001, 4, 120, 240); await h.feed(1001, 4, 120, 240);
  assert.deepEqual(h.store.snapshot().session.series, { a: 1, b: 0 });
  assert.equal(currentRound(h.s).status, 'recorded');
});
