const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' ? value : null;
const bool = value => typeof value === 'boolean' ? value : null;

function playSnapshot(play) {
  if (!play) return null;
  return {
    name: text(play.playerName), score: number(play.score), accuracy: number(play.accuracy),
    combo: number(play.combo?.current), maxCombo: number(play.combo?.max ?? play.maxCombo),
    misses: number(play.hits?.['0']), mods: text(play.mods?.name),
    pp: number(play.pp?.current), unstableRate: number(play.unstableRate),
  };
}

export function normalizeTosuV2(raw) {
  if (!raw || typeof raw !== 'object' || !raw.state || !raw.beatmap || raw.error) throw new Error('INVALID_TOSU_FRAME');
  const tourney = raw.tourney;
  const map = raw.beatmap;
  return {
    state: { number: number(raw.state.number), name: text(raw.state.name) },
    beatmap: {
      id: number(map.id), setId: number(map.set), checksum: text(map.checksum),
      artist: text(map.artist), title: text(map.title), difficulty: text(map.version), mapper: text(map.mapper),
      time: { current: number(map.time?.live), firstObject: number(map.time?.firstObject), lastObject: number(map.time?.lastObject) },
      stats: map.stats ?? null,
    },
    play: playSnapshot(raw.play),
    resultsScreen: playSnapshot(raw.resultsScreen),
    tourney: tourney ? {
      ipcState: number(tourney.ipcState), bestOf: number(tourney.bestOF),
      scoreVisible: bool(tourney.scoreVisible), starsVisible: bool(tourney.starsVisible),
      teams: { left: text(tourney.team?.left), right: text(tourney.team?.right) },
      points: { left: number(tourney.points?.left), right: number(tourney.points?.right) },
      totalScore: { left: number(tourney.totalScore?.left), right: number(tourney.totalScore?.right) },
      chat: Array.isArray(tourney.chat) ? tourney.chat : [],
      players: Array.isArray(tourney.clients) ? tourney.clients.map(client => ({
        side: ['left', 'right'].includes(client.team) ? client.team : null,
        osuId: number(client.user?.id), name: text(client.user?.name),
        score: number(client.play?.score), accuracy: number(client.play?.accuracy),
        combo: number(client.play?.combo?.current), maxCombo: number(client.play?.combo?.max),
        misses: number(client.play?.hits?.['0']), mods: text(client.play?.mods?.name),
      })) : [],
    } : null,
  };
}

export class TosuClient {
  constructor({ url, onFrame, onStatus, WebSocketImpl = globalThis.WebSocket, staleMs = 5000, reconnectMs = 1000 }) {
    Object.assign(this, { url, onFrame, onStatus, WebSocketImpl, staleMs, reconnectMs });
    this.running = false;
    this.socket = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  connect() {
    if (!this.running) return;
    this.onStatus('connecting');
    let socket;
    try { socket = new this.WebSocketImpl(this.url); }
    catch { this.retry(); return; }
    this.socket = socket;
    const active = () => this.running && this.socket === socket;
    socket.onopen = () => { if (active()) this.watchForStale(); };
    socket.onmessage = event => {
      if (!active()) return;
      let frame;
      try { frame = normalizeTosuV2(JSON.parse(event.data)); }
      catch { this.onStatus('invalid-data'); return; }
      this.watchForStale();
      this.onStatus('live');
      this.onFrame(frame);
    };
    socket.onerror = () => { if (active()) { this.onStatus('error'); socket.close(); } };
    socket.onclose = () => { if (active()) this.retry(); };
    this.watchForStale();
  }

  watchForStale() {
    clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => {
      if (!this.running) return;
      this.onStatus('stale');
      // Re-open silent/stuck connections, including a stalled initial handshake.
      const old = this.socket;
      this.socket = null;
      old?.close();
      this.retry(false);
    }, this.staleMs);
  }

  retry(report = true) {
    clearTimeout(this.staleTimer);
    clearTimeout(this.retryTimer);
    if (report) this.onStatus('disconnected');
    if (this.running) this.retryTimer = setTimeout(() => this.connect(), this.reconnectMs);
  }

  stop() {
    this.running = false;
    clearTimeout(this.staleTimer);
    clearTimeout(this.retryTimer);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.onStatus('stopped');
  }
}
