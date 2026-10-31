import test from 'node:test';
import assert from 'node:assert/strict';
import { computed, shallowRef } from 'vue';
import { normalizeTosuV2 } from '../src/tosu.js';
import { newSession } from '../server/session/model.js';
import { liveBeatmap, livePlayingMap, liveRoomChat, liveTeamScores, resultTeamScores } from '../ui/liveScores.ts';
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

test('live room scores use tosu sides without manual binding and clear on stale data or incident', () => {
  const { envelope } = fixture();
  for (const connection of ['connecting', 'disconnected', 'error']) assert.equal(liveTeamScores(envelope, connection), null);
  for (const status of ['stale', 'disconnected', 'invalid-data']) {
    const changed = structuredClone(envelope); changed.live.tosu.status = status;
    assert.equal(liveTeamScores(changed, 'synced'), null);
  }
  for (const patch of [{ left: '' }, { right: '' }, { left: '错误房间' }, { right: '错误房间' }, { profile: 'unverified' }]) {
    const changed = structuredClone(envelope); Object.assign(changed.session.auto, patch);
    assert.deepEqual(liveTeamScores(changed, 'synced'), { left: 123456, right: 654321 });
  }
  for (const teams of [{ left: '', right: '右队' }, { left: null, right: '右队' }, { left: '左队', right: '' }]) {
    const changed = structuredClone(envelope); changed.live.tosu.data!.tourney!.teams = teams;
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

test('Playing and Ranking display current totals; Idle cannot leave an old score', () => {
  const { envelope } = fixture();
  for (const ipc of [3, 4]) {
    envelope.live.tosu.data!.tourney!.ipcState = ipc;
    assert.deepEqual(liveTeamScores(envelope, 'synced'), { left: 123456, right: 654321 });
  }
  for (const ipc of [0, 1, 2, null]) {
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

test('current tosu beatmap and its parameters display without joining or binding a room, independently of scores', () => {
  const { envelope } = fixture();
  envelope.live.tosu.data!.tourney = null;
  Object.assign(envelope.session.auto, { left: '', right: '', profile: 'unverified' });
  Object.assign(envelope.live.tosu.data!.beatmap, { title: '本机正在播放', artist: '艺术家', difficulty: '当前难度',
    stats: { stars: { total: 5.4 }, cs: { converted: 4 }, hp: { converted: 5 }, ar: { converted: 9 }, od: { converted: 8 }, bpm: { common: 180 } } });
  const before = JSON.stringify(envelope.session);
  assert.equal(liveTeamScores(envelope, 'synced'), null);
  assert.equal(livePlayingMap(envelope, 'synced')!.title, '本机正在播放');
  assert.equal(liveBeatmap(envelope, 'synced')!.stats!.bpm.common, 180);
  envelope.live.tosu.data!.beatmap.id = 4556723;
  assert.equal(livePlayingMap(envelope, 'synced')!.beatmapId, 4556723);
  assert.equal(JSON.stringify(envelope.session), before);
  for (const status of ['stale', 'disconnected', 'invalid-data']) {
    envelope.live.tosu.status = status;
    assert.equal(livePlayingMap(envelope, 'synced'), null);
    assert.equal(liveBeatmap(envelope, 'synced'), null);
  }
  envelope.live.tosu.status = 'live';
  for (const connection of ['connecting', 'disconnected', 'error']) assert.equal(livePlayingMap(envelope, connection), null);
});


test('Ranking totals appear without a saved result or run and remain read only', () => {
  const { envelope, raw } = fixture();
  raw.tourney.ipcState = 4;
  envelope.live.tosu.data = normalizeTosuV2(raw);
  const before = JSON.stringify(envelope.session);
  assert.deepEqual(resultTeamScores(envelope, 'synced'), { left: 123456, right: 654321 });
  assert.equal(JSON.stringify(envelope.session), before);
  raw.tourney.totalScore = { left: 234567, right: 765432 };
  envelope.live.tosu.data = normalizeTosuV2(raw);
  assert.deepEqual(resultTeamScores(envelope, 'synced'), { left: 234567, right: 765432 });
  for (const status of ['stale', 'disconnected', 'invalid-data']) {
    envelope.live.tosu.status = status;
    assert.equal(resultTeamScores(envelope, 'synced'), null);
  }
});

test('a pending result reads only matching Ranking totals, preserving zero and missing sides', () => {
  const { envelope, raw } = fixture(); raw.tourney.ipcState = 4;
  const entry = { id: 'hr1', beatmapId: 2635981, mod: 'HR', label: 'HR1', title: '', artist: '', difficulty: '' };
  envelope.session.pool = [entry];
  envelope.session.currentRoundId = 'round';
  envelope.session.rounds = [{ id: 'round', entryId: 'hr1', pickedBy: 'a', status: 'ranking', winner: null, runId: null, source: 'manual', finalScore: null, exTeam: null }];
  Object.assign(raw.tourney.totalScore, { left: 0, right: undefined });
  envelope.live.tosu.data = normalizeTosuV2(raw);
  assert.deepEqual(resultTeamScores(envelope, 'synced'), { left: 0, right: null });
  envelope.live.tosu.data!.beatmap.id = 1;
  assert.equal(resultTeamScores(envelope, 'synced'), null);
  envelope.live.tosu.data!.beatmap.id = 2635981;
  envelope.live.tosu.data!.tourney!.ipcState = 3;
  assert.equal(resultTeamScores(envelope, 'synced'), null);
  envelope.session.rounds[0]!.finalScore = { a: 100, b: null };
  assert.deepEqual(resultTeamScores(envelope, 'synced'), { left: 100, right: null });
  envelope.live.tosu.status = 'disconnected';
  assert.deepEqual(resultTeamScores(envelope, 'disconnected'), { left: 100, right: null });
  envelope.session.incident = { roundId: 'round', kind: 'unverified', reason: '', source: 'tosu', at: '' };
  assert.equal(resultTeamScores(envelope, 'synced'), null);
});


test('room chat follows fresh tosu messages through Playing and Ranking without requiring team names', () => {
  const { envelope } = fixture();
  const room = envelope.live.tosu.data!.tourney!;
  room.teams = { left: '', right: '' }; room.chat = [{ name: '测试裁判', message: 'ready' }];
  const before = JSON.stringify(envelope.session);
  for (const ipc of [0, 1, 2, 3, 4, null]) { room.ipcState = ipc; assert.deepEqual(liveRoomChat(envelope, 'synced'), room.chat); }
  assert.deepEqual(liveRoomChat(envelope, 'disconnected'), []);
  envelope.live.tosu.status = 'stale'; assert.deepEqual(liveRoomChat(envelope, 'synced'), []);
  assert.equal(JSON.stringify(envelope.session), before);
});
