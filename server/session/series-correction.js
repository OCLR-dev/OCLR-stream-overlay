import { currentRound, entryOf } from './model.js';
import { tosuRoomTeams } from '../../src/tosu.js';

const keyOf = state => {
  const round = currentRound(state); const map = entryOf(state, round?.entryId);
  return round && map ? JSON.stringify([state.id, round.id, map.beatmapId, state.auto.left, state.auto.right]) : null;
};
const matchingRoom = (state, frame) => tosuRoomTeams(frame) && state.auto.profile === 'stable-tourney' &&
  frame.tourney.teams.left === state.auto.left && frame.tourney.teams.right === state.auto.right;

// Display evidence only authorizes a human's aggregate correction to close an
// observed finished map. It never creates a run or supplies an automatic winner.
export class SeriesCorrectionTracker {
  constructor() { this.reset(); }
  checkpoint() { return structuredClone({ ...this }); }
  restoreEvidence(checkpoint) { Object.assign(this, checkpoint); }
  reset() { this.previous = null; this.finished = null; }
  observe(state, frame, now) {
    const key = keyOf(state);
    if (!key || state.paused || !matchingRoom(state, frame)) { this.reset(); return; }
    const previous = this.previous;
    const continuous = previous?.key === key && now >= previous.at && now - previous.at <= 5000;
    const matches = frame.beatmap?.id === entryOf(state, currentRound(state).entryId)?.beatmapId;
    const ipc = frame.tourney.ipcState;
    if (!continuous || ipc === 3 && matches) this.finished = null;
    if (continuous && previous.matches && previous.ipc === 3 && matches && ipc === 4) this.finished = key;
    this.previous = { key, matches, ipc, at: now };
  }
  canFinish(state, source, fresh) {
    const round = currentRound(state); const frame = source.data;
    if (state.paused || !round || !['prepared', 'playing'].includes(round.status) || !fresh || source.status !== 'live' || !matchingRoom(state, frame)) return false;
    const ipc = frame.tourney.ipcState;
    if (round.status === 'playing' && ipc === 4 && frame.beatmap?.id === entryOf(state, round.entryId)?.beatmapId) return true;
    return this.finished === keyOf(state) && [1, 2, 4].includes(ipc);
  }
}
