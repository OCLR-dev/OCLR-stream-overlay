import { randomUUID } from 'node:crypto';
import { boundedBody } from './beatmap-metadata.js';
import { replayLimit } from './showcase-website.js';
import { localReplayMetadata, prepareStableReplay, stageReplayFile } from './showcase-replay-files.js';

const activePhases = ['loading', 'waiting', 'playing'];
const poolChanged = 'Showcase 图池已更新，请核对当前列表后重试。';
const websiteChanged = '网站回放清单已变化，请刷新后重试。';
const invalidatesReplays = error => [401, 403, 404, 409].includes(error.status);

export class ShowcaseReplayList {
  constructor(store, streaming, prepareReplay = prepareStableReplay) {
    this.store = store;
    this.streaming = streaming;
    this.prepareReplay = prepareReplay;
    this.local = new Map();
    this.remote = new Map();
    this.selected = new Map();
    this.cached = new Map();
    this.downloads = new Map();
    this.cacheFailures = new Map();
    this.cacheController = new AbortController();
    this.listeners = new Set();
    this.generation = 0;
    this.playback = { phase: 'idle', slotId: null, message: '' };
  }

  emit() { for (const listener of this.listeners) listener(); }

  sync() {
    const token = this.store.currentPoolToken();
    const source = this.store.state.website;
    const auth = this.streaming.showcaseConnection();
    if (this.token !== token) {
      this.token = token;
      for (const replay of this.local.values()) void replay.file.dispose();
      this.local.clear();
      this.selected.clear();
      this.clearRemote();
      this.refreshing = null;
      this.status = source ? 'unread' : 'local';
      this.message = '';
      this.cursor = this.next = null;
      this.playback = { phase: 'idle', slotId: null, message: '' };
      this.store.obs()?.cancelShowcaseAttempt?.(poolChanged);
    }
    if (this.connection !== auth.connection) {
      this.connection = auth.connection;
      if (source) {
        this.clearRemote();
        this.refreshing = null;
        if (this.status !== 'stale') {
          this.status = 'unread';
          this.message = '';
        }
      }
    }
    return source;
  }

  clearRemote() {
    this.cacheController.abort(new Error(websiteChanged));
    this.cacheController = new AbortController();
    for (const { file } of this.cached.values()) void file.dispose();
    this.cached.clear();
    this.downloads.clear();
    this.cacheFailures.clear();
    this.cacheJob = null;
    this.remote.clear();
    for (const [slotId, id] of this.selected) if (id !== this.local.get(slotId)?.option.id) this.selected.delete(slotId);
  }

  replayOptions(slotId) {
    const local = this.local.get(slotId);
    return [...(this.remote.get(slotId) || []), ...(local ? [local.option] : [])];
  }

  selectedId(slotId, options = this.replayOptions(slotId)) {
    const selected = this.selected.get(slotId);
    return options.some(option => option.id === selected) ? selected : options.length === 1 ? options[0].id : null;
  }

  nextSlot() {
    const pool = this.store.state.pool;
    if (this.next) return this.next;
    if (this.playback.phase === 'failed') return this.playback.slotId;
    return pool[pool.findIndex(slot => slot.id === this.cursor) + 1]?.id ?? null;
  }

  snapshot() {
    const source = this.sync();
    const rows = this.store.state.pool.map(slot => {
      const options = this.replayOptions(slot.id);
      const selectedId = this.selectedId(slot.id, options);
      const cached = !!selectedId && this.cached.get(slot.id)?.id === selectedId;
      const cacheError = this.cacheFailures.get(selectedId);
      return { slotId: slot.id, options, selectedId,
        ...(cached ? { cached } : cacheError ? { cacheError } : {}) };
    });
    const selectedWebsite = rows.filter(row => this.remote.get(row.slotId)?.some(option => option.id === row.selectedId));
    const snapshot = {
      poolToken: this.token, generation: this.generation, nextSlot: this.nextSlot(),
      playback: this.playback, status: this.refreshing ? 'refreshing' : this.status, message: this.message,
      gate: this.store.obs()?.replayLaunchGate?.() || 'off',
      rows,
      ...(source ? { cache: { running: !!this.cacheJob, total: selectedWebsite.length,
        ready: selectedWebsite.filter(row => row.cached).length,
        failed: selectedWebsite.filter(row => row.cacheError).length } } : {}),
    };
    const rendered = JSON.stringify(snapshot);
    if (rendered !== this.lastSnapshot) {
      this.revision = (this.revision || 0) + 1;
      this.lastSnapshot = rendered;
    }
    return { ...snapshot, revision: this.revision };
  }

  websiteError(error) {
    this.message = error.message;
    if (error.status === 404 || error.status === 409) {
      this.clearRemote();
      this.status = 'stale';
      this.message = '网站图池已变化。请管理员授权新版图池和回放，再从 OCLR 网站重新选择图池。';
    } else {
      if (error.status === 401 || error.status === 403) this.clearRemote();
      this.status = 'error';
    }
  }

  websiteInput(source) {
    return { edition: source.edition, poolId: source.pool.id, version: source.pool.version, connection: this.connection };
  }

  async refresh(source) {
    if (!source || this.status === 'stale') return;
    const task = Symbol();
    this.refreshing = task;
    this.message = '';
    this.emit();
    const input = this.websiteInput(source);
    try {
      const lookup = source.entriesById || (await this.streaming.readShowcase(input)).data.source.entriesById;
      const { data, isCurrent } = await this.streaming.readShowcase({ ...input, replays: true });
      this.sync();
      if (this.refreshing !== task || !isCurrent()) return;
      const byEntry = new Map(lookup?.map(row => [row.slot, row.entryId]));
      const remote = new Map();
      if (data.size !== byEntry.size) throw new Error('网站回放与当前图池不匹配，请重新导入图池。');
      for (const slot of this.store.state.pool) {
        const row = data.get(byEntry.get(slot.label));
        if (!row || row.slot !== slot.label) throw new Error('网站回放与当前图池不匹配，请重新导入图池。');
        remote.set(slot.id, row.replays);
      }
      this.remote = remote;
      for (const [slotId, cached] of this.cached) {
        if (!remote.get(slotId)?.some(option => option.id === cached.id)) {
          this.cached.delete(slotId);
          void cached.file.dispose();
        }
      }
      for (const [slotId, id] of this.selected) {
        if (!this.replayOptions(slotId).some(replay => replay.id === id)) this.selected.delete(slotId);
      }
      this.status = 'ready';
    } catch (error) {
      this.sync();
      if (this.refreshing === task) this.websiteError(error);
    } finally {
      if (this.refreshing === task) this.refreshing = null;
      this.emit();
    }
  }

  downloadReplay(source, slotId, id) {
    const pending = this.downloads.get(id);
    if (pending) return pending;
    const { signal } = this.cacheController;
    const download = (async () => {
      const { data, isCurrent } = await this.streaming.readShowcase({ ...this.websiteInput(source), replayId: id, signal });
      const current = () => {
        this.sync();
        return !signal.aborted && isCurrent() && this.selectedId(slotId) === id;
      };
      if (!current()) throw new Error(websiteChanged);
      const file = await stageReplayFile(data);
      if (!current()) {
        void file.dispose();
        throw new Error(websiteChanged);
      }
      const previous = this.cached.get(slotId);
      this.cached.set(slotId, { id, file });
      this.cacheFailures.delete(id);
      if (previous) void previous.file.dispose();
      return { file, isCurrent: () => !signal.aborted && isCurrent() };
    })().finally(() => {
      if (this.downloads.get(id) === download) this.downloads.delete(id);
    });
    this.downloads.set(id, download);
    return download;
  }

  async cacheSelected(source) {
    if (this.cacheJob || !source || this.status !== 'ready') return;
    const next = this.nextSlot();
    const queue = this.store.state.pool.flatMap(({ id: slotId }) => {
      const id = this.selectedId(slotId);
      return this.remote.get(slotId)?.some(option => option.id === id) && this.cached.get(slotId)?.id !== id ? [{ slotId, id }] : [];
    });
    const start = queue.findIndex(row => row.slotId === next);
    if (start > 0) queue.push(...queue.splice(0, start));
    if (!queue.length) return;
    const job = Symbol();
    this.cacheJob = job;
    this.emit();
    try {
      for (const { slotId, id } of queue) {
        if (this.cacheJob !== job) break;
        if (this.selectedId(slotId) !== id || this.cached.get(slotId)?.id === id) continue;
        this.cacheFailures.delete(id);
        this.emit();
        try { await this.downloadReplay(source, slotId, id); }
        catch (error) {
          this.sync();
          if (this.cacheJob !== job) break;
          if (invalidatesReplays(error)) { this.websiteError(error); break; }
          if (this.selectedId(slotId) === id) this.cacheFailures.set(id, error.message);
          if (error.status === 429) break;
        }
        this.emit();
      }
    } finally {
      if (this.cacheJob === job) this.cacheJob = null;
      this.emit();
    }
  }

  async attach(input, bytes) {
    const option = { id: randomUUID(), local: true, ...localReplayMetadata(input.filename, bytes) };
    const file = await stageReplayFile(bytes);
    try {
      this.sync();
      if (this.closed || input.poolToken !== this.token) throw new Error(poolChanged);
      if (this.refreshing || activePhases.includes(this.playback.phase)) throw new Error('请等当前回放操作结束后再补文件。');
      const previous = this.local.get(input.slotId);
      this.local.set(input.slotId, { option, file });
      this.selected.set(input.slotId, option.id);
      if (previous) void previous.file.dispose();
    } catch (error) { await file.dispose(); throw error; }
  }

  async play(input, source) {
    const slotId = input.action === 'repeat' ? this.playback.slotId : this.nextSlot();
    if (!slotId) throw new Error('已到清单末尾，请点选一行或重播本张。');
    const slot = this.store.state.pool.find(entry => entry.id === slotId);
    const id = this.selectedId(slotId);
    if (!id) {
      const reason = this.replayOptions(slotId).length ? '请选择一份回放' : '尚未上传，请补文件或点选其他已就绪的行';
      throw new Error(`${slot.label} ${reason}。`);
    }
    if (input.slotId !== slotId || input.replayId !== id || input.generation !== this.generation) {
      throw new Error('回放选择已变化，请核对清单后重试。');
    }
    const obs = this.store.obs();
    if (obs?.replayLaunchGate?.() !== 'ready') throw new Error('请将 OBS 切到 Showcase 并等遮挡确认后重试。');
    const programRevision = obs.programRevision;
    const playback = { phase: 'loading', slotId, message: '' };
    this.playback = playback;
    obs.holdShowcaseReplay();
    this.generation++;
    this.emit();
    let isCurrent = () => true;
    const local = this.local.get(slotId);
    const validate = () => {
      this.sync();
      if (this.closed || this.playback !== playback) throw new Error(poolChanged);
      if (!isCurrent()) throw new Error('OCLR 授权已切换，请刷新回放后重试。');
    };
    const notify = (phase, message = '') => {
      if (this.playback !== playback) return;
      Object.assign(playback, { phase, message });
      if (phase === 'completed') {
        this.cursor = slotId;
        this.next = null;
      }
      this.emit();
    };
    try {
      let file = local?.file;
      if (local?.option.id !== id) {
        const cached = this.cached.get(slotId);
        try {
          if (cached?.id === id) {
            const { signal } = this.cacheController;
            const read = await this.streaming.readShowcase({ ...this.websiteInput(source), replays: true, signal });
            if (![...read.data.values()].some(row => row.slot === slot.label && row.replays.some(replay => replay.id === id))) {
              throw Object.assign(new Error(websiteChanged), { status: 409 });
            }
            isCurrent = () => !signal.aborted && read.isCurrent();
            file = cached.file;
          } else ({ file, isCurrent } = await this.downloadReplay(source, slotId, id));
        } catch (error) {
          this.sync();
          if (this.playback === playback && source === this.store.state.website && invalidatesReplays(error)) {
            this.websiteError(error);
          }
          throw error;
        }
        validate();
      }
      const launch = await this.prepareReplay(file.path);
      await obs.launchShowcaseReplay({ map: String(slot.beatmapId), slotId, programRevision, launch, validate, notify });
    } catch (error) {
      if (this.playback === playback && playback.phase === 'loading') notify('failed', this.status === 'stale' ? this.message : error.message);
    }
  }

  async command(input, bytes) {
    const source = this.sync();
    if (this.closed || input?.poolToken !== this.token) throw new Error(poolChanged);
    if (this.refreshing && input.action === 'refresh') return this.snapshot();
    if (this.refreshing || activePhases.includes(this.playback.phase)) throw new Error('正在处理回放，请等当前操作结束。');
    if (input.action === 'refresh') await this.refresh(source);
    else if (input.action === 'cache') void this.cacheSelected(source);
    else if (input.action === 'play' || input.action === 'repeat') await this.play(input, source);
    else {
      const slot = this.store.state.pool.find(entry => entry.id === input.slotId);
      if (!slot) throw new Error('请从当前图池选择 Slot。');
      if (input.action === 'attach') await this.attach(input, bytes);
      else if (input.action === 'select') {
        if (!this.replayOptions(slot.id).some(option => option.id === input.replayId)) throw new Error('该回放已不可用，请刷新清单。');
        this.selected.set(slot.id, input.replayId);
      } else if (input.action === 'next') {
        if (!this.selectedId(slot.id)) throw new Error(`请先为 ${slot.label} 选择回放。`);
        this.next = slot.id;
      } else throw new Error('请刷新 Showcase 操作页后重试。');
    }
    this.emit();
    return this.snapshot();
  }

  close() {
    this.closed = true;
    this.clearRemote();
    for (const replay of this.local.values()) void replay.file.dispose();
  }
}

export async function replayHttp(req, res, url, list, stream, send) {
  const root = '/api/showcase/replays';
  const file = url.pathname === root + '/file';
  const events = url.pathname === root + '/events';
  if (!file && url.search) return send(400, { error: { code: 'INVALID_QUERY' } });
  if (req.method === 'GET' && !file) {
    if (!events) return send(200, list.snapshot());
    const subscribe = listener => {
      const receive = () => listener(list.snapshot());
      list.listeners.add(receive);
      const unsubscribeCover = list.store.obs()?.subscribeCover(receive);
      receive();
      return () => { unsubscribeCover?.(); list.listeners.delete(receive); };
    };
    stream(res, () => list.snapshot(), subscribe);
    return true;
  }
  if (req.method !== 'POST' || events) return send(405, { error: { code: 'METHOD_NOT_ALLOWED' } });
  const type = req.headers['content-type']?.split(';')[0].trim();
  if (req.headers.origin !== `http://${req.headers.host}` || type !== (file ? 'application/octet-stream' : 'application/json')) {
    return send(403, { error: { code: 'SAME_ORIGIN_REQUIRED' } });
  }
  let body;
  try {
    body = await boundedBody({ headers: new Headers(req.headers), body: req.iterator({ destroyOnReturn: false }) }, file ? replayLimit : 4096);
  } catch { return send(413, { error: { message: file ? '回放文件最大 8 MiB。' : '回放操作请求过长。' } }); }
  try {
    const input = file ? { ...Object.fromEntries(url.searchParams), action: 'attach' } : JSON.parse(body.toString('utf8'));
    if (!file && input?.action === 'attach') return send(400, { error: { message: '请选择 .osr 文件。' } });
    return send(200, await list.command(input, body));
  } catch (error) {
    return send(409, { error: { message: error.message }, snapshot: list.snapshot() });
  }
}
