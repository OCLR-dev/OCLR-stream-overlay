import { OclrClient } from './oclr.js';
import { TosuClient } from './tosu.js';

function source() {
  return { status: 'idle', updatedAt: null, error: null, data: null };
}

export function findPoolEntry(snapshot, selection, beatmapId) {
  if (!selection.poolId || !Number.isInteger(beatmapId) || beatmapId <= 0) return null;
  const pool = snapshot?.mappools?.find(item => item.id === selection.poolId);
  const candidates = pool?.entries?.filter(item => item.beatmapId === beatmapId) || [];
  // A map can appear in multiple slots. Only an explicit entry selection disambiguates it.
  if (selection.entryId) return candidates.find(item => item.id === selection.entryId) || null;
  return candidates.length === 1 ? candidates[0] : null;
}

export class BroadcastData {
  constructor({ oclr = new OclrClient(), tosuWsUrl, WebSocketImpl, pollMs = 60000, staleMs = 5000 }) {
    this.oclr = oclr;
    this.pollMs = Math.max(30000, pollMs);
    this.listeners = new Set();
    this.state = {
      selection: { edition: null, fixtureId: null, poolId: null, entryId: null, leftTeamId: null, rightTeamId: null },
      oclr: source(), tosu: source(), currentPoolEntry: null,
    };
    this.tosu = new TosuClient({
      url: tosuWsUrl, WebSocketImpl, staleMs,
      onStatus: status => {
        this.state.tosu.status = status;
        if (status !== 'live') this.state.currentPoolEntry = null;
        this.emit();
      },
      onFrame: data => {
        this.state.tosu = { status: 'live', updatedAt: new Date().toISOString(), error: null, data };
        this.derive();
        this.emit();
      },
    });
  }

  getSnapshot() { return structuredClone(this.state); }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) {
      try { listener(this.getSnapshot()); }
      catch (error) { console.error('Broadcast subscriber failed', error); }
    }
  }

  derive() {
    this.state.currentPoolEntry = this.state.tosu.status === 'live' && this.state.oclr.status === 'ready'
      ? findPoolEntry(this.state.oclr.data, this.state.selection, this.state.tosu.data?.beatmap.id) : null;
  }

  selectEdition(edition) {
    if (typeof edition !== 'string' || edition.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(edition)) throw new Error('INVALID_EDITION');
    this.request?.abort();
    this.generation = (this.generation || 0) + 1;
    clearTimeout(this.pollTimer);
    this.state.selection = { edition, fixtureId: null, poolId: null, entryId: null, leftTeamId: null, rightTeamId: null };
    this.state.oclr = source();
    this.derive();
    this.emit();
    return this.refresh();
  }

  selectMatch({ fixtureId = null, poolId = null, leftTeamId = null, rightTeamId = null, entryId = null } = {}) {
    const data = this.state.oclr.data;
    if (this.state.oclr.status !== 'ready') throw new Error('EDITION_NOT_READY');
    if (fixtureId && !data.competition?.fixtures?.some(item => item.id === fixtureId)) throw new Error('UNKNOWN_FIXTURE');
    if (poolId && !data.mappools.some(item => item.id === poolId)) throw new Error('UNKNOWN_POOL');
    for (const id of [leftTeamId, rightTeamId]) {
      if (id && !data.teams.some(team => team.id === id)) throw new Error('UNKNOWN_TEAM');
    }
    if (leftTeamId && leftTeamId === rightTeamId) throw new Error('DUPLICATE_TEAM');
    if (entryId && !data.mappools.find(pool => pool.id === poolId)?.entries.some(entry => entry.id === entryId)) {
      throw new Error('UNKNOWN_POOL_ENTRY');
    }
    Object.assign(this.state.selection, { fixtureId, poolId, leftTeamId, rightTeamId, entryId });
    this.derive();
    this.emit();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tosu.start();
    if (this.state.selection.edition) void this.refresh();
  }

  async refresh() {
    const edition = this.state.selection.edition;
    if (!edition) return;
    clearTimeout(this.pollTimer);
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const generation = this.generation;
    this.state.oclr.status = 'loading';
    this.derive();
    this.emit();
    let delay = this.pollMs;
    let blocked = false;
    try {
      const data = await this.oclr.edition(edition, request.signal);
      if (request.signal.aborted || generation !== this.generation) return;
      this.state.oclr = { status: 'ready', updatedAt: new Date().toISOString(), error: null, data };
      // Publication can remove records while a stream is running; invalidate those selections.
      const s = this.state.selection;
      if (!data.competition?.fixtures?.some(item => item.id === s.fixtureId)) s.fixtureId = null;
      if (!data.mappools.some(item => item.id === s.poolId)) { s.poolId = null; s.entryId = null; }
      if (!data.mappools.find(pool => pool.id === s.poolId)?.entries.some(entry => entry.id === s.entryId)) s.entryId = null;
      for (const side of ['leftTeamId', 'rightTeamId']) if (!data.teams.some(team => team.id === s[side])) s[side] = null;
      this.derive();
    } catch (error) {
      if (request.signal.aborted || generation !== this.generation) return;
      blocked = error.status === 401 || error.status === 403;
      delay = Math.max(this.pollMs, error.retryAfterMs || 0);
      // Failed reads are never authoritative empty collections or retained protected data.
      this.state.oclr = { ...source(), status: blocked ? 'blocked' : 'error', error: error.code || 'NETWORK_ERROR' };
      this.derive();
    } finally {
      if (this.request === request) {
        this.request = null;
        this.emit();
        if (this.running && !blocked) this.pollTimer = setTimeout(() => void this.refresh(), delay);
      }
    }
  }

  stop() {
    this.running = false;
    clearTimeout(this.pollTimer);
    this.request?.abort();
    this.request = null;
    this.state.oclr = source();
    this.derive();
    this.tosu.stop();
  }
}
