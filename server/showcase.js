import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tosuRoomTeams } from '../src/tosu.js';

// This store only reads the loaded pool and optional ordinary-client metadata.
// It never sends a match command or observes gameplay for competition purposes.
export class ShowcaseStore {
  constructor(session, { file = session?.file && join(dirname(session.file), 'showcase.json') } = {}) {
    this.session = session;
    this.file = file;
    this.state = { poolToken: '', selectedId: null, useTosu: false };
    this.tail = Promise.resolve();
    this.ready = this.restore();
  }

  async restore() {
    if (!this.file) return;
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (typeof value.poolToken !== 'string' || !(value.selectedId === null || typeof value.selectedId === 'string') || typeof value.useTosu !== 'boolean') throw new Error();
      this.state = value;
    } catch (error) {
      if (error.code !== 'ENOENT') this.storageError = 'Showcase 设置无法读取，请维护者检查 showcase.json。';
    }
  }

  snapshot(envelope = this.session?.snapshot()) {
    const session = envelope?.session;
    const pool = (session?.pool || []).map(({ id, beatmapId, setId, mod, label, title, artist, difficulty }) =>
      ({ id, beatmapId, setId, mod, label, title, artist, difficulty }));
    const poolToken = createHash('sha256').update(JSON.stringify([session?.id, session?.match.poolId, session?.match.edition, pool])).digest('hex');
    const selected = this.state.poolToken === poolToken && pool.find(entry => entry.id === this.state.selectedId) || null;
    const source = envelope?.live?.tosu;
    const data = source?.data;
    const fresh = source?.status === 'live' && Date.now() - Date.parse(source.updatedAt) >= 0 && Date.now() - Date.parse(source.updatedAt) < 5000;
    // A replay never changes the explicit pool selection. Tourney samples and
    // stale/wrong-map data cannot fill parameters on the Showcase card.
    // v2 may include an empty tourney structure even for a normal client.
    // Reject real room/roster evidence, not zero-valued placeholder clients.
    const tourneyEvidence = tosuRoomTeams(data) || Object.values(data?.tourney?.teams || {}).some(name => typeof name === 'string' && name.trim()) ||
      data?.tourney?.players?.some(player => player.osuId > 0 || player.name?.trim());
    const ordinary = fresh && data && !tourneyEvidence;
    const map = this.state.useTosu && ordinary && selected?.beatmapId > 0 && data.beatmap?.id === selected.beatmapId ? data.beatmap : null;
    const snapshot = {
      poolToken, pool, selectedId: selected?.id || null,
      currentMap: selected && { ...selected, title: selected.title || map?.title || '', difficulty: selected.difficulty || map?.difficulty || '' },
      useTosu: this.state.useTosu,
      mapParameters: map ? { id: map.id, stats: map.stats, time: map.time } : null,
      sourceStatus: !this.state.useTosu ? 'off' : !fresh ? 'unavailable' : !ordinary ? 'tourney' : !map ? 'different-map' : 'matched',
      edition: session?.match.edition || null,
      error: this.storageError || '', persistence: this.file ? 'ready' : 'memory',
    };
    const serialized = JSON.stringify(snapshot);
    if (serialized !== this.lastSnapshot) { this.revision = (this.revision || 0) + 1; this.lastSnapshot = serialized; }
    return { ...snapshot, revision: this.revision };
  }

  subscribe(listener) { return this.session.subscribe(envelope => listener(this.snapshot(envelope))); }

  command(input) {
    const task = this.tail.then(async () => {
      await this.ready;
      if (this.storageError) throw new Error(this.storageError);
      const current = this.snapshot();
      if (input.poolToken !== current.poolToken) throw new Error('图池已更新，请重新选择展示谱面。');
      if (!(input.selectedId === null || current.pool.some(entry => entry.id === input.selectedId))) throw new Error('请从已加载的图池选择谱面。');
      if (typeof input.useTosu !== 'boolean') throw new Error('请核对 Showcase 数据选项。');
      const next = { poolToken: current.poolToken, selectedId: input.selectedId, useTosu: input.useTosu };
      if (this.file) {
        try {
          await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
          await writeFile(this.file + '.tmp', JSON.stringify(next), { mode: 0o600 });
          await rename(this.file + '.tmp', this.file);
        } catch { throw new Error('Showcase 设置保存失败，请检查本机存储后重试。'); }
      }
      this.state = next;
      // Notify Showcase listeners without emitting or modifying the match session.
      for (const listener of this.listeners || []) listener(this.snapshot());
      return this.snapshot();
    });
    this.tail = task.catch(() => {});
    return task;
  }
}

function stream(req, res, store) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
  let latest;
  let written;
  let blocked = false;
  let pending;
  const write = () => {
    if (res.destroyed || res.writableEnded || blocked || latest === written) return;
    written = latest;
    blocked = !res.write(`event: snapshot\ndata: ${latest}\n\n`);
  };
  const schedule = () => { if (!pending) pending = setTimeout(() => { pending = null; write(); }, 80); };
  const receive = snapshot => { latest = JSON.stringify(snapshot); if (!written) write(); else if (latest !== written) schedule(); };
  const drain = () => { blocked = false; schedule(); };
  res.on('drain', drain);
  store.listeners ||= new Set();
  store.listeners.add(receive);
  const unsubscribe = store.subscribe(receive);
  const heartbeat = setInterval(() => {
    // Re-evaluate freshness even if a source has stopped emitting.
    receive(store.snapshot());
    if (!blocked && !res.destroyed) blocked = !res.write('event: heartbeat\ndata: {}\n\n');
  }, 1500);
  res.on('close', () => { unsubscribe(); store.listeners.delete(receive); clearInterval(heartbeat); clearTimeout(pending); res.off('drain', drain); });
}

export async function showcaseHttp(req, res, url, store) {
  if (!['/api/showcase', '/api/showcase/events'].includes(url.pathname)) return false;
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
    return true;
  };
  if (!store.session) return send(503, { error: { message: '本机图池服务尚未就绪。' } });
  await store.ready;
  if (url.search) return send(400, { error: { code: 'INVALID_QUERY' } });
  if (req.method === 'GET') {
    if (url.pathname.endsWith('/events')) { stream(req, res, store); return true; }
    return send(200, store.snapshot());
  }
  if (req.method !== 'POST' || url.pathname !== '/api/showcase') return send(405, { error: { code: 'METHOD_NOT_ALLOWED' } });
  if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return send(403, { error: { code: 'SAME_ORIGIN_JSON_REQUIRED' } });
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) return send(413, { error: { code: 'REQUEST_TOO_LARGE' } });
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return send(400, { error: { message: '请求格式无效，请刷新后重试。' } }); }
  try { return send(200, await store.command(input || {})); }
  catch (error) { return send(409, { error: { message: error.message }, snapshot: store.snapshot() }); }
}
