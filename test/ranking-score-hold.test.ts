import test from 'node:test';
import assert from 'node:assert/strict';
import { retainRankingScores } from '../ui/rankingScoreHold.ts';
const fixture = () => ({ session: { id: 'match-1', currentRoundId: 'round-1', auto: { left: 'L', right: 'R' }, incident: null,
  pool: [{ id: 'map', beatmapId: 101 }], rounds: [{ id: 'round-1', entryId: 'map', status: 'ranking', finalScore: { a: 1234, b: 1000 } }] },
  live: { tosu: { status: 'live', data: { beatmap: { id: 101 }, tourney: { ipcState: 4, scoreVisible: true, totalScore: { left: 1234, right: 1000 } } } } } } as any);
for (const scene of ['playing', 'map-result']) test(`${scene} holds final totals through hidden zeros, Idle and disconnection until Mappool`, () => {
  const value = fixture(); let held = retainRankingScores(value, 'synced', scene, null);
  assert.deepEqual(held?.scores, { left: 1234, right: 1000 });
  Object.assign(value.live.tosu.data.tourney, { scoreVisible: false, totalScore: { left: 0, right: 0 } });
  held = retainRankingScores(value, 'synced', scene, held); assert.deepEqual(held?.scores, { left: 1234, right: 1000 });
  value.live.tosu.data.tourney.ipcState = 1; held = retainRankingScores(value, 'synced', scene, held); assert.deepEqual(held?.scores, { left: 1234, right: 1000 });
  value.live.tosu.status = 'disconnected'; held = retainRankingScores(value, 'disconnected', scene, held); assert.deepEqual(held?.scores, { left: 1234, right: 1000 });
  assert.equal(retainRankingScores(value, 'disconnected', 'mappool', held), null);
});
test('a live Ranking display without a round retains its complete pair and never mixes missing sides', () => {
  const value = fixture(); value.session.rounds = []; value.session.currentRoundId = null;
  const held = retainRankingScores(value, 'synced', 'map-result', null); assert.deepEqual(held?.scores, { left: 1234, right: 1000 });
  value.live.tosu.data.tourney.totalScore = { left: null, right: 1500 };
  assert.deepEqual(retainRankingScores(value, 'synced', 'map-result', held)?.scores, { left: 1234, right: 1000 });
  value.live.tosu.data.tourney.totalScore = { left: 0, right: 1000 };
  assert.deepEqual(retainRankingScores(value, 'synced', 'map-result', held)?.scores, { left: 0, right: 1000 });
});
test('a new match, round, room or Playing cannot inherit an old displayed result', () => {
  const original = fixture(); const held = retainRankingScores(original, 'synced', 'map-result', null);
  for (const change of [
    (value: any) => { value.session.id = 'other'; },
    (value: any) => { value.session.rounds[0].id = 'other'; value.session.currentRoundId = 'other'; },
    (value: any) => { value.session.auto.left = 'other'; },
    (value: any) => { value.live.tosu.data.tourney.ipcState = 3; },
  ]) {
    const value = fixture(); change(value); value.session.rounds[0].finalScore = null; value.live.tosu.data.tourney.scoreVisible = false;
    assert.equal(retainRankingScores(value, 'synced', 'map-result', held), null);
  }
});
test('visible corrections replace the complete pair while real incidents keep disputed scores unknown', () => {
  const value = fixture(); const held = retainRankingScores(value, 'synced', 'map-result', null);
  value.session.rounds[0].finalScore = { a: 1100, b: 1400 };
  assert.deepEqual(retainRankingScores(value, 'synced', 'map-result', held)?.scores, { left: 1100, right: 1400 });
  value.session.incident = { roundId: 'round-1' }; assert.equal(retainRankingScores(value, 'synced', 'map-result', held), null);
});
