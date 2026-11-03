import { randomUUID } from 'node:crypto';
import { automaticTransition, currentRound, entryOf, prepareAbortedRound, seriesComplete } from './model.js';

const keyOf = state => {
  const round = currentRound(state);
  if (state.paused || seriesComplete(state) || state.action || round?.status !== 'playing' || !round.runId || round.bpReleased ||
    state.auto.profile !== 'stable-tourney' || !(state.auto.bp || state.auto.scenes || state.auto.results) ||
    state.incident && (state.incident.source !== 'tosu' || state.incident.kind !== 'unverified')) return null;
  return JSON.stringify([state.id, round.id, round.runId, entryOf(state, round.entryId)?.beatmapId,
    state.auto.left, state.auto.right, state.auto.wsUrl, state.match.mode, round.exTeam]);
};
const sameRoom = (state, frame) => frame?.tourney?.teams?.left === state.auto.left &&
  frame.tourney.teams.right === state.auto.right && !!state.auto.left && !!state.auto.right;
const sameMap = (state, frame) => {
  const id = frame?.beatmap?.id;
  return !(Number.isSafeInteger(id) && id > 0) || id === entryOf(state, currentRound(state)?.entryId)?.beatmapId;
};

// This observes an unfinished Playing run returning to the ready room. It does
// not infer abort from missing players, Initialising, a disconnect or chat text.
// Evidence is volatile: reload/reconnect/undo cannot reuse a previous return.
export class ReadyReturnRecovery {
  constructor() { this.reset(); }
  reset() { this.anchor = null; this.pending = null; }
  recover(state, frame, now) {
    if (!this.anchor) return state;
    const ipc = frame?.tourney?.ipcState;
    if (this.anchor.key !== keyOf(state) || now < this.anchor.at || now - this.anchor.at > 5000 ||
      !sameRoom(state, frame) || !sameMap(state, frame) || ![1, 2, 3].includes(ipc)) {
      this.reset(); return state;
    }
    this.anchor.at = now;
    if (ipc === 3) { this.pending = null; return state; }
    if (!this.pending) { this.pending = { at: now }; return state; }
    if (now - this.pending.at < 250) return state;
    this.reset();
    return automaticTransition(state, prepareAbortedRound,
      '本局未结算即返回准备房间：保留原图与播出画面，等待重新开始', randomUUID());
  }
  observe(state, frame, now, observedRun) {
    const key = keyOf(state);
    if (this.anchor && this.anchor.key !== key) this.reset();
    if (!this.anchor && key && !state.incident && observedRun === currentRound(state).runId &&
      frame?.tourney?.ipcState === 3 && sameRoom(state, frame) &&
      frame.beatmap?.id === entryOf(state, currentRound(state).entryId)?.beatmapId) this.anchor = { key, at: now };
  }
}
