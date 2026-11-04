import { currentRound, entryOf, seriesComplete } from './model.js';

const DISPLAY_MS = 5000;

function pickKey(state) {
  const round = currentRound(state);
  const entry = entryOf(state, round?.entryId);
  if (round?.status !== 'prepared' || !entry) return null;
  const event = state.bpHistory?.findLast(item => item.actionId === round.actionId && item.entryId === entry.id &&
    ['pick', 'replace-pick'].includes(item.kind));
  return JSON.stringify([state.id, round.id, entry.id, entry.beatmapId, entry.mod, round.pickedBy, event?.id || null]);
}
const eligible = state => state.scene === 'mappool' && state.phase === 'bp' && state.auto.scenes &&
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
    token.timer = setTimeout(() => { void this.onDue(token); }, DISPLAY_MS);
    token.timer.unref?.();
    this.pending = token;
  }
  // The room pushes the picked map after the Pick is recorded. Restart the
  // presentation hold from that push so the picture does not leave Mappool
  // immediately after the map appears. The store only calls this for a new
  // beatmap ID, so repeated frames cannot extend the hold.
  observeRoomMap(state, mapId) {
    const token = this.pending;
    const entry = entryOf(state, currentRound(state)?.entryId);
    if (!token || !eligible(state) || !entry || entry.beatmapId !== mapId) return;
    this.cancel();
    const next = { key: token.key, timer: null };
    next.timer = setTimeout(() => { void this.onDue(next); }, DISPLAY_MS);
    next.timer.unref?.();
    this.pending = next;
  }
}
