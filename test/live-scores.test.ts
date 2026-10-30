import test from 'node:test';
import assert from 'node:assert/strict';
import { computed, shallowRef } from 'vue';
import { normalizeTosuV2 } from '../src/tosu.js';
import { newSession } from '../server/session/model.js';
import { livePlayingMap, liveTeamScores } from '../ui/liveScores.ts';
import type { Envelope } from '../ui/session';

function fixture() {
  const session = newSession();
  Object.assign(session.auto, { profile: 'stable-tourney', left: '测试左队', right: '测试右队' });
  const raw = { state: { number: 2, name: 'Playing' }, beatmap: { id: 2635981 },
    tourney: { ipcState: 3, team: { left: '测试左队', right: '测试右队' }, totalScore: { left: 123456, right: 654321 } } };
  const envelope = { session, live: { tosu: { status: 'live', data: normalizeTosuV2(raw) } } } as Envelope;
  return { envelope, raw };
}

test('joining Playing without a BP round shows changing room scores without creating a round or result', () => {
  const { envelope, raw } = fixture();
  const before = JSON.stringify(envelope.session);
  const snapshot = shallowRef(envelope);
  const scores = computed(() => liveTeamScores(snapshot.value, 'synced'));
  assert.equal(envelope.session.currentRoundId, null);
  assert.deepEqual(envelope.session.pool, []);
  assert.deepEqual(envelope.session.rounds, []);
  assert.deepEqual(scores.value, { left: 123456, right: 654321 });
  raw.tourney.totalScore = { left: 234567, right: 765432 };
  snapshot.value = { ...envelope, live: { ...envelope.live, tosu: { ...envelope.live.tosu, data: normalizeTosuV2(raw) } } };
  assert.deepEqual(scores.value, { left: 234567, right: 765432 });
  assert.equal(JSON.stringify(envelope.session), before);
});

test('live room score display clears on stale/disconnected data, wrong room, missing binding and incident', () => {
  const { envelope } = fixture();
  for (const connection of ['connecting', 'disconnected', 'error']) assert.equal(liveTeamScores(envelope, connection), null);
  for (const status of ['stale', 'disconnected', 'invalid-data']) {
    const changed = structuredClone(envelope); changed.live.tosu.status = status;
    assert.equal(liveTeamScores(changed, 'synced'), null);
  }
  for (const patch of [{ left: '' }, { right: '' }, { left: '错误房间' }, { right: '错误房间' }, { profile: 'unverified' }]) {
    const changed = structuredClone(envelope); Object.assign(changed.session.auto, patch);
    assert.equal(liveTeamScores(changed, 'synced'), null);
  }
  envelope.session.incident = { roundId: 'test', kind: 'unverified', reason: '', source: 'manual', at: '' };
  assert.equal(liveTeamScores(envelope, 'synced'), null);
});

test('zero and partial missing totals stay distinct without falling back to saved result scores', () => {
  const { envelope, raw } = fixture();
  Object.assign(raw.tourney.totalScore, { left: 0, right: undefined });
  envelope.live.tosu.data = normalizeTosuV2(raw);
  assert.deepEqual(liveTeamScores(envelope, 'synced'), { left: 0, right: null });
});

test('only current IPC 3 totals are displayed; Idle and Ranking cannot leave an old Playing score', () => {
  const { envelope } = fixture();
  for (const ipc of [0, 1, 2, 4, null]) {
    envelope.live.tosu.data!.tourney!.ipcState = ipc;
    assert.equal(liveTeamScores(envelope, 'synced'), null);
  }
});

test('room map display needs no pool or round and cannot show the stale prepared map', () => {
  const { envelope } = fixture();
  Object.assign(envelope.live.tosu.data!.beatmap, { title: '房间当前谱面', artist: '房间艺术家', difficulty: '当前难度' });
  const prepared = { id: 'old', beatmapId: 1, mod: 'HR', label: 'HR1', title: '旧准备图', artist: '', difficulty: '' };
  const before = JSON.stringify(envelope.session);
  const display = livePlayingMap(envelope, 'synced', prepared)!;
  assert.equal(display.beatmapId, 2635981); assert.equal(display.title, '房间当前谱面'); assert.equal(display.mod, '');
  assert.equal(JSON.stringify(envelope.session), before);
  assert.equal(livePlayingMap(envelope, 'disconnected', prepared), null);
  envelope.live.tosu.data!.beatmap.id = null; assert.equal(livePlayingMap(envelope, 'synced', prepared), null);
});

test('duplicate beatmap IDs preserve a known round slot but never guess the first mod without a round', () => {
  const { envelope } = fixture();
  const entry = { id: 'nm1', beatmapId: 2635981, mod: 'NM', label: 'NM1', title: '同一谱面', artist: '', difficulty: '' };
  const hr = { ...entry, id: 'hr1', mod: 'HR', label: 'HR1' };
  envelope.session.pool = [entry, hr];
  assert.equal(livePlayingMap(envelope, 'synced', hr)!.label, 'HR1');
  assert.equal(livePlayingMap(envelope, 'synced')!.label, '—');
  envelope.session.pool = [hr]; assert.equal(livePlayingMap(envelope, 'synced')!.label, 'HR1');
});
