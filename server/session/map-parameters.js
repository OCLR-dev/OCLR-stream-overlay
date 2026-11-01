import { currentRound } from './model.js';

const attributes = stats => [stats?.stars?.total, ...['cs', 'hp', 'ar', 'od'].map(key => stats?.[key]?.converted), stats?.bpm?.common, stats?.clockRate];
const known = value => typeof value === 'number' && Number.isFinite(value);

// Volatile display memory, separate from raw telemetry and result recording.
// Retain one whole observed row, including mixed-FM unknowns; never assemble
// a synthetic row from different client samples or use root NM as a fallback.
export function rankingMapParameters(session, frame, previous) {
  const map = frame?.beatmap; const room = frame?.tourney;
  const stats = map?.tourneyStats;
  if (session.paused || session.incident || !map?.id || ![3, 4].includes(room?.ipcState) ||
    !stats || stats.availability === 'mismatched') return { frame, hold: null };
  const round = currentRound(session);
  const key = JSON.stringify([session.id, round?.id || null, round?.runId || null, map.id, map.checksum || null,
    room.teams?.left, room.teams?.right, session.match.mode, session.ex.team]);
  const players = room.players || [];
  const context = players.length && players.every(p => p.osuId > 0 && p.mods?.trim())
    ? JSON.stringify(players.map(p => [p.side, p.osuId, p.mods]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))) : null;
  if (room.ipcState === 3 || ['ready', 'mixed'].includes(stats.availability)) {
    return { frame, hold: { key, context, stats: structuredClone(stats) } };
  }
  if (room.ipcState !== 4 || stats.availability !== 'missing' || previous?.key !== key ||
    context && previous.context && context !== previous.context) return { frame, hold: null };
  const old = attributes(previous.stats);
  if (attributes(stats).some((value, i) => known(value) && value !== old[i])) return { frame, hold: null };
  if (Object.entries(stats.ranges || {}).some(([key, range]) => range &&
    (range.min !== previous.stats.ranges?.[key]?.min || range.max !== previous.stats.ranges?.[key]?.max))) return { frame, hold: null };
  return { frame: { ...frame, beatmap: { ...map, rankingStats: structuredClone(previous.stats) } }, hold: previous };
}
