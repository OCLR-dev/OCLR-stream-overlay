const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' ? value : null;
const bool = value => typeof value === 'boolean' ? value : null;

// The connected tosu instance owns room sides; operators do not retype names.
export function tosuRoomTeams(frame) {
  const room = frame?.tourney;
  const names = room?.teams;
  return room && [0, 1, 2, 3, 4].includes(room.ipcState) &&
    typeof names?.left === 'string' && names.left.trim() &&
    typeof names?.right === 'string' && names.right.trim()
    ? { left: names.left, right: names.right } : null;
}

function statsSnapshot(stats) {
  if (!stats || typeof stats !== 'object') return null;
  const pair = value => ({ original: number(value?.original), converted: number(value?.converted) });
  return {
    ...stats,
    stars: { ...stats.stars, live: number(stats.stars?.live), total: number(stats.stars?.total) },
    cs: pair(stats.cs), ar: pair(stats.ar), od: pair(stats.od), hp: pair(stats.hp),
    bpm: { realtime: number(stats.bpm?.realtime), common: number(stats.bpm?.common),
      min: number(stats.bpm?.min), max: number(stats.bpm?.max) },
  };
}

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
      stats: statsSnapshot(map.stats),
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
    socket.onerror = () => {
      if (!active()) return;
      // Closing a failed CONNECTING socket can synchronously dispatch another
      // error in Node's WebSocket. Retire its callbacks before closing it.
      this.releaseSocket(socket);
      this.onStatus('error');
      this.retry(false);
    };
    socket.onclose = () => {
      if (!active()) return;
      this.releaseSocket(socket, false);
      this.retry();
    };
    this.watchForStale();
  }

  watchForStale() {
    clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => {
      if (!this.running) return;
      this.onStatus('stale');
      // Re-open silent/stuck connections, including a stalled initial handshake.
      this.releaseSocket();
      this.retry(false);
    }, this.staleMs);
  }

  retry(report = true) {
    clearTimeout(this.staleTimer);
    clearTimeout(this.retryTimer);
    if (report) this.onStatus('disconnected');
    if (this.running) this.retryTimer = setTimeout(() => this.connect(), this.reconnectMs);
  }

  releaseSocket(socket = this.socket, close = true) {
    if (!socket) return;
    if (this.socket === socket) this.socket = null;
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    if (close) {
      try { socket.close(); } catch { /* Already failed/closing; retry owns recovery. */ }
    }
  }

  stop() {
    this.running = false;
    clearTimeout(this.staleTimer);
    clearTimeout(this.retryTimer);
    this.releaseSocket();
    this.onStatus('stopped');
  }
}
