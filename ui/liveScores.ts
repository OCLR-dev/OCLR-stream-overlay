import type { Envelope, PoolEntry, Session } from './session';

export function playingPickTeam(session: Session | null | undefined, map: PoolEntry | null) {
  const round = session?.rounds.find(r => r.id === session.currentRoundId);
  if (session?.warmup || !map || map.mod === 'TB' || !round || round.status === 'void' || round.entryId !== map.id) return null;
  return round.pickedBy;
}

function liveTosuData(envelope: Envelope | null | undefined, connection: string | undefined) {
  const source = envelope?.live.tosu;
  return connection === 'synced' && source?.status === 'live' ? source.data : null;
}

export function liveRoom(envelope: Envelope | null | undefined, connection: string | undefined) {
  const room = liveTosuData(envelope, connection)?.tourney;
  return room &&
    room.ipcState !== null && [0, 1, 2, 3, 4].includes(room.ipcState) && room.teams.left?.trim() && room.teams.right?.trim() ? room : null;
}

export function liveRoomChat(envelope: Envelope | null | undefined, connection: string | undefined) {
  return liveTosuData(envelope, connection)?.tourney?.chat || [];
}

// Both Playing and Ranking display the room's current totals. Showing scores
// does not establish a run or provide eligibility for automatic result recording.
export function liveTeamScores(envelope: Envelope | null | undefined, connection: string | undefined) {
  const room = liveRoom(envelope, connection);
  // A result hold never hides fresh room totals. Source validity still applies.
  if (!room || (room.ipcState !== 3 && room.ipcState !== 4)) return null;
  return room.competitionScore?.totalScore ?? room.totalScore;
}

// During Playing the manager totals and client scores arrive on separate ticks.
// Bridge only brief sum mismatches for the same lineup with known scores and Mods.
export function createPlayingScoreDisplay() {
  type Sample = { value: number; at: number };
  let previousKey = '';
  let last: Partial<Record<'left' | 'right', Sample>> = {};
  return (envelope: Envelope | null | undefined, connection: string | undefined) => {
    const scores = liveTeamScores(envelope, connection);
    const room = liveRoom(envelope, connection);
    const fm = room?.competitionScore;
    const session = envelope?.session;
    const at = Date.parse(envelope?.live.tosu.updatedAt || '');
    if (!scores || !session || room?.ipcState !== 3 || fm?.rule !== 'fm-ez-v1' ||
        !fm.players?.length || !Number.isFinite(at) || session.incident) {
      last = {}; previousKey = '';
      return scores;
    }
    const round = session.rounds.find(r => r.id === session.currentRoundId);
    const key = JSON.stringify([session.id, session.warmup, session.currentRoundId, round?.runId,
      envelope?.live.tosu.data?.beatmap.id, fm.entryId, room.teams.left, room.teams.right,
      fm.players.map(p => [p.osuId, p.side, p.mods])]);
    if (key !== previousKey) { last = {}; previousKey = key; }
    const display = { ...scores };
    for (const side of ['left', 'right'] as const) {
      const value = scores[side];
      if (value !== null) { last[side] = { value, at }; continue; }
      const saved = last[side];
      const members = fm.players.filter(p => p.side === side);
      const mismatch = fm.rawTotalScore[side] !== null && members.length > 0 &&
        fm.players.every(p => p.side !== null) && members.every(p => p.score !== null) &&
        members.reduce((sum, p) => sum + p.rawScore!, 0) !== fm.rawTotalScore[side];
      if (saved && mismatch && at >= saved.at && at - saved.at <= 2500) display[side] = saved.value;
      else delete last[side];
    }
    return display;
  };
}

export function resultTeamScores(envelope: Envelope | null | undefined, connection: string | undefined) {
  const session = envelope?.session;
  const round = session?.warmup ? undefined : session?.rounds.find(r => r.id === session.currentRoundId);
  if (session?.incident && session.incident.roundId === round?.id) return null;
  // A recorded score stays available independently of telemetry. Never fill a
  // missing side in that saved snapshot with a different live sample.
  if (round?.finalScore) return { left: round.finalScore.a, right: round.finalScore.b };
  const room = liveRoom(envelope, connection);
  const map = liveBeatmap(envelope, connection);
  if (room?.ipcState !== 4 || !map || session?.incident) return null;
  const entry = session?.pool.find(e => e.id === round?.entryId);
  if (round && entry?.beatmapId !== map.id) return null;
  return room.competitionScore?.totalScore ?? room.totalScore;
}

function validBeatmapId(id: number | null): id is number {
  return id !== null && Number.isSafeInteger(id) && id > 0;
}

function matchingPoolEntry(pool: PoolEntry[], id: number, recordedMap: PoolEntry | null) {
  if (recordedMap?.beatmapId === id) return recordedMap;
  const matches = pool.filter(entry => entry.beatmapId === id);
  return matches.length === 1 ? matches[0] : null;
}

export function consoleNowPlaying(envelope: Envelope | null | undefined, connection: string | undefined, recordedMap: PoolEntry | null = null) {
  const map = liveTosuData(envelope, connection)?.beatmap;
  if (!envelope || !map) return null;
  const id = validBeatmapId(map.id) ? map.id : null;
  const entry = id === null ? null : matchingPoolEntry(envelope.session.pool, id, recordedMap);
  const title = map.title?.trim() || entry?.title?.trim() || (id ? `谱面 ${id}` : '');
  const difficulty = map.difficulty?.trim() || entry?.difficulty?.trim() || '';
  if (!title && !difficulty) return null;
  return { title: title || '曲名未知', difficulty, slot: entry?.label || null };
}

export function livePlayingMap(envelope: Envelope | null | undefined, connection: string | undefined, recordedMap: PoolEntry | null = null): PoolEntry | null {
  const map = liveBeatmap(envelope, connection);
  if (!map) return null;
  const entry = matchingPoolEntry(envelope!.session.pool, map.id, recordedMap);
  if (entry) {
    // Pool imports may contain only a title. Fill display text from the same
    // fresh beatmap without mutating the pool, round or its known mod/slot.
    const text = (saved: string, live: string | null | undefined) => saved?.trim() ? saved : live?.trim() || '';
    return { ...entry, title: text(entry.title, map.title), artist: text(entry.artist, map.artist),
      difficulty: text(entry.difficulty, map.difficulty) };
  }
  // Display the current tosu beatmap independently of room binding and scores.
  // Missing or ambiguous pool slots must not invent a mod/label or write BP.
  return { id: `room-map-${map.id}`, beatmapId: map.id, mod: '', label: '—',
    title: map.title || `谱面 ${map.id}`, artist: map.artist || '', difficulty: map.difficulty || '' };
}

export function liveBeatmap(envelope: Envelope | null | undefined, connection: string | undefined) {
  const data = liveTosuData(envelope, connection);
  const map = data?.beatmap;
  if (!map || !validBeatmapId(map.id)) return null;
  const room = data.tourney;
  const stats = room?.ipcState === 4 && map.rankingStats ? map.rankingStats
    : room && [3, 4].includes(room.ipcState ?? -1) && map.tourneyStats ? map.tourneyStats : map.stats;
  return { ...map, stats, id: map.id };
}
