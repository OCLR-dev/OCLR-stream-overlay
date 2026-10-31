import type { Envelope, PoolEntry } from './session';

export function liveRoom(envelope: Envelope | null | undefined, connection: string | undefined) {
  const source = envelope?.live.tosu;
  const room = source?.data?.tourney;
  return connection === 'synced' && source?.status === 'live' && room &&
    room.ipcState !== null && [0, 1, 2, 3, 4].includes(room.ipcState) && room.teams.left?.trim() && room.teams.right?.trim() ? room : null;
}

// Both Playing and Ranking display the room's current totals. Showing scores
// does not establish a run or provide eligibility for automatic result recording.
export function liveTeamScores(envelope: Envelope | null | undefined, connection: string | undefined) {
  const session = envelope?.session;
  const room = liveRoom(envelope, connection);
  if (!room || (room.ipcState !== 3 && room.ipcState !== 4) || session?.incident) return null;
  return room.totalScore;
}

export function resultTeamScores(envelope: Envelope | null | undefined, connection: string | undefined) {
  const session = envelope?.session;
  const round = session?.rounds.find(r => r.id === session.currentRoundId);
  if (session?.incident && session.incident.roundId === round?.id) return null;
  // A recorded score stays available independently of telemetry. Never fill a
  // missing side in that saved snapshot with a different live sample.
  if (round?.finalScore) return { left: round.finalScore.a, right: round.finalScore.b };
  const room = liveRoom(envelope, connection);
  const map = liveBeatmap(envelope, connection);
  if (room?.ipcState !== 4 || !map || session?.incident) return null;
  const entry = session?.pool.find(e => e.id === round?.entryId);
  if (round && entry?.beatmapId !== map.id) return null;
  return room.totalScore;
}

export function livePlayingMap(envelope: Envelope | null | undefined, connection: string | undefined, recordedMap: PoolEntry | null = null): PoolEntry | null {
  const map = liveBeatmap(envelope, connection);
  if (!map) return null;
  if (recordedMap?.beatmapId === map.id) return recordedMap;
  const matches = envelope!.session.pool.filter(entry => entry.beatmapId === map.id);
  if (matches.length === 1) return matches[0]!;
  // Display the current tosu beatmap independently of room binding and scores.
  // Missing or ambiguous pool slots must not invent a mod/label or write BP.
  return { id: `room-map-${map.id}`, beatmapId: map.id, mod: '', label: '—',
    title: map.title || `谱面 ${map.id}`, artist: map.artist || '', difficulty: map.difficulty || '' };
}

export function liveBeatmap(envelope: Envelope | null | undefined, connection: string | undefined) {
  const source = envelope?.live.tosu;
  const map = source?.data?.beatmap;
  if (connection !== 'synced' || source?.status !== 'live' || !map?.id || !Number.isSafeInteger(map.id) || map.id <= 0) return null;
  return { ...map, id: map.id };
}
