import { randomUUID } from 'node:crypto';
import { boundedBody } from './beatmap-metadata.js';
import { replayLimit } from './showcase-website.js';
import { localReplayMetadata, prepareStableReplay, stageReplayFile } from './showcase-replay-files.js';

const activePhases = ['loading', 'waiting', 'playing'];
const poolChanged = 'Showcase 图池已更新，请核对当前列表后重试。';

export class ShowcaseReplayList {
  constructor(store, streaming, prepareReplay = prepareStableReplay) {
    this.store = store;
    this.streaming = streaming;
    this.prepareReplay = prepareReplay;
    this.local = new Map();
    this.remote = new Map();
    this.selected = new Map();
    this.listeners = new Set();
    this.generation = 0;
    this.playback = { phase: 'idle', slotId: null, message: '' };
  }

  emit() { for (const listener of this.listeners) listener(); }

  sync() {
    const token = this.store.currentPoolToken();
    const source = this.streaming && this.store.state.website;
    const connection = this.streaming?.showcaseConnection().connection ?? null;
    if (this.token !== token) {
      this.token = token;
      for (const replay of this.local.values()) void replay.file.dispose();
      this.local.clear();
      this.selected.clear();
      this.remote.clear();
      this.refreshing = null;
      this.status = source ? 'unread' : 'local';
      this.message = '';
      this.cursor = this.next = null;
      this.playback = { phase: 'idle', slotId: null, message: '' };
      this.store.obs()?.cancelShowcaseAttempt?.(poolChanged);
    }
    if (this.connection !== connection) {
      this.connection = connection;
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
    this.sync();
    const snapshot = {
      poolToken: this.token, generation: this.generation, nextSlot: this.nextSlot(),
      playback: this.playback, status: this.refreshing ? 'refreshing' : this.status, message: this.message,
      gate: this.store.obs()?.replayLaunchGate?.() || 'off',
      rows: this.store.state.pool.map(slot => {
        const options = this.replayOptions(slot.id);
        return { slotId: slot.id, options, selectedId: this.selectedId(slot.id, options) };
      }),
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

  async refresh(source) {
    if (!source || this.status === 'stale') return;
    const task = Symbol();
    this.refreshing = task;
    this.message = '';
    this.emit();
    const input = { edition: source.edition, poolId: source.pool.id, version: source.pool.version, connection: this.connection };
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
    let staged;
    let isCurrent = () => true;
    const local = this.local.get(slotId);
    const validate = () => {
      this.sync();
      if (this.closed || this.playback !== playback) throw new Error(poolChanged);
      if (!isCurrent()) throw new Error('OCLR 授权已切换，请刷新回放后重试。');
    };
    const notify = (phase, message = '') => {
      if (!activePhases.includes(phase) && staged) void staged.dispose();
      if (this.playback !== playback) return;
      Object.assign(playback, { phase, message });
      if (phase === 'completed') {
        this.cursor = slotId;
        this.next = null;
      }
      this.emit();
    };
    try {
      if (local?.option.id !== id) {
        let read;
        try {
          read = await this.streaming.readShowcase({ edition: source.edition, poolId: source.pool.id,
            version: source.pool.version, connection: this.connection, replayId: id });
        } catch (error) {
          this.sync();
          if (this.playback === playback && source === this.store.state.website && error.status) this.websiteError(error);
          throw error;
        }
        isCurrent = read.isCurrent;
        validate();
        staged = await stageReplayFile(read.data);
      }
      const launch = await this.prepareReplay((staged || local.file).path);
      await obs.launchShowcaseReplay({ map: String(slot.beatmapId), slotId, programRevision, launch, validate, notify });
    } catch (error) {
      if (this.playback === playback && playback.phase === 'loading') notify('failed', this.status === 'stale' ? this.message : error.message);
      else if (staged) void staged.dispose();
    }
  }

  async command(input, bytes) {
    const source = this.sync();
    if (this.closed || input?.poolToken !== this.token) throw new Error(poolChanged);
    if (this.refreshing && input.action === 'refresh') return this.snapshot();
    if (this.refreshing || activePhases.includes(this.playback.phase)) throw new Error('正在处理回放，请等当前操作结束。');
    if (input.action === 'refresh') await this.refresh(source);
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
