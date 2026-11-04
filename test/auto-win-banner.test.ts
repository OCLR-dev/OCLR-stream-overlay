import test from 'node:test';
import assert from 'node:assert/strict';
import { latestAutoWinAward, shortenWinTeamName } from '../ui/autoWinAward.ts';
import type { Session } from '../ui/session.ts';

type AwardSession = Pick<Session, 'history' | 'rounds' | 'currentRoundId'>;
const entry = (source: string, message: string) => ({ id: 'h1', at: '', version: 1, message, source });
const session = (history: AwardSession['history'], rounds: AwardSession['rounds'] = [], currentRoundId: string | null = null): AwardSession =>
  ({ history, rounds, currentRoundId });

test('a live tosu award identifies the winning side from the recorded round', () => {
  const round = { id: 'r1', resultSource: 'tosu', winner: 'b', status: 'recorded' } as Session['rounds'][number];
  const award = latestAutoWinAward(session([entry('tosu', 'tosu 最终队分 3:5 · 自动加赢图')], [round], 'r1'));
  assert.equal(award?.team, 'b');
  assert.equal(award?.id, 'h1');
  assert.equal(award?.left, 3);
  assert.equal(award?.right, 5);
});

test('manual, retracted and series-corrected results never start the celebration', () => {
  const manual = { id: 'r1', resultSource: 'manual', winner: 'a', status: 'recorded' } as Session['rounds'][number];
  assert.equal(latestAutoWinAward(session([entry('manual', '人工记胜 · 左队')], [manual], 'r1')), null);
  const retracted = { id: 'r1', resultSource: 'retracted', winner: null, status: 'ranking' } as Session['rounds'][number];
  assert.equal(latestAutoWinAward(session([entry('manual', '撤回计胜')], [retracted], 'r1')), null);
});

test('the score text remains a fallback when the round record is unavailable', () => {
  assert.equal(latestAutoWinAward(session([entry('tosu', 'tosu 最终队分 7:6 · 自动加赢图')]))?.team, 'a');
  assert.equal(latestAutoWinAward(session([entry('tosu', 'tosu 最终队分 6:7 · 自动加赢图')]))?.team, 'b');
  assert.equal(latestAutoWinAward(session([entry('tosu', 'tosu 最终队分 4:4 · 自动加赢图')])), null);
});

test('the newest automatic award wins when history holds several results', () => {
  const history = [entry('tosu', 'tosu 最终队分 1:0 · 自动加赢图'), entry('tosu', 'tosu 最终队分 1:2 · 自动加赢图')];
  history[1]!.id = 'h2';
  const award = latestAutoWinAward(session(history));
  assert.equal(award?.id, 'h2');
  assert.equal(award?.team, 'b');
});

test('long team names shorten without splitting wide characters', () => {
  assert.equal(shortenWinTeamName('Team Liquid'), 'Team Liquid');
  assert.equal(shortenWinTeamName('一二三四五六七八九十一二三四五六七'), '一二三四五六七八九十一二三四五六…');
  assert.equal(shortenWinTeamName('😀😀😀', 2), '😀😀…');
  assert.equal(shortenWinTeamName('  OCLR  '), 'OCLR');
});
