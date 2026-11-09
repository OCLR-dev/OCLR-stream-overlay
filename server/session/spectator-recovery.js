import { randomUUID } from 'node:crypto';
import { observedTransition, observation, currentRound, entryOf, seriesComplete } from './model.js';

const keyOf = state => {
  const round = currentRound(state);
  if (state.paused || seriesComplete(state) || round?.status !== 'playing' || !round.runId || state.auto.profile !== 'stable-tourney' ||
    !(state.auto.bp || state.auto.scenes || state.auto.results)) return null;
  return JSON.stringify([state.id, round.id, round.runId, entryOf(state, round.entryId)?.beatmapId,
    state.auto.left, state.auto.right, state.auto.wsUrl, state.match.mode, round.exTeam]);
};
const incidentKey = state => state.incident?.source === 'tosu' && state.incident.kind === 'unverified' &&
  state.incident.roundId === state.currentRoundId ? JSON.stringify(state.incident) : null;
const sameContext = (state, frame) => {
  const room = frame?.tourney; const id = frame?.beatmap?.id;
  return room && [0, 3].includes(room.ipcState) &&
    (!Number.isSafeInteger(id) || id <= 0 || id === entryOf(state, currentRound(state)?.entryId)?.beatmapId) &&
    (!room.teams?.left?.trim() || room.teams.left === state.auto.left) &&
    (!room.teams?.right?.trim() || room.teams.right === state.auto.right);
};
const sample = (state, frame) => {
  const room = frame?.tourney;
  if (!sameContext(state, frame) || room.ipcState !== 3 || frame.beatmap?.id !== entryOf(state, currentRound(state)?.entryId)?.beatmapId ||
    room.teams.left !== state.auto.left || room.teams.right !== state.auto.right || !room.players?.length) return null;
  const players = new Map();
  for (const player of room.players) {
    if (!['left', 'right'].includes(player.side) || !Number.isSafeInteger(player.osuId) || player.osuId <= 0 ||
      !Number.isSafeInteger(player.score) || player.score < 0) return null;
    const key = `${player.side}:${player.osuId}`;
    if (players.has(key)) return null;
    players.set(key, player.score);
  }
  if (!['left', 'right'].every(side => {
    const values = [...players].filter(([key]) => key.startsWith(`${side}:`));
    return values.length > 0 && Number.isSafeInteger(room.totalScore?.[side]) &&
      values.reduce((total, [, score]) => total + score, 0) === room.totalScore[side];
  })) return null;
  return players;
};
const progresses = (previous, next) => previous.size === next.size && [...previous].every(([key, score]) => next.has(key) && next.get(key) >= score);

// Volatile evidence for a spectator reload, never a persisted permission to
// finish a map. Ready/Ranking, identity changes and human decisions invalidate it.
export class SpectatorRecovery {
  constructor() { this.reset(); }
  checkpoint() { return structuredClone({ ...this }); }
  restoreEvidence(checkpoint) { Object.assign(this, checkpoint); }
  reset() { this.anchor = null; this.pending = null; }
  recover(state, frame, now) {
    const pending = this.pending;
    if (!pending) return state;
    if (pending.key !== keyOf(state) || pending.incident !== incidentKey(state) ||
      now < pending.at || now - pending.at > 30000 || now < pending.lastAt || now - pending.lastAt > 5000 || !sameContext(state, frame)) {
      this.reset(); return state;
    }
    pending.lastAt = now;
    const scores = sample(state, frame);
    if (!scores || !progresses(pending.scores, scores) || pending.ready && !progresses(pending.ready.scores, scores)) {
      pending.ready = null; return state;
    }
    if (!pending.ready) { pending.ready = { at: now, scores }; return state; }
    pending.ready.scores = scores;
    if (now - pending.ready.at < 250) return state;
    this.reset();
    return observedTransition(state, observation(state, 'recover-spectator', {}, currentRound(state)),
      '观战重载后同图同组选手 Playing 与分数恢复：自动继续原局（保留原 run）', randomUUID(), { undo: false });
  }
  observe(state, frame, now) {
    if (this.pending) return;
    const key = keyOf(state); const incident = incidentKey(state);
    if (incident) {
      if (this.anchor?.key === key && now >= this.anchor.at && now - this.anchor.at <= 5000 && sameContext(state, frame)) {
        this.pending = { ...this.anchor, incident, lastAt: now, ready: null };
      }
      this.anchor = null; return;
    }
    const scores = !state.incident && key && sample(state, frame);
    this.anchor = scores ? { key, scores, at: now } : null;
  }
}
