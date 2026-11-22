import { currentRound, entryOf } from './model.js';

const slots = { left: [0, 1, 2], right: [4, 5, 6] };
export const validScore = value => Number.isSafeInteger(value) && value >= 0;

export function fixedExRound(state) {
  const round = currentRound(state);
  const entry = entryOf(state, round?.entryId);
  const mode = (round?.runId && round.exMode) || state.match.mode;
  if (mode !== '4v4' || !['a', 'b'].includes(round?.exTeam) || round.status === 'void' || !entry || entry.mod === 'TB') return null;
  return { round, entry };
}

function contextKey(state, frame, { round, entry }) {
  const room = frame?.tourney;
  if (entry.beatmapId !== frame?.beatmap?.id || !room?.teams?.left?.trim() || !room.teams.right?.trim()) return null;
  return JSON.stringify([state.id, round.id, entry.beatmapId, entry.mod, round.exTeam,
    state.auto.wsUrl, room.teams.left, room.teams.right]);
}

function fixedPlayers(room) {
  const clients = room.players || [];
  const lineup = Object.entries(slots).flatMap(([side, ids]) => ids.map(ipcId => {
    const matches = clients.filter(player => player.ipcId === ipcId);
    const player = matches[0];
    return matches.length === 1 && player.side === side && Number.isSafeInteger(player.osuId) && player.osuId > 0 ? player : null;
  }));
  return lineup.map(player => player && lineup.filter(other => other?.osuId === player.osuId).length === 1 ? player : null);
}

// Keep one witness per active slot. The start reset must be seen in Playing:
// Ready and the first Playing frames can still carry scores from a prior play.
export function observeExScores(previous, state, frame, now) {
  const context = fixedExRound(state);
  if (!context) return null;
  const key = contextKey(state, frame, context);
  const ipc = frame?.tourney?.ipcState;
  const { round } = context;
  if (!key) return null;
  if ([1, 2].includes(ipc) && (round.status === 'prepared' || round.status === 'playing' && !previous?.players)) {
    return { key, at: now, runId: round.runId, players: null, objectCount: null };
  }
  if (previous?.key !== key || now < previous.at || now - previous.at > 5000 ||
    (previous.runId && previous.runId !== round.runId)) return null;
  if (ipc === 0 && !previous.players) return { ...previous, at: now };
  if (ipc === 4 && previous.players) return { ...previous, at: now, runId: round.runId };
  if (ipc !== 3 || !['prepared', 'playing'].includes(round.status)) return null;
  const objectCount = frame.beatmap.stats?.objects?.total;
  const players = fixedPlayers(frame.tourney).map((player, index) => {
    const old = previous.players?.[index];
    if (!player || !validScore(player.score) || !validScore(player.judgements)) return old ?? null;
    if (!old) return player.score === 0 && player.judgements === 0
      ? { osuId: player.osuId, score: 0, judgements: 0 } : null;
    if (old.osuId !== player.osuId || player.score < old.score || player.judgements < old.judgements) return old;
    return { osuId: player.osuId, score: player.score, judgements: player.judgements };
  });
  return { key, at: now, runId: round.runId, players,
    objectCount: Number.isSafeInteger(objectCount) && objectCount > 0 ? objectCount : previous.objectCount };
}

export function exPlayerScores(state, frame, context, evidence) {
  const ipc = frame?.tourney?.ipcState;
  const key = contextKey(state, frame, context);
  if (!key || evidence?.key !== key || !evidence.players || ![3, 4].includes(ipc) ||
    (evidence.runId && evidence.runId !== context.round.runId)) return [];
  return fixedPlayers(frame.tourney).flatMap((player, index) => {
    const observed = evidence.players[index];
    if (!player || !observed || player.osuId !== observed.osuId || !validScore(player.score) ||
      !validScore(player.judgements) || player.judgements < observed.judgements) return [];
    if (ipc === 3 && (player.score !== observed.score || player.judgements !== observed.judgements)) return [];
    // Ranking can precede some viewers' last judgements. A complete chart for
    // every locked player and the ordinary stable Ranking window are required.
    if (ipc === 4 && (player.judgements !== evidence.objectCount ||
      context.round.status !== 'recorded' && player.score < observed.score)) return [];
    return [player];
  });
}

export function exRosterMissing(room, evidence) {
  if (!evidence?.players) return false;
  const players = fixedPlayers(room);
  return evidence.players.some((player, index) => player && players[index]?.osuId !== player.osuId);
}
