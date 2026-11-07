import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionStore } from '../server/session/store.js';
import { currentRound, seriesOf } from '../server/session/model.js';
async function harness(t) {
  const store = new SessionStore(); t.after(() => store.close());
  const cmd = (type, payload = {}) => store.command({ id: randomUUID(), version: store.state.version, type, payload });
  await cmd('setup', { title: '等待与重赛记分口径 · 合成测试', stage: 'group', mode: '3v3', source: '4x3', teams: { a: { name: 'L', roster: [] }, b: { name: 'R', roster: [] } }, pool: [{ id: 'fm', mod: 'FM', label: 'FM1', beatmapId: 101 }] });
  await cmd('set-series', { a: 2, b: 0, reason: '加入前已核对的系列比分' });
  await cmd('prepare-round', { entryId: 'fm', pickedBy: 'b' }); let now = 1000;
  const frame = ipcState => store.frame({ beatmap: { id: 101 }, tourney: { ipcState, teams: { left: 'L', right: 'R' }, totalScore: { left: 100, right: 90 }, players: [{ side: 'left', osuId: 1, score: 100 }, { side: 'right', osuId: 2, score: 90 }] } }, now += 500);
  await frame(1); await frame(3); await cmd('incident', { kind: 'player-disconnect', reason: '有人卡住，先等一下' }); await frame(4);
  return { store, cmd, frame };
}
for (const scoreType of ['series', 'round']) test(`waiting → ${scoreType} score → referee replay → old Ranking → Ready/Playing preserves only independent corrections`, async t => {
  const h = await harness(t); const old = currentRound(h.store.state).id;
  if (scoreType === 'series') await h.cmd('set-series', { a: 2, b: 1, reason: '独立系列校正' });
  else await h.cmd('record-result', { roundId: old, winner: 'b', keepDisplay: true, reviewReason: '裁判核对后确认本图蓝队胜'  });
  assert.deepEqual(seriesOf(h.store.state), { a: 2, b: 1 });
  await h.cmd('referee-replay', { reason: '裁判确认重赛' });
  assert.deepEqual(seriesOf(h.store.state), { a: 2, b: scoreType === 'series' ? 1 : 0 });
  const selected = structuredClone(currentRound(h.store.state)); assert.notEqual(selected.id, old); assert.equal(selected.autoProtected, undefined);
  await h.frame(4); await h.frame(4); assert.deepEqual(currentRound(h.store.state), selected);
  await h.frame(1); await h.frame(3); const run = currentRound(h.store.state).runId;
  assert.ok(run); assert.notEqual(run, h.store.state.rounds.find(r => r.id === old).runId);
  await h.frame(4); await h.frame(4); await h.frame(4);
  assert.deepEqual(seriesOf(h.store.state), { a: 3, b: scoreType === 'series' ? 1 : 0 });
  assert.equal(h.store.state.rounds.filter(r => r.status === 'recorded').length, 1);
});
