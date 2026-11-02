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
  assert.match(hint(s), /开播前设置/);
});
