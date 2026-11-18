import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { currentPoolEntry, playingLayout } from '../../src/playing-layout.js';
import { ObsError, ObsSocket } from './socket.js';
import { ObsOutputs } from './outputs.js';
import { RecordingTimeline } from './recording-timeline.js';
import { syncBrowserAddresses } from './browser-addresses.js';
import { chatIdentityCode, ensureStreamChat } from './stream-chat.js';
import { buildShowcase, installShowcaseCover, installShowcaseArtwork, setShowcaseCover, showcaseScene } from './showcase.js';
import { normalizeShowcaseTokens, ordinaryClient, ShowcaseReplay, showcaseTokensUrl } from './showcase-replay.js';
import { TosuClient } from '../../src/tosu.js';
import { arrangeCaptures, buildPreset, ensureDesktopAudio, exPositions, inspectWindows, measureScenes, newPreset, presetScenes } from './presets.js';

const defaults = () => ({ enabled: false, port: 4455, password: '', profiles: [] });
const emptyProfile = name => ({ name, regular: '', ex: '', follow: false, preset: null });
const changed = 'OBS 连接或场景集合已切换，请核对当前场景后重试。';
const safeMessage = error => error instanceof ObsError ? error.message : 'OBS 操作未完成，请核对本机存储和 OBS 后重试。';

export class ObsController {
  constructor({ file, overlayUrl, Socket = ObsSocket, retryMs = 3500, scanMs = 6000, tosuUrl = null, ReplayClient = TosuClient, resultsMs = 3500 }) {
    this.file = file;
    this.overlayUrl = overlayUrl;
    this.Socket = Socket;
    this.retryMs = retryMs;
    this.scanMs = scanMs;
    this.settings = defaults();
    this.tail = Promise.resolve();
    this.epoch = 0;
    this.programRevision = 0;
    this.outputs = new ObsOutputs();
    this.phase = 'off';
    this.error = '';
    this.coverListeners = new Set();
    this.completedReplay = null;
    this.replay = new ShowcaseReplay(() => {
      if (this.replay.phase === 'results') this.completedReplay = { map: this.replay.run.map, serial: (this.completedReplay?.serial || 0) + 1 };
      this.scheduleShowcase();
    }, resultsMs);
    this.replayClient = new ReplayClient({ url: showcaseTokensUrl(tosuUrl), normalize: normalizeShowcaseTokens,
      onStatus: status => {
        if (this.showcaseActive && status !== 'live') this.discardReplay();
      },
      onFrame: frame => this.observeReplay(frame),
    });
    this.invalidate();
  }

  async start(store) {
    if (this.file) {
      try {
        const saved = JSON.parse(await readFile(this.file, 'utf8'));
        if (typeof saved.enabled !== 'boolean' || !Number.isInteger(saved.port) || saved.port < 1 || saved.port > 65535 ||
            typeof saved.password !== 'string' || !Array.isArray(saved.profiles)) throw new Error();
        this.settings = saved;
      } catch (error) {
        if (error.code !== 'ENOENT') this.storageError = 'OBS 设置文件无法读取，请维护者检查 obs-settings.json 后重启服务。';
      }
    }
    if (!this.storageError) {
      try {
        const port = new URL(this.overlayUrl()).port || '80';
        const ports = Array.isArray(this.settings.overlayPorts) ? this.settings.overlayPorts.filter(p => typeof p === 'string') : [];
        if (!ports.includes(port)) await this.save({ ...this.settings, overlayPorts: [...ports, port] });
      } catch { this.storageError = 'OBS 地址设置无法保存，请检查本机存储后重启服务。'; }
    }
    this.recording = new RecordingTimeline(store.file && join(dirname(store.file), 'recording-timelines'), () => {
      const socket = this.socket;
      return this.outputs.timestamp(socket, () => socket === this.socket && !socket.closed);
    });
    this.unsubscribe = store.subscribe(({ session, live }) => {
      this.recording.observe(session, live?.tosu);
      this.observe(session);
      this.observeShowcaseClient(live?.tosu);
    });
    if (this.settings.enabled && !this.storageError) this.connect();
    return this;
  }

  observe(session) {
    if (session.id === this.matchId && session.version === this.version) return;
    this.matchId = session.id;
    this.version = session.version;
    const { ex } = playingLayout(session.match.mode, session.ex.team, currentPoolEntry(session)?.mod === 'TB');
    const target = session.match.mode === '4v4' && session.match.stage !== 'exhibition' ? (ex ? 'ex' : 'regular') : null;
    if (this.target === target && this.source === session.match.source) return;
    this.target = target;
    this.source = session.match.source;
    this.scheduleSync();
  }

  get profile() { return this.settings.profiles.find(p => p.name === this.collection) || emptyProfile(this.collection); }
  get managed() {
    const p = this.profile;
    return p.preset?.ready && p.regular === presetScenes.regular && p.ex === presetScenes.ex &&
      !this.missing({ ...presetScenes, sceneIds: p.preset.sceneIds });
  }
  missing(profile) {
    if (profile.preset?.pendingLayouts?.length && profile.regular === presetScenes.regular && profile.ex === presetScenes.ex) {
      return '比赛场景尚未建完，请点「创建比赛场景」继续。';
    }
    for (const [key, label] of [['regular', '常规'], ['ex', ' EX ']]) {
      const name = profile[key], uuid = profile.sceneIds?.[key];
      if (name && (!this.scenes.includes(name) || (uuid && this.sceneIds.get(name) !== uuid))) {
        const presetScene = profile.preset && name === presetScenes[key] && uuid === profile.preset.sceneIds[key];
        if (presetScene && !this.scenes.includes(name) && !(uuid && [...this.sceneIds.values()].includes(uuid))) {
          return `找不到${label}场景，请点「创建比赛场景」补建。`;
        }
        return `找不到${label}场景，请在 OBS 手动切换或重新绑定。`;
      }
    }
    return '';
  }
  get showcaseConfigured() {
    const { showcase } = this.profile;
    return !!showcase?.ready && this.scenes.includes(showcaseScene) &&
      (!showcase.sceneUuid || this.sceneIds.get(showcaseScene) === showcase.sceneUuid);
  }

  setTosuUrl(url) {
    this.showcaseClient = null;
    this.discardReplay();
    this.replay.reset();
    this.replayClient.setUrl(showcaseTokensUrl(url));
  }

  discardReplay() {
    this.latestReplay = null;
    // A manual reveal remains an explicit operator override until the next cover.
    if (this.replay.phase !== 'manual') this.replay.reset();
  }

  observeShowcaseClient(source) {
    this.showcaseClient = source;
    if (!this.showcaseActive || !this.latestReplay) return;
    if (!this.replayClientMatches(this.latestReplay) || ![2, 7].includes(source.data?.state?.number)) this.discardReplay();
    else this.replay.observeResult(source.data.resultIdentity);
  }

  replayClientMatches(frame) {
    const source = this.showcaseClient;
    const age = Date.now() - Date.parse(source?.updatedAt);
    return source?.status === 'live' && age >= 0 && age < 5000 && ordinaryClient(source.data, frame.map);
  }

  observeReplay(frame) {
    if (!this.showcaseActive) return;
    if (!this.replayClientMatches(frame)) { this.discardReplay(); return; }
    this.latestReplay = frame;
    this.replay.observe(frame, this.showcaseConfirmed, this.showcaseClient.data.state?.number);
    this.replay.observeResult(this.showcaseClient.data.resultIdentity);
  }

  refreshShowcase() {
    const configured = this.phase === 'ready' && this.showcaseConfigured && this.profile.showcase.transition?.ready;
    const active = !!configured && this.program === showcaseScene;
    if (active !== !!this.showcaseActive) {
      this.showcaseActive = active;
      this.latestReplay = null;
      this.showcaseConfirmed = null;
      this.replay.reset();
      if (active) this.replayClient.start();
      else this.replayClient.stop();
    }
    if (configured) this.scheduleShowcase();
  }

  scheduleShowcase(verify = false) {
    this.emitCover();
    if (this.phase !== 'ready' || !this.showcaseConfigured || !this.profile.showcase.transition?.ready ||
        this.showcaseSync === this.epoch || (!verify && this.showcaseConfirmed === this.replay.covered)) return;
    const epoch = this.epoch;
    this.showcaseSync = epoch;
    void this.queue(async () => {
      let applied;
      try {
        this.guard(epoch);
        applied = await this.applyShowcase(this.caller(epoch));
      } finally {
        if (this.showcaseSync === epoch) this.showcaseSync = null;
      }
      if (epoch === this.epoch && (applied === null || this.showcaseConfirmed !== this.replay.covered)) this.scheduleShowcase();
    }).catch(error => {
      if (epoch === this.epoch) {
        this.showcaseConfirmed = null;
        this.showcaseError = safeMessage(error);
        this.emitCover();
      }
    });
  }

  async applyShowcase(call) {
    if (!this.showcaseConfigured || !this.profile.showcase.transition?.ready) return this.replay.covered;
    const profile = this.profile.showcase;
    const covered = this.replay.covered;
    const revision = this.programRevision;
    const current = () => this.showcaseConfigured && this.profile.showcase === profile && covered === this.replay.covered &&
      revision === this.programRevision && (covered || this.showcaseActive);
    const confirmed = await setShowcaseCover(call, profile, covered, current);
    if (confirmed === null || !current()) {
      this.showcaseConfirmed = null;
      return null;
    }
    this.showcaseConfirmed = confirmed;
    this.showcaseError = '';
    this.emitCover();
    return confirmed;
  }

  coverSnapshot() {
    return { covered: !this.showcaseActive || this.replay.covered || this.showcaseConfirmed !== false,
      instant: this.replay.instant, completed: this.completedReplay };
  }

  subscribeCover(listener) { this.coverListeners.add(listener); return () => this.coverListeners.delete(listener); }
  emitCover() { for (const listener of this.coverListeners) listener(); }

  snapshot() {
    const p = this.profile;
    return { enabled: this.settings.enabled, port: this.settings.port, hasPassword: !!this.settings.password,
      phase: this.phase, collection: this.collection, program: this.program, programRevision: this.programRevision, scenes: this.scenes,
      stream: this.outputs.stream, record: this.outputs.record, recordingError: this.recording?.status(),
      regular: p.regular, ex: p.ex, follow: p.follow, target: this.target ?? null,
      managed: !!this.managed, lineup: this.managed ? p.preset.lineup : [], ...this.captures,
      streamChat: !p.streamChat?.code ? 'off' : p.streamChat.pending ? 'pending' : 'configured',
      showcase: this.showcaseConfigured,
      showcaseTransition: { configured: !!p.showcase?.transition?.ready, artwork: !!p.showcase?.transition?.artwork?.ready, active: !!this.showcaseActive,
        covered: this.showcaseConfirmed ?? null, phase: this.replay.phase, error: this.showcaseError || '' },
      error: this.storageError || this.error || this.missing(p) };
  }

  queue(fn) { const task = this.tail.then(fn); this.tail = task.catch(() => {}); return task; }
  async save(next) {
    if (this.storageError) throw new ObsError(this.storageError);
    if (this.file) {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = this.file + '.tmp';
      await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
      await rename(temp, this.file);
    }
    this.settings = next;
  }
  async saveProfile(profile) {
    await this.save({ ...this.settings, profiles: [...this.settings.profiles.filter(p => p.name !== profile.name), profile] });
  }

  invalidate() {
    this.epoch++;
    this.showcaseActive = false;
    this.latestReplay = null;
    this.showcaseConfirmed = null;
    this.showcaseError = '';
    this.replayClient.stop();
    this.collection = null;
    this.replay.reset();
    this.program = null;
    this.programRevision++;
    this.setScenes([]);
    this.captures = { windows: [], rows: [] };
    clearTimeout(this.scanTimer);
  }
  setScenes(scenes) {
    this.scenes = scenes.map(s => s.sceneName);
    this.sceneIds = new Map(scenes.map(s => [s.sceneName, s.sceneUuid]));
  }
  guard(epoch) { if (epoch !== this.epoch || !this.socket || this.socket.closed) throw new ObsError(changed); }
  caller(epoch) {
    return async (type, args, options) => {
      this.guard(epoch);
      const result = await this.socket.request(type, args, options);
      this.guard(epoch);
      return result;
    };
  }

  disconnect() {
    clearTimeout(this.retryTimer);
    const old = this.socket;
    this.socket = null;
    this.outputs.reset();
    this.invalidate();
    this.phase = 'off';
    old?.close();
  }
  connect() {
    if (this.closed) return;
    this.disconnect();
    this.phase = 'connecting';
    const socket = new this.Socket({ port: this.settings.port, password: this.settings.password,
      onEvent: (type, data) => { if (this.socket === socket) this.event(type, data); },
      onClose: message => {
        if (this.socket !== socket) return;
        this.outputs.reset();
        this.invalidate();
        this.phase = 'offline';
        this.error = message;
        this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
        this.retryTimer.unref?.();
      } });
    this.socket = socket;
    const current = () => this.socket === socket && !socket.closed;
    socket.ready.then(() => {
      if (!current()) return;
      void this.outputs.initialize(socket, current);
      this.loadCollection();
    }, () => {});
  }

  event(type, data) {
    if (type === 'StreamStateChanged' || type === 'RecordStateChanged') {
      this.outputs.event(type, data);
    } else if (type === 'CurrentProgramSceneChanged' || (type === 'SceneNameChanged' && data.oldSceneName === this.program)) {
      this.programRevision++;
      this.program = data.sceneName;
      this.refreshShowcase();
    } else if (type === 'SceneListChanged') {
      this.setScenes(data.scenes);
      this.refreshShowcase();
    } else if (['SceneItemCreated', 'SceneItemRemoved', 'SceneItemListReindexed', 'SceneItemEnableStateChanged'].includes(type) &&
        (data.sceneName === showcaseScene || (data.sceneUuid && data.sceneUuid === this.profile.showcase?.sceneUuid))) {
      if (this.showcaseSync !== this.epoch) {
        if (this.replay.covered) this.showcaseConfirmed = null;
        this.scheduleShowcase(true);
      }
    } else if (type === 'CurrentSceneCollectionChanging') {
      this.invalidate();
      this.phase = 'connecting';
    } else if (type === 'CurrentSceneCollectionChanged') {
      this.loadCollection();
    }
  }
  async readProgram(call) {
    const revision = this.programRevision;
    const result = await call('GetCurrentProgramScene');
    const program = result.sceneName || result.currentProgramSceneName;
    if (revision === this.programRevision && program !== this.program) {
      this.program = program;
      this.programRevision++;
    }
    return this.program;
  }
  async programFrame() {
    const { program, programRevision, epoch } = this;
    if (this.phase !== 'ready' || !program) return null;
    let image = null;
    try {
      const { imageData } = await this.caller(epoch)('GetSourceScreenshot', {
        sourceName: program, imageFormat: 'jpeg', imageWidth: 640, imageCompressionQuality: 75,
      }, { resetOnTimeout: false });
      if (imageData?.startsWith('data:image/jpeg;base64,')) image = imageData;
    } catch {}
    if (this.phase !== 'ready' || epoch !== this.epoch || programRevision !== this.programRevision) return null;
    return { program, programRevision, image };
  }

  async markRecording(matchId) {
    if (!await this.recording.manual(matchId)) throw new ObsError('录像未在进行，未添加打点。');
    return this.snapshot();
  }

  loadCollection() {
    this.invalidate();
    const epoch = this.epoch;
    const call = this.caller(epoch);
    this.phase = 'connecting';
    void this.queue(async () => {
      const { currentSceneCollectionName } = await call('GetSceneCollectionList');
      const { scenes } = await call('GetSceneList');
      this.setScenes(scenes);
      await this.readProgram(call);
      this.collection = currentSceneCollectionName;
      await syncBrowserAddresses(call, this.overlayUrl(), this.settings.overlayPorts ?? [], this.profile);
      this.phase = 'ready';
      this.error = '';
      this.refreshShowcase();
      const profile = this.profile;
      if (profile.streamChat?.code && ((profile.regular && profile.ex && !this.missing(profile)) || this.snapshot().showcase)) {
        try { await this.placeStreamChat(call); }
        catch (error) { this.guard(epoch); this.error = safeMessage(error); }
      }
      this.scheduleSync();
      if (this.managed) this.scheduleScan(0);
    }).catch(error => {
      if (epoch !== this.epoch) return;
      this.socket?.close();
      this.error = safeMessage(error);
    });
  }

  scheduleSync() {
    if (this.phase !== 'ready' || this.syncEpoch === this.epoch) return;
    const epoch = this.epoch;
    this.syncEpoch = epoch;
    void this.queue(async () => {
      if (this.syncEpoch === epoch) this.syncEpoch = null;
      this.guard(epoch);
      await this.sync(this.caller(epoch), false);
    }).catch(error => { if (epoch === this.epoch) this.error = safeMessage(error); });
  }
  async sync(call, force) {
    const p = this.profile;
    if (!force && (!p.follow || !this.target)) return;
    if (!p.regular || !p.ex || !this.target) throw new ObsError('请核对常规人数为 4v4，并在比赛配置中绑定两个场景。');
    const missing = this.missing(p);
    if (missing) throw new ObsError(missing);
    if (this.managed) await this.align(call, p);
    const actual = await this.readProgram(call);
    const layout = this.target, target = p[layout];
    if (!target || (!force && actual !== p.regular && actual !== p.ex) || actual === target) return;
    const replaced = this.missing(p);
    if (replaced) throw new ObsError(replaced);
    const sceneUuid = p.sceneIds?.[layout];
    try { await call('SetCurrentProgramScene', sceneUuid ? { sceneUuid } : { sceneName: target }); }
    catch { throw new ObsError(`未能切到「${target}」，请在 OBS 手动切换或重新绑定。`); }
    await this.readProgram(call);
    this.error = '';
  }

  async align(call, profile) {
    const preset = profile.preset;
    const source = this.source;
    if (preset.appliedSource === source && !preset.lineupDirty) return;
    await arrangeCaptures(call, preset, source, preset.appliedSource === source ? ['ex'] : ['regular', 'ex']);
    await this.saveProfile({ ...profile, preset: { ...preset, appliedSource: source, lineupDirty: false } });
  }

  scheduleScan(delay = this.scanMs) {
    clearTimeout(this.scanTimer);
    if (!this.managed) return;
    const epoch = this.epoch;
    this.scanTimer = setTimeout(() => {
      void this.queue(async () => {
        this.guard(epoch);
        if (this.managed) await this.scan(this.caller(epoch), this.profile.preset);
      }).catch(error => { if (epoch === this.epoch) this.error = safeMessage(error); });
    }, delay);
    this.scanTimer.unref?.();
  }
  async scan(call, preset, options) {
    const captures = await inspectWindows(call, preset, options);
    this.captures = captures;
    clearTimeout(this.scanTimer);
    if (captures.rows.some(row => row.status !== '已绑定' && row.status !== '手动留空')) this.scheduleScan();
  }

  async create(call, profile) {
    const previous = profile.preset ?? await newPreset(call);
    const preset = await buildPreset(call, previous, this.overlayUrl(), this.source,
      progress => this.saveProfile({ ...profile, preset: progress }));
    const alreadyBound = profile.regular === presetScenes.regular && profile.ex === presetScenes.ex;
    await this.saveProfile({ ...profile, ...presetScenes, sceneIds: preset.sceneIds, follow: alreadyBound ? profile.follow : true, preset,
      ...(profile.streamChat?.code && { streamChat: { ...profile.streamChat, pending: true } }) });
    const { scenes } = await call('GetSceneList');
    this.setScenes(scenes);
    await ensureDesktopAudio(call, preset, progress =>
      this.saveProfile({ ...this.profile, preset: { ...this.profile.preset, ...progress } }));
    if (this.profile.streamChat?.code) await this.placeStreamChat(call);
    await this.scan(call, preset, { useDesktopAudio: true });
    this.scheduleSync();
  }

  async placeStreamChat(call) {
    const profile = this.profile;
    // A standalone Showcase can use chat before either competition layout exists.
    const matchReady = profile.regular && profile.ex && !this.missing(profile);
    const targets = { ...profile, regular: matchReady ? profile.regular : '', ex: matchReady ? profile.ex : '',
      showcase: this.snapshot().showcase ? profile.showcase : null };
    if (!matchReady && !targets.showcase) throw new ObsError(this.missing(profile) || '请先创建 Showcase 或比赛场景。');
    await ensureStreamChat(call, targets, streamChat => this.saveProfile({ ...profile, streamChat }));
  }

  async createShowcase(call, profile) {
    const url = new URL(this.overlayUrl());
    url.pathname = '/showcase';
    url.search = '?clean=1';
    url.hash = '';
    await buildShowcase(call, profile.showcase, url.href,
      showcase => this.saveProfile({ ...this.profile, showcase }));
    const { scenes } = await call('GetSceneList');
    this.setScenes(scenes);
    if (this.profile.streamChat?.code) await this.placeStreamChat(call);
    this.refreshShowcase();
  }

  command(input) {
    if (input.action === 'mark-recording') return this.markRecording(input.matchId);
    const epoch = this.epoch;
    return this.queue(async () => {
      if (this.closed) throw new ObsError(changed);
      if (this.storageError) throw new ObsError(this.storageError);
      this.error = '';
      if (input.action === 'connect') {
        const { port, password } = input;
        if (!Number.isInteger(port) || port < 1 || port > 65535 || typeof password !== 'string' || password.length > 1024) throw new ObsError('请核对本机 OBS 端口和密码。');
        await this.save({ ...this.settings, enabled: true, port, password: password || this.settings.password });
        this.connect();
      } else if (input.action === 'disconnect') {
        await this.save({ ...this.settings, enabled: false });
        this.disconnect();
      } else {
        this.guard(epoch);
        if (this.phase !== 'ready') throw new ObsError('请先连接本机 OBS，再操作场景。');
        if (input.collection && input.collection !== this.collection) throw new ObsError(changed);
        const call = this.caller(epoch);
        const p = this.profile;
        if (input.action === 'create-showcase') await this.createShowcase(call, p);
        else if (input.action === 'setup-showcase-transition') {
          if (!this.showcaseConfigured) throw new ObsError('请先创建 Showcase 场景。');
          this.showcaseConfirmed = null;
          this.replay.reset();
          try {
            await installShowcaseCover(call, p.showcase, transition =>
              this.saveProfile({ ...this.profile, showcase: { ...this.profile.showcase, transition } }));
            const url = new URL('/showcase?clean=1&layer=cover', this.overlayUrl()).href;
            await installShowcaseArtwork(call, this.profile.showcase, url, artwork =>
              this.saveProfile({ ...this.profile, showcase: { ...this.profile.showcase,
                transition: { ...this.profile.showcase.transition, artwork } } }));
            this.showcaseConfirmed = true;
            this.showcaseError = '';
          } finally { this.refreshShowcase(); }
        } else if (['cover-showcase', 'reveal-showcase'].includes(input.action)) {
          if (!this.showcaseActive) throw new ObsError('请先将 Showcase 切到 OBS 播出并配置过场。');
          const covered = input.action === 'cover-showcase';
          this.replay.manual(covered, this.latestReplay);
          if (await this.applyShowcase(call) !== covered || this.showcaseConfirmed !== covered) throw new ObsError(changed);
        } else if (input.action === 'create') await this.create(call, p);
        else if (input.action === 'stream-chat') {
          const code = chatIdentityCode(input.code ?? p.streamChat?.code);
          await this.saveProfile({ ...p, streamChat: { ...p.streamChat, code, pending: true } });
          if ((p.regular && p.ex) || p.showcase?.ready) await this.placeStreamChat(call);
        } else if (input.action === 'bind') {
          if (!['regular', 'ex'].includes(input.layout) || !this.scenes.includes(input.name) ||
              input.name === p[input.layout === 'ex' ? 'regular' : 'ex']) throw new ObsError('请为常规与 EX 选择两个不同的现有场景。');
          await this.saveProfile({ ...p, [input.layout]: input.name, sceneIds: { ...p.sceneIds, [input.layout]: this.sceneIds.get(input.name) || null },
            ...(p.streamChat?.code && { streamChat: { ...p.streamChat, pending: true } }) });
          if (this.profile.streamChat?.code && this.profile.regular && this.profile.ex) await this.placeStreamChat(call);
          this.captures = { windows: [], rows: [] };
          if (this.managed) this.scheduleScan(0);
          this.scheduleSync();
        } else if (input.action === 'follow') {
          if (typeof input.enabled !== 'boolean' || (input.enabled && (!p.regular || !p.ex || this.missing(p)))) throw new ObsError('请先绑定两个现有比赛场景。');
          await this.saveProfile({ ...p, follow: input.enabled });
          this.scheduleSync();
        } else if (input.action === 'return') {
          await this.sync(call, true);
        } else if (input.action === 'measure' && p.regular && p.ex) {
          const measurements = await measureScenes(call, p, this.managed);
          return { ...this.snapshot(), measurements };
        } else if (input.action === 'scan' && this.managed) {
          await this.scan(call, p.preset);
        } else if (input.action === 'window' && this.managed) {
          const manualEmpty = p.preset.manualEmpty.filter(slot => slot !== input.slot);
          if (input.value === '') manualEmpty.push(input.slot);
          const preset = { ...p.preset, manualEmpty };
          await this.scan(call, preset, { edit: input });
          await this.saveProfile({ ...p, preset });
        } else if (input.action === 'lineup' && this.managed) {
          const index = exPositions.indexOf(input.position);
          if (index < 0 || !/^[AB][1-4]$/.test(input.slot) || input.slot[0] !== input.position[0]) throw new ObsError('请为这个 EX 位置选择同队的捕获源。');
          const lineup = [...p.preset.lineup];
          const previous = lineup.indexOf(input.slot);
          if (previous !== -1) lineup[previous] = lineup[index];
          lineup[index] = input.slot;
          const profile = { ...p, preset: { ...p.preset, lineup, lineupDirty: true } };
          await this.saveProfile(profile); // A retry/reconnect can finish interrupted transforms.
          await this.align(call, profile);
        } else throw new ObsError('请在比赛配置中核对当前绑定的比赛场景。');
      }
      return this.snapshot();
    });
  }

  close() { this.closed = true; this.unsubscribe?.(); this.disconnect(); }
}

export async function attachObs(config, store) {
  config.obs = await new ObsController({ file: store.file && join(dirname(store.file), 'obs-settings.json'),
    tosuUrl: config.wsUrl, overlayUrl: () => `http://127.0.0.1:${config.port}/overlay` }).start(store);
}
