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

function playbackRate(mods) {
  if (!mods || typeof mods !== 'object') return null;
  if (mods.rate !== undefined) return number(mods.rate) > 0 ? mods.rate : null;
  // Older tosu versions omit rate. Decode actual client mods, never the pool tag.
  if (Number.isSafeInteger(mods.number) && mods.number >= 0) {
    const fast = !!(mods.number & (64 | 512)); const slow = !!(mods.number & 256);
    return fast && slow ? null : fast ? 1.5 : slow ? .75 : 1;
  }
  if (typeof mods.name !== 'string') return null;
  const name = mods.name.toUpperCase().replace(/[\s+]/g, '');
  const fast = /DT|NC/.test(name); const slow = /HT|DC/.test(name);
  if (fast || slow) return fast && slow ? null : fast ? 1.5 : .75;
  return /^(?:NM|NF|EZ|HD|HR|SD|PF|FL|SO|V2|RX|AP|AT|TD)*$/.test(name) ? 1 : null;
}

function statsSnapshot(stats, mods) {
  if (!stats || typeof stats !== 'object') return null;
  const pair = value => ({ original: number(value?.original), converted: number(value?.converted) });
  return {
    ...stats,
    clockRate: playbackRate(mods),
    stars: { ...stats.stars, live: number(stats.stars?.live), total: number(stats.stars?.total) },
    cs: pair(stats.cs), ar: pair(stats.ar), od: pair(stats.od), hp: pair(stats.hp),
    bpm: { realtime: number(stats.bpm?.realtime), common: number(stats.bpm?.common),
      min: number(stats.bpm?.min), max: number(stats.bpm?.max) },
  };
}

function tourneyStatsSnapshot(raw) {
  if (![3, 4].includes(raw.tourney?.ipcState)) return null;
  const root = raw.beatmap;
  const clients = (Array.isArray(raw.tourney.clients) ? raw.tourney.clients : []).filter(client =>
    ['left', 'right'].includes(client.team) && number(client.user?.id) > 0);
  let missing = clients.length === 0; let mismatched = false;
  const samples = clients.map(client => {
    const map = client.beatmap;
    const stats = map?.stats;
    if ((number(map?.id) > 0 && map.id !== root.id) ||
      (map?.checksum && root.checksum && map.checksum !== root.checksum)) { mismatched = true; return null; }
    if (!stats) { missing = true; return null; }
    // Older v2 clients expose only stats, without a map ID. Reject explicit
    // disagreements with the selected map rather than showing a stale sample.
    for (const key of ['ar', 'cs', 'od', 'hp']) {
      if (number(stats[key]?.original) !== null && number(root.stats?.[key]?.original) !== null &&
        stats[key].original !== root.stats[key].original) { mismatched = true; return null; }
    }
    for (const [value, expected] of [[stats.objects?.total, root.stats?.objects?.total], [stats.maxCombo, root.stats?.maxCombo]]) {
      if (number(value) !== null && number(expected) !== null && value !== expected) { mismatched = true; return null; }
    }
    const rate = playbackRate(client.play?.mods);
    const hasDifficulty = [stats.stars?.total, ...['ar', 'cs', 'od', 'hp'].map(key => stats[key]?.converted)]
      .some(value => number(value) !== null);
    // Ranking can clear stats and reset mods to the empty NM placeholder.
    // That is missing rate evidence, not a newly observed speed change.
    const clearedMods = !hasDifficulty && !client.play?.mods?.name?.trim() && rate === 1;
    return { ...stats, clockRate: clearedMods ? null : rate };
  });
  const common = pick => {
    const values = samples.map(stats => number(pick(stats)));
    return values.length && values[0] !== null && values.every(value => value === values[0]) ? values[0] : null;
  };
  const range = pick => {
    const values = samples.map(stats => number(pick(stats)));
    return values.length && values.every(value => value !== null && value >= 0)
      ? { min: Math.min(...values), max: Math.max(...values) } : null;
  };
  const attributes = [stats => stats?.stars?.total, ...['ar', 'cs', 'od', 'hp'].map(key => stats => stats?.[key]?.converted), stats => stats?.bpm?.common, stats => stats?.clockRate];
  const mixed = attributes.some(pick => new Set(samples.map(stats => number(pick(stats))).filter(value => value !== null)).size > 1);
  if (attributes.some(pick => samples.some(stats => number(pick(stats)) === null))) missing = true;
  // Keep common values for fixed-mod rows and full client ranges for FM.
  // Every client must supply the attribute; never fill gaps with root NM data.
  return {
    availability: mismatched ? 'mismatched' : mixed ? 'mixed' : missing ? 'missing' : 'ready',
    clockRate: common(stats => stats?.clockRate),
    stars: { total: common(stats => stats?.stars?.total) },
    ...Object.fromEntries(['ar', 'cs', 'od', 'hp'].map(key => [key, { converted: common(stats => stats?.[key]?.converted) }])),
    bpm: { common: common(stats => stats?.bpm?.common) },
    ranges: { stars: range(stats => stats?.stars?.total),
      ...Object.fromEntries(['ar', 'cs', 'od', 'hp'].map(key => [key, range(stats => stats?.[key]?.converted)])),
      bpm: range(stats => stats?.bpm?.common), clockRate: range(stats => stats?.clockRate) },
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
      stats: statsSnapshot(map.stats, raw.play?.mods),
      tourneyStats: tourneyStatsSnapshot(raw),
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
        ipcId: Number.isSafeInteger(client.ipcId) && client.ipcId >= 0 ? client.ipcId : null,
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
