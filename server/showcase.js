import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hasTourneyClient } from '../src/tosu.js';
import { parseShowcasePool, showcasePool, showcasePoolText } from './showcase-pool.js';
import { restoredWebsitePool } from './showcase-website.js';
import { replayHttp } from './showcase-replay-list.js';

const poolToken = pool => createHash('sha256').update(JSON.stringify(pool)).digest('hex');
const stageLabel = value => {
  if (typeof value !== 'string' || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Stage 请填写 80 字以内的单行阶段名称。');
  return value.trim();
};

// Showcase owns its pool. Live map identity is derived from the ordinary client,
// never persisted as an operator selection or sent back to competition state.
export class ShowcaseStore {
  constructor(session, { file = session?.file && join(dirname(session.file), 'showcase.json'), obs = () => null, websiteEnabled = true } = {}) {
    this.session = session;
    this.file = file;
    this.obs = obs;
    this.websiteEnabled = websiteEnabled;
    this.shown = new Set();
    this.state = { schema: 2, pool: [], stageLabel: '' };
    this.tail = Promise.resolve();
    this.ready = this.restore();
  }

  attachSession(session) {
    // Portable startup binds HTTP before restoring its competition session.
    if (this.session || !session) return;
    this.session = session;
    this.file ||= session.file && join(dirname(session.file), 'showcase.json');
    this.ready = this.restore();
  }

  async restore() {
    if (!this.file) return;
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (value.schema === 2) {
        const pool = showcasePool(value.pool);
        const website = value.website ? restoredWebsitePool(value.website, pool) : null;
        this.state = { schema: 2, pool, stageLabel: stageLabel(value.stageLabel ?? ''), ...(website ? { website } : {}) };
      }
      else if (typeof value.poolToken === 'string' && typeof value.useTosu === 'boolean' && (value.selectedId === null || typeof value.selectedId === 'string')) {
        // Replace the earlier manual-selection contract with an independent pool.
        this.state = { schema: 2, pool: showcasePool(this.session?.snapshot().session.pool || []), stageLabel: '' };
      } else throw new Error();
    } catch (error) {
      if (error.code !== 'ENOENT') this.storageError = 'Showcase 设置无法读取，请维护者检查 showcase.json。';
    }
  }

  currentPoolToken() {
    const { pool, website } = this.state;
    return poolToken(website ? [pool, website] : pool);
  }

  snapshot(envelope = this.session?.snapshot()) {
    const pool = this.state.pool.map(entry => ({ ...entry }));
    const loadedPool = envelope?.session?.pool || [];
    const source = envelope?.live?.tosu;
    const data = source?.data;
    const age = Date.now() - Date.parse(source?.updatedAt);
    const fresh = source?.status === 'live' && age >= 0 && age < 5000;
    const tourneyEvidence = hasTourneyClient(data);
    const map = fresh && data && !tourneyEvidence && Number.isSafeInteger(data.beatmap?.id) && data.beatmap.id > 0 ? data.beatmap : null;
    const candidates = map ? pool.filter(entry => entry.beatmapId === map.id) : [];
    const matched = candidates.length === 1 ? candidates[0] : null;
    const website = this.state.website;
    const cover = website?.covers.find(entry => entry.slot === matched?.label);
    const currentMap = map ? {
      id: matched?.id || `live:${map.id}`, beatmapId: map.id, setId: matched?.setId || map.setId,
      label: matched?.label || '—', mod: matched?.mod || '',
      title: matched?.title || map.title || '', artist: matched?.artist || map.artist || '', difficulty: matched?.difficulty || map.difficulty || '',
    } : null;
    const snapshot = {
      poolToken: this.currentPoolToken(), pool,
      ...(!this.websiteEnabled && { websiteEnabled: false }),
      websitePool: website ? { ...website.pool, edition: website.edition } : null,
      ...(website && matched ? { websiteArtwork: cover ? `/api/showcase/cover/${website.pool.id}/${website.pool.version}/${cover.entryId}` : null } : {}),
      poolText: showcasePoolText(pool), stageLabel: this.state.stageLabel,
      loadedPoolCount: loadedPool.length, loadedPoolToken: poolToken(loadedPool),
      matchedId: matched?.id || null, currentMap,
      mapParameters: map ? { id: map.id, stats: map.stats, time: map.time } : null,
      sourceStatus: !fresh ? 'unavailable' : tourneyEvidence ? 'tourney' : !map ? 'no-map' : !pool.length ? 'no-pool' : candidates.length > 1 ? 'ambiguous' : matched ? 'matched' : 'unmatched',
      error: this.storageError || '', persistence: this.file ? 'ready' : 'memory',
    };
    const transition = this.obs()?.coverSnapshot();
    if (transition) {
      const serial = transition.completed?.serial;
      if (this.progressPool !== snapshot.poolToken) {
        this.progressPool = snapshot.poolToken;
        this.shown.clear();
        this.lastMap = null;
        this.completedSerial = serial;
      }
      if (serial && serial !== this.completedSerial) {
        this.completedSerial = serial;
        this.lastMap = transition.completed.map;
        const completed = pool.filter(entry => String(entry.beatmapId) === this.lastMap &&
          (!transition.completed.slotId || transition.completed.slotId === entry.id));
        if (completed.length === 1) this.shown.add(completed[0].id);
      }
      // The first observed selection is a baseline, not evidence that the
      // client has moved to a next replay (it may already show old results).
      if (this.lastMap === null && currentMap) this.lastMap = String(currentMap.beatmapId);
      snapshot.transition = { covered: transition.covered, instant: transition.instant, shown: [...this.shown], lastMap: this.lastMap };
    }
    const rendered = JSON.stringify(snapshot);
    if (rendered !== this.lastSnapshot) { this.revision = (this.revision || 0) + 1; this.lastSnapshot = rendered; }
    return { ...snapshot, revision: this.revision };
  }

  subscribe(listener) {
    const unsubscribe = this.session.subscribe(envelope => listener(this.snapshot(envelope)));
    const unsubscribeCover = this.obs()?.subscribeCover(() => listener(this.snapshot()));
    this.listeners ||= new Set();
    this.listeners.add(listener);
    return () => { unsubscribe(); unsubscribeCover?.(); this.listeners.delete(listener); };
  }

  cover(poolId, version, entryId) {
    const website = this.state.website;
    return website?.pool.id === poolId && String(website.pool.version) === version &&
      website.covers.some(entry => entry.entryId === entryId) ? website : null;
  }

  command(input, websiteImport = null) {
    const task = this.tail.then(async () => {
      await this.ready;
      if (this.storageError) throw new Error(this.storageError);
      const current = this.snapshot();
      let next;
      if (input.type === 'stage-label') next = { ...this.state, stageLabel: stageLabel(input.value) };
      else {
        if (input.poolToken !== current.poolToken) throw new Error('Showcase 图池已更新，请核对当前列表后重试。');
        let pool;
        let website;
        if (input.type === 'pool-text') {
          pool = parseShowcasePool(input.text, this.state.pool);
          if (poolToken(pool) === poolToken(this.state.pool)) website = this.state.website;
        }
        else if (input.type === 'use-loaded-pool') {
          const loaded = this.session?.snapshot().session.pool || [];
          if (!loaded.length) throw new Error('控制台尚未加载图池，请直接录入 Showcase 图池列表。');
          if (input.loadedPoolToken !== poolToken(loaded)) throw new Error('控制台图池已变化，请重新复制。');
          pool = showcasePool(loaded);
        } else if (input.type === 'import-website' && websiteImport) {
          if (!websiteImport.isCurrent()) throw new Error('OCLR 授权已切换，请重新读取图池。');
          ({ entries: pool, source: website } = websiteImport.data);
        } else throw new Error('Showcase 已改为自动跟随客户端，请刷新页面后录入图池。');
        next = { schema: 2, stageLabel: this.state.stageLabel, pool, ...(website ? { website } : {}) };
      }
      if (this.file) {
        try {
          await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
          await writeFile(this.file + '.tmp', JSON.stringify(next), { mode: 0o600 });
          if (websiteImport && !websiteImport.isCurrent()) throw new Error('OCLR 授权已切换，请重新读取图池。');
          await rename(this.file + '.tmp', this.file);
        } catch {
          await rm(this.file + '.tmp', { force: true }).catch(() => {});
          if (websiteImport && !websiteImport.isCurrent()) throw new Error('OCLR 授权已切换，请重新读取图池。');
          throw new Error('Showcase 设置保存失败，请检查本机存储后重试。');
        }
      }
      this.state = next;
      this.onChange?.();
      // Notify Showcase listeners without emitting or modifying the match session.
      for (const listener of this.listeners || []) listener(this.snapshot());
      return this.snapshot();
    });
    this.tail = task.catch(() => {});
    return task;
  }
}

function stream(res, snapshot, subscribe) {
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
  const unsubscribe = subscribe(receive);
  const heartbeat = setInterval(() => {
    // Re-evaluate freshness even if a source has stopped emitting.
    receive(snapshot());
    if (!blocked && !res.destroyed) blocked = !res.write('event: heartbeat\ndata: {}\n\n');
  }, 1500);
  res.on('close', () => { unsubscribe(); clearInterval(heartbeat); clearTimeout(pending); res.off('drain', drain); });
}

export async function showcaseHttp(req, res, url, store, streaming, replays) {
  const coverRoute = url.pathname.startsWith('/api/showcase/cover/');
  const replayRoute = ['/api/showcase/replays', '/api/showcase/replays/file', '/api/showcase/replays/events'].includes(url.pathname);
  if (!coverRoute && !replayRoute && !['/api/showcase', '/api/showcase/events', '/api/showcase/website'].includes(url.pathname)) return false;
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
    return true;
  };
  if (!store.session) return send(503, { error: { message: '本机图池服务尚未就绪。' } });
  await store.ready;
  if (replayRoute) return replayHttp(req, res, url, replays, stream, send);
  if (url.search) return send(400, { error: { code: 'INVALID_QUERY' } });
  const websiteRoute = url.pathname === '/api/showcase/website';
  if (!streaming && (websiteRoute || coverRoute)) return send(403, { error: { code: 'OCLR_DISABLED_CUSTOM_MATCH' } });
  if (coverRoute) {
    const [, , , , poolId, version, entryId, extra] = url.pathname.split('/');
    const unavailable = (status = 404) => send(status, { error: { code: 'SHOWCASE_COVER_UNAVAILABLE' } });
    if (req.method !== 'GET') return unavailable(405);
    const source = extra === undefined && store.cover(poolId, version, entryId);
    if (!source) return unavailable();
    try {
      const { data, isCurrent } = await streaming.readShowcase({ edition: source.edition, poolId, version: source.pool.version, entryId });
      if (!isCurrent() || store.cover(poolId, version, entryId) !== source) return unavailable();
      res.writeHead(200, { 'Content-Type': data.type, 'Content-Length': data.bytes.length,
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
      res.end(data.bytes); return true;
    } catch (error) { return unavailable(error.status || 502); }
  }
  if (req.method === 'GET') {
    if (websiteRoute) return send(200, streaming.showcaseConnection());
    if (url.pathname.endsWith('/events')) { stream(res, () => store.snapshot(), listener => store.subscribe(listener)); return true; }
    return send(200, store.snapshot());
  }
  if (req.method !== 'POST' || (!websiteRoute && url.pathname !== '/api/showcase')) return send(405, { error: { code: 'METHOD_NOT_ALLOWED' } });
  if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return send(403, { error: { code: 'SAME_ORIGIN_JSON_REQUIRED' } });
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) return send(413, { error: { code: 'REQUEST_TOO_LARGE' } });
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return send(400, { error: { message: '请求格式无效，请刷新后重试。' } }); }
  try {
    if (websiteRoute || input?.type === 'import-website') {
      if (!streaming) return send(403, { error: { code: 'OCLR_DISABLED_CUSTOM_MATCH' } });
      if (typeof input?.connection !== 'string' || typeof input.edition !== 'string') return send(400, { error: { code: 'INVALID_SHOWCASE_REQUEST' } });
      const list = websiteRoute && input.action === 'list';
      if ((!list && typeof input.poolId !== 'string') || (websiteRoute && !list && input.action !== 'preview')) {
        return send(400, { error: { code: 'INVALID_SHOWCASE_REQUEST' } });
      }
      if (!websiteRoute && store.snapshot().poolToken !== input.poolToken) {
        return send(409, { error: { message: 'Showcase 图池已更新，请核对当前列表后重试。' }, snapshot: store.snapshot() });
      }
      const website = await streaming.readShowcase({ edition: input.edition, connection: input.connection,
        ...(list ? {} : { poolId: input.poolId, version: input.version }) });
      if (!websiteRoute) return send(200, await store.command(input, website));
      return send(200, list ? { pools: website.data } : { pool: website.data.source.pool });
    }
    return send(200, await store.command(input || {}));
  } catch (error) {
    return send(error.status || 409, { error: { code: error.code, message: error.message }, ...(!websiteRoute ? { snapshot: store.snapshot() } : {}) });
  }
}
