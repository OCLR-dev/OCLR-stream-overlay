import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { currentPoolEntry, playingLayout } from '../../src/playing-layout.js';
import { ObsError, ObsSocket } from './socket.js';
import { arrangeCaptures, buildPreset, ensureDesktopAudio, exPositions, inspectWindows, measureScenes, newPreset, presetScenes } from './presets.js';

const defaults = () => ({ enabled: false, port: 4455, password: '', profiles: [] });
const emptyProfile = name => ({ name, regular: '', ex: '', follow: false, preset: null });
const changed = 'OBS 连接或场景集合已切换，请核对当前场景后重试。';
const safeMessage = error => error instanceof ObsError ? error.message : 'OBS 操作未完成，请核对本机存储和 OBS 后重试。';

export class ObsController {
  constructor({ file, overlayUrl, Socket = ObsSocket, retryMs = 3500, scanMs = 6000 }) {
    this.file = file;
    this.overlayUrl = overlayUrl;
    this.Socket = Socket;
    this.retryMs = retryMs;
    this.scanMs = scanMs;
    this.settings = defaults();
    this.tail = Promise.resolve();
    this.epoch = 0;
    this.programRevision = 0;
    this.phase = 'off';
    this.error = '';
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
    this.unsubscribe = store.subscribe(({ session }) => this.observe(session));
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
  snapshot() {
    const p = this.profile;
    return { enabled: this.settings.enabled, port: this.settings.port, hasPassword: !!this.settings.password,
      phase: this.phase, collection: this.collection, program: this.program, scenes: this.scenes,
      regular: p.regular, ex: p.ex, follow: p.follow, target: this.target ?? null,
      managed: !!this.managed, lineup: this.managed ? p.preset.lineup : [], ...this.captures,
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
    this.collection = null;
    this.program = null;
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
    return async (type, args) => {
      this.guard(epoch);
      const result = await this.socket.request(type, args);
      this.guard(epoch);
      return result;
    };
  }

  disconnect() {
    clearTimeout(this.retryTimer);
    const old = this.socket;
    this.socket = null;
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
        this.invalidate();
        this.phase = 'offline';
        this.error = message;
        this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
        this.retryTimer.unref?.();
      } });
    this.socket = socket;
    socket.ready.then(() => { if (this.socket === socket && !socket.closed) this.loadCollection(); }, () => {});
  }

  event(type, data) {
    if (type === 'CurrentProgramSceneChanged') {
      this.programRevision++;
      this.program = data.sceneName;
    } else if (type === 'SceneListChanged') {
      this.setScenes(data.scenes);
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
    if (revision === this.programRevision) this.program = result.sceneName || result.currentProgramSceneName;
    return this.program;
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
      this.phase = 'ready';
      this.error = '';
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
    if (!p.regular || !p.ex || !this.target) throw new ObsError('请核对常规人数为 4v4，并在开播前设置中绑定两个场景。');
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
    await this.saveProfile({ ...profile, ...presetScenes, sceneIds: preset.sceneIds, follow: alreadyBound ? profile.follow : true, preset });
    const { scenes } = await call('GetSceneList');
    this.setScenes(scenes);
    await ensureDesktopAudio(call, preset, desktopAudio =>
      this.saveProfile({ ...this.profile, preset: { ...preset, desktopAudio } }));
    await this.scan(call, preset, { useDesktopAudio: true });
    this.scheduleSync();
  }

  command(input) {
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
        if (input.action === 'create') await this.create(call, p);
        else if (input.action === 'bind') {
          if (!['regular', 'ex'].includes(input.layout) || !this.scenes.includes(input.name) ||
              input.name === p[input.layout === 'ex' ? 'regular' : 'ex']) throw new ObsError('请为常规与 EX 选择两个不同的现有场景。');
          await this.saveProfile({ ...p, [input.layout]: input.name, sceneIds: { ...p.sceneIds, [input.layout]: this.sceneIds.get(input.name) || null } });
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
        } else throw new ObsError('请在开播前设置中核对当前绑定的比赛场景。');
      }
      return this.snapshot();
    });
  }

  close() { this.closed = true; this.unsubscribe?.(); this.disconnect(); }
}

export async function attachObs(config, store) {
  config.obs = await new ObsController({ file: store.file && join(dirname(store.file), 'obs-settings.json'),
    overlayUrl: () => `http://127.0.0.1:${config.port}/overlay` }).start(store);
}
