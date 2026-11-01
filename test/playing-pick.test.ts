import test from 'node:test';
import assert from 'node:assert/strict';
import { newSession } from '../server/session/model.js';
import { playingPickTeam } from '../ui/liveScores.ts';
import type { Session, PoolEntry } from '../ui/session';

const map: PoolEntry = { id: 'nm1', beatmapId: 123, mod: 'NM', label: 'NM1', title: '', artist: '', difficulty: '' };
function fixture() {
  const session = newSession() as Session;
  session.currentRoundId = 'current';
  session.rounds = [{ id: 'current', entryId: map.id, pickedBy: 'a', status: 'prepared', winner: null, runId: null, source: 'manual', finalScore: null, exTeam: 'b' }];
  return session;
}

test('Playing Pick follows the current round through preparation, play and Ranking, independently of EX and winner', () => {
  const session = fixture();
  for (const status of ['prepared', 'playing', 'ranking', 'recorded'] as const) {
    session.rounds[0]!.status = status;
    session.rounds[0]!.winner = 'b';
    assert.equal(playingPickTeam(session, map), 'a');
  }
  session.rounds[0]!.pickedBy = 'b';
  assert.equal(playingPickTeam(session, map), 'b');
});

test('room map changes and ambiguous duplicate slots cannot borrow an old Pick', () => {
  const session = fixture();
  assert.equal(playingPickTeam(session, { ...map, id: 'room-map-456', beatmapId: 456 }), null);
  assert.equal(playingPickTeam(session, { ...map, id: 'nm2' }), null);
  session.currentRoundId = null;
  session.poolMarks = [{ entryId: map.id, status: 'picked', team: 'b' }];
  assert.equal(playingPickTeam(session, map), null);
});

test('unknown, void and TB show no team ownership and rendering does not mutate records', () => {
  const session = fixture();
  const before = JSON.stringify(session);
  assert.equal(playingPickTeam(session, null), null);
  assert.equal(playingPickTeam(null, map), null);
  assert.equal(playingPickTeam(session, { ...map, mod: 'TB' }), null);
  assert.equal(JSON.stringify(session), before);
  session.rounds[0]!.status = 'void';
  assert.equal(playingPickTeam(session, map), null);
});
