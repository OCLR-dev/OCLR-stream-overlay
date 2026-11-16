import test from 'node:test';
import assert from 'node:assert/strict';
import { operatorNextStep } from '../ui/operatorHints.ts';
import { newSession } from '../server/session/model.js';
import type { Round, Session } from '../ui/session';

function fixture(status?: Round['status']) {
  const s = { ...newSession(), series: { a: 0, b: 0 } } as Session;
  if (status) {
    s.rounds = [{ id: 'r', entryId: 'm', status, pickedBy: 'a', winner: null, runId: null, source: 'manual', finalScore: null, exTeam: null }];
    s.currentRoundId = 'r';
  }
  return s;
}
const hint = (s: Session, panel: 'mappool' | 'playing' | 'roll' = 'mappool', connection = 'synced') => operatorNextStep(s, panel, connection, false, 6);

test('reconnect, explicit pause and incidents outrank normal BP and TB suggestions', () => {
  const s = fixture();
  s.bp = { tiebreaker: { eligible: true, active: false, canPrepare: true, reason: 'TB 可准备' } } as Session['bp'];
  s.incident = { kind: 'spectator', roundId: 'r', reason: 'internal details', source: 'tosu', at: '' };
  assert.match(hint(s), /处理异常/); assert.doesNotMatch(hint(s), /TieBreaker|internal details/);
  s.paused = true; assert.match(hint(s), /返回原画面/);
  assert.match(hint(s, 'mappool', 'disconnected'), /重连/);
});

test('viewing Mappool during actual play does not tell the operator to prepare another Pick', () => {
  const s = fixture('playing'); s.poolChoice = { team: 'b', kind: 'pick' };
  assert.match(hint(s), /仍在比赛/); assert.doesNotMatch(hint(s), /请选择本图/);
});

test('pending Ranking stays unconfirmed even when displayed series has reached the target', () => {
  const s = fixture('ranking'); s.series.a = 6;
  assert.match(hint(s), /等待成绩确认/); assert.doesNotMatch(hint(s), /展示 Winner/);
  s.auto.results = false; assert.match(hint(s), /核对后记胜/);
});

test('equal completed scores point to the referee replay action before the client restarts', () => {
  for (const results of [true, false]) for (const total of [0, 1000]) {
    const s = fixture('ranking'); s.auto.results = results;
    s.rounds[0]!.finalScore = { a: total, b: total };
    assert.match(hint(s, 'playing'), /队分相同.*裁判确认重赛.*处理异常.*裁判已要求重赛本图.*重新开打/);
    assert.doesNotMatch(hint(s, 'playing'), /校正系列比分|记录本图平局/);
  }
});

test('countable exhibition draws point to draw recording instead of requiring a replay', () => {
  const s = fixture('ranking'); s.match.stage = 'exhibition';
  s.match.exhibition = { roundName: '测试阶段', series: { type: 'fixed_maps', count: 3, allowDraw: true }, tiedMapPolicy: 'count_as_draw', autoResults: true };
  s.rounds[0]!.finalScore = { a: 1000, b: 1000 };
  assert.match(hint(s, 'playing'), /允许逐图平局.*裁判核对.*记录本图平局/);
  assert.doesNotMatch(hint(s, 'playing'), /确认重赛/);
  s.match.exhibition.tiedMapPolicy = 'require_replay';
  assert.match(hint(s, 'playing'), /裁判已要求重赛本图/);
});

test('missing, unequal and unconfirmed scores do not claim a tied result', () => {
  for (const finalScore of [null, { a: null, b: null }, { a: 0, b: null }, { a: 1000, b: 999 }, { a: NaN, b: NaN }]) {
    const s = fixture('ranking'); s.rounds[0]!.finalScore = finalScore;
    assert.doesNotMatch(hint(s, 'playing'), /队分相同|确认重赛|记录本图平局/);
  }
  const s = fixture('playing'); s.rounds[0]!.finalScore = { a: 1000, b: 1000 };
  assert.doesNotMatch(hint(s, 'playing'), /队分相同|确认重赛/);
  s.rounds[0]!.status = 'ranking'; s.rounds[0]!.resultSource = 'series-correction';
  assert.doesNotMatch(hint(s, 'playing'), /队分相同|确认重赛/);
});

test('aggregate corrections and recorded results direct the operator onward without another win entry', () => {
  const s = fixture('ranking'); s.rounds[0]!.resultSource = 'series-correction';
  assert.match(hint(s, 'playing'), /无需重复记胜/);
  s.rounds[0]!.status = 'recorded'; s.series.a = 6;
  assert.match(hint(s, 'playing'), /核对后.*Winner/);
});

test('TB instructions point to the existing button and handle ambiguous or corrected setup', () => {
  const s = fixture(); s.pool = [{ id: 'tb', mod: 'TB' } as Session['pool'][number]];
  s.bp = { tiebreaker: { eligible: true, active: false, canPrepare: true, reason: '' } } as Session['bp'];
  assert.match(hint(s), /点击 TieBreaker/); assert.match(hint(s, 'playing'), /切到图池/);
  s.pool.push({ id: 'tb2', mod: 'TB' } as Session['pool'][number]); assert.match(hint(s), /唯一决胜图/);
  s.bp!.tiebreaker!.active = true; s.bp!.tiebreaker!.eligible = false;
  s.rounds = fixture('prepared').rounds; s.currentRoundId = 'r';
  assert.match(hint(s), /核对决胜比分/);
});

test('room scores without a tracked round remain broadcastable without fabricating a result', () => {
  const s = fixture();
  assert.match(operatorNextStep(s, 'playing', 'synced', true, 6), /可继续播出/);
  assert.match(hint(s), /比赛配置/);
});

test('Ranking hints follow actual scene automation; missed finishes require manual results', () => {
  const s = fixture('recorded');
  assert.match(operatorNextStep(s, 'playing', 'synced', true, 6, '', 4), /自动回到图池/);
  s.auto.scenes = false;
  assert.doesNotMatch(operatorNextStep(s, 'playing', 'synced', true, 6, '', 4), /自动回到图池/);
  s.rounds[0]!.status = 'ranking'; s.rounds[0]!.resultSource = 'manual-finish';
  assert.match(hint(s, 'playing'), /核对后记录胜方/);
});

test('a blocked room map names the recovery command after the room finishes', () => {
  const review = { kind: 'pick', stage: 'finished', roundId: 'r', preparedLabel: 'NM1',
    roomLabel: 'HD1', entryId: null, unavailableReason: '已被 Ban' } as const;
  const message = operatorNextStep(fixture('prepared'), 'mappool', 'synced', false, 6, '', 1, review);
  assert.match(message, /NM1.*HD1.*已被 Ban.*已结算.*未计胜/);
  assert.match(message, /比赛纠错.*作废当前选图，重新 BP/);
});
