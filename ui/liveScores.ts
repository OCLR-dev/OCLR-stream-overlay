import type { Envelope, PoolEntry } from './session';

// Playing is a view of the bound room, even when joining mid-map or when BP
// has not prepared a round. Result recording still uses the server's run checks.
export function liveTeamScores(envelope: Envelope | null | undefined, connection: string | undefined) {
  const session = envelope?.session;
  const source = envelope?.live.tosu;
  const room = source?.data?.tourney;
  if (connection !== 'synced' || source?.status !== 'live' || session?.auto.profile !== 'stable-tourney' ||
    !session.auto.left.trim() || !session.auto.right.trim() || session.auto.left === session.auto.right ||
    room?.ipcState !== 3 || room.teams.left !== session.auto.left || room.teams.right !== session.auto.right || session.incident) return null;
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
