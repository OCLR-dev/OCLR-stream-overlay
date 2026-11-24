import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDemoRecapRounds,
  buildRecapRounds,
  dualRosterDensity,
  formatScoreMargin,
  heroRosterDensity,
  isChampionshipRound,
  realRosterMembers,
  recapStripDensity,
  winnerHeadlineTier,
} from '../ui/victoryDisplay.ts';
import { changeField, parseLocation, serializeState } from '../ui/model.ts';

test('only an explicit grand final round crowns a champion', () => {
  for (const round of ['Grand Finals', 'GF', '总决赛']) {
    assert.equal(isChampionshipRound(round), true, round);
  }
  for (const round of [null, undefined, 'Finals', 'BO13', 'Winners Final', 'Losers Final', '胜者组决赛', '半决赛']) {
    assert.equal(isChampionshipRound(round), false, String(round));
  }
});

test('buildRecapRounds keeps only recorded rounds in match order and computes break / TB / margin', () => {
  const pool = [
    { id: 'e1', beatmapId: 101, setId: 201, mod: 'NM', label: 'NM1', title: 'Song One', artist: 'A', difficulty: 'Insane' },
    { id: 'e2', beatmapId: 102, mod: 'DT', label: 'DT2', title: 'Song Two', artist: 'B', difficulty: 'Extra' },
    { id: 'e3', beatmapId: 103, mod: 'TB', label: 'TB', title: 'Tiebreaker Song', artist: 'C', difficulty: 'Extreme' },
  ];
  const rounds = [
    { id: 'r0', entryId: 'e1', pickedBy: 'a' as const, status: 'void' as const, winner: 'b' as const, runId: '1', source: 'tosu', finalScore: { a: 900000, b: 950000 }, exTeam: null },
    { id: 'r1', entryId: 'e1', pickedBy: 'a' as const, status: 'recorded' as const, winner: 'a' as const, runId: '2', source: 'tosu', finalScore: { a: 1250000, b: 1102000 }, exTeam: null },
    { id: 'r2', entryId: 'e2', pickedBy: 'a' as const, status: 'recorded' as const, winner: 'b' as const, runId: '3', source: 'tosu', finalScore: { a: 980000, b: 984200 }, exTeam: 'b' as const },
    { id: 'r3', entryId: 'e3', pickedBy: 'b' as const, status: 'recorded' as const, winner: 'b' as const, runId: '4', source: 'tosu', finalScore: { a: 1100000, b: 1100000 }, exTeam: null },
    { id: 'r4', entryId: 'e2', pickedBy: 'b' as const, status: 'playing' as const, winner: null, runId: '5', source: 'tosu', finalScore: null, exTeam: null },
  ];

  const recap = buildRecapRounds(rounds, pool);
  assert.equal(recap.length, 3);
  assert.equal(recap[0]!.label, 'NM1');
  assert.equal(recap[0]!.isBreak, false);
  assert.equal(recap[0]!.marginText, '+148k');
  assert.equal(recap[0]!.setId, 201);

  assert.equal(recap[1]!.label, 'DT2');
  assert.equal(recap[1]!.isBreak, true);
  assert.equal(recap[1]!.exTeam, 'b');
  assert.equal(recap[1]!.marginText, "+4'200");

  // TB clears pickedBy and never flags as a break
  assert.equal(recap[2]!.label, 'TB');
  assert.equal(recap[2]!.pickedBy, null);
  assert.equal(recap[2]!.isBreak, false);
  assert.equal(recap[2]!.marginText, '平分');
  assert.equal(formatScoreMargin(null), null);
});

test('realRosterMembers omits placeholder cards when a match has no entered roster', () => {
  const placeholders = [
    { team: 'a' as const, id: 'a-slot-1', slot: 1, role: '', syntheticEx: false, placeholder: true, name: null, osuId: null },
  ];
  const actual = [
    { team: 'a' as const, id: 'a-full-1', slot: 1, role: 'Captain', syntheticEx: false, placeholder: false, name: 'Alice', osuId: 1001 },
    { team: 'a' as const, id: 'a-full-2', slot: 2, role: 'T1', syntheticEx: false, placeholder: false, name: 'Bob', osuId: null },
  ];
  assert.deepEqual(realRosterMembers(placeholders, false), []);
  assert.deepEqual(realRosterMembers(placeholders, true), []);
  assert.equal(realRosterMembers(actual, true).length, 2);
});

test('density helpers, headline tiers and demo winner URL state cover boundary sizes', () => {
  assert.equal(heroRosterDensity(4), 'hero-wide');
  assert.equal(heroRosterDensity(6), 'hero-row');
  assert.equal(heroRosterDensity(8), 'grid-4');
  assert.equal(heroRosterDensity(12), 'grid-6');
  assert.equal(heroRosterDensity(16), 'grid-ultra');

  assert.equal(dualRosterDensity(4), 'dual-2x2');
  assert.equal(dualRosterDensity(6), 'dual-3x2');
  assert.equal(dualRosterDensity(8), 'dual-4x2');
  assert.equal(dualRosterDensity(10), 'dual-dense');
  assert.equal(dualRosterDensity(16), 'dual-ultra');

  assert.equal(recapStripDensity(8), 'spacious');
  assert.equal(recapStripDensity(13), 'compact');
  assert.equal(recapStripDensity(14), 'ultra');
  assert.equal(recapStripDensity(20), 'ultra');
  assert.equal(recapStripDensity(21), 'dense');
  assert.equal(recapStripDensity(99), 'dense');

  assert.equal(winnerHeadlineTier('模拟红队'), 'xl');
  assert.equal(winnerHeadlineTier('隔离验证红队 · 中等长度队名'), 'md');
  assert.equal(winnerHeadlineTier('这是一个非常非常非常长用来测试极端防爆版换行的超级无敌队伍名称'), 'sm');

  assert.equal(buildDemoRecapRounds('pending', 'group').length, 0);
  assert.equal(buildDemoRecapRounds('a', 'final').at(-1)?.mod, 'TB');
  assert.equal(buildDemoRecapRounds('draw', 'group').length, 4);

  const initial = parseLocation('', 'scene=victory');
  assert.equal(initial.winnerDemo, 'pending');
  const updated = changeField(initial, 'winnerDemo', 'b');
  assert.equal(updated.winnerDemo, 'b');
  assert.deepEqual(parseLocation('', serializeState(updated)), updated);

});
