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
  if (!liveTeamScores(envelope, connection)) return null;
  const map = envelope?.live.tosu.data?.beatmap;
  if (!map?.id || !Number.isSafeInteger(map.id) || map.id <= 0) return null;
  if (recordedMap?.beatmapId === map.id) return recordedMap;
  const matches = envelope!.session.pool.filter(entry => entry.beatmapId === map.id);
  if (matches.length === 1) return matches[0]!;
  // Missing or ambiguous pool slots must not invent a mod/label. The room
  // beatmap can still be shown without writing it into the pool or BP history.
  return { id: `room-map-${map.id}`, beatmapId: map.id, mod: '', label: '—',
    title: map.title || `谱面 ${map.id}`, artist: map.artist || '', difficulty: map.difficulty || '' };
}
