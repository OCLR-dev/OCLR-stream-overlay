import test from 'node:test';
import assert from 'node:assert/strict';
import { poolDisplay, poolWinner } from '../ui/poolDisplay.ts';
import { newSession } from '../server/session/model.js';
import type { Session, Round } from '../ui/session';

function fixture() {
  const s = newSession() as Session;
  const round: Round = { id: 'r1', entryId: 'nm1', pickedBy: 'a', winner: 'b', status: 'recorded', source: 'manual', runId: null, finalScore: null, exTeam: 'a' };
  s.rounds = [round];
  return { s, round };
}
test('map winner comes from the recorded result independently of Pick and EX, and follows corrections', () => {
  const { s, round } = fixture();
  const before = JSON.stringify(s);
  assert.equal(poolWinner(s, 'nm1'), 'b');
  assert.equal(JSON.stringify(s), before);
  round.winner = 'a';
  assert.equal(poolWinner(s, 'nm1'), 'a');
  round.winner = null;
  assert.equal(poolWinner(s, 'nm1'), null);
});
test('pending, retracted, void and series-only corrections cannot invent a map winner', () => {
  const { s, round } = fixture();
  for (const status of ['prepared', 'playing', 'ranking', 'void'] as const) {
    round.status = status;
    assert.equal(poolWinner(s, 'nm1'), null);
  }
  round.status = 'ranking'; round.resultSource = 'series-correction'; round.winner = null;
  s.seriesAdjustment = { a: 3, b: 1 };
  assert.equal(poolWinner(s, 'nm1'), null);
  assert.equal(poolWinner(s, 'unknown'), null);
});
test('a later active replay hides an older result until its own winner is recorded', () => {
  const { s, round } = fixture();
  const replay = { ...round, id: 'r2', status: 'prepared' as const, winner: null };
  s.rounds.push(replay);
  assert.equal(poolWinner(s, 'nm1'), null);
  s.rounds[1] = { ...replay, status: 'recorded', winner: 'a' };
  assert.equal(poolWinner(s, 'nm1'), 'a');
});

test('TB display has no team Pick attribution even for legacy marks; its recorded winner remains visible', () => {
  const { s, round } = fixture();
  s.pool = [{ id: 'nm1', mod: 'TB' } as Session['pool'][number]];
  s.poolMarks = [{ entryId: 'nm1', status: 'picked', team: 'a' }];
  assert.deepEqual(poolDisplay(s, 'nm1'), { status: 'used', team: null });
  assert.equal(poolWinner(s, 'nm1'), 'b');
  round.status = 'prepared'; round.winner = null;
  assert.deepEqual(poolDisplay(s, 'nm1'), { status: 'picked', team: null });
  assert.equal(poolWinner(s, 'nm1'), null);
});
