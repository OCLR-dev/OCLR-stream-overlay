import { currentRound, entryOf, seriesComplete } from './model.js';

function pickKey(state) {
  const round = currentRound(state);
  const entry = entryOf(state, round?.entryId);
  if (round?.status !== 'prepared' || !entry) return null;
  const event = state.bpHistory?.findLast(item => item.actionId === round.actionId && item.entryId === entry.id &&
    ['pick', 'replace-pick'].includes(item.kind));
  return JSON.stringify([state.id, round.id, entry.id, entry.beatmapId, entry.mod, round.pickedBy, event?.id || null]);
}
const eligible = state => !state.warmup && state.scene === 'mappool' && state.phase === 'bp' && state.auto.scenes &&
  !state.action && !state.paused && !state.incident && !seriesComplete(state);

// One volatile server timer per fresh Pick. Loading/subscribing to an existing
// snapshot never arms it, and the callback is rechecked inside the store queue.
export class PickSceneDelay {
  constructor(onDue) { this.onDue = onDue; this.pending = null; }
  cancel() {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }
  matches(token, state) { return this.pending === token && eligible(state) && pickKey(state) === token.key; }
  update(before, after, allowNew = true) {
    const key = pickKey(after);
    if (this.pending && (!eligible(after) || this.pending.key !== key)) this.cancel();
    if (!allowNew || !key || !eligible(after) || key === pickKey(before)) return;
    this.cancel();
    const token = { key, timer: null };
    token.timer = setTimeout(() => { void this.onDue(token); }, 2500);
    token.timer.unref?.();
    this.pending = token;
  }
}
