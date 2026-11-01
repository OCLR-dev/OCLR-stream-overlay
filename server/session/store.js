import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { automaticTransition, bpProgress, currentRound, entryOf, newSession, requireValue, restoreAutomation, seriesOf, transition } from './model.js';
import { RoomAutomation } from './automation.js';
import { rankingMapParameters } from './map-parameters.js';
import { PickSceneDelay } from './pick-scene-delay.js';
import { SeriesCorrectionTracker } from './series-correction.js';
import { SpectatorRecovery } from './spectator-recovery.js';

export class SessionStore {
  constructor({ file = null, state = newSession() } = {}) {
    this.file = file; this.state = restoreAutomation(state); this.listeners = new Set(); this.automation = new RoomAutomation();
    this.parameterHold = null;
    this.seriesCorrection = new SeriesCorrectionTracker();
    this.spectatorRecovery = new SpectatorRecovery();
    this.live = { tosu: { status: 'idle', updatedAt: null, data: null }, oclr: { status: 'idle', updatedAt: null, error: null }, note: '等待房间资料，自动化意图保持开启' };
    this.persistence = file ? 'ready' : 'memory'; this.tail = Promise.resolve();
    this.pickScene = new PickSceneDelay(token => this.enqueue(async () => {
      if (!this.pickScene.matches(token, this.state)) return;
      this.pickScene.cancel();
      const next = automaticTransition(this.state, draft => {
        draft.scene = 'playing'; draft.sceneOverride = null;
      }, '本次 Pick 展示满 2.5 秒：自动切到 Playing（本局仍待开打）', randomUUID(), { undo: false });
      await this.save(next);
      this.emit();
    }).catch(() => { this.live.note = '自动切换画面未保存，请检查本机存储'; this.emit(); }));
  }

  static async open(file) {
    let state;
    try {
      state = JSON.parse(await readFile(file, 'utf8'));
      if (state.schema !== 1 || !Number.isSafeInteger(state.version) || !state.match || !Array.isArray(state.rounds) || !Array.isArray(state.commandIds)) throw new Error('INVALID_SESSION_FILE');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('SESSION_RESTORE_FAILED');
    }
    return new SessionStore({ file, state });
  }

  snapshot() {
    const { undo, commandIds, ...session } = this.state;
    return structuredClone({ session: { ...session, bp: bpProgress(this.state), series: seriesOf(this.state), canUndo: undo.length > 0 }, live: this.live, persistence: this.persistence, catalog: this.catalog || null });
  }
  subscribe(listener) { this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener); }
  emit() { const value = this.snapshot(); for (const listener of this.listeners) listener(value); }
  enqueue(fn) { const task = this.tail.then(fn); this.tail = task.catch(() => {}); return task; }
  close() { this.pickScene.cancel(); }

  async save(next, { allowPickScene = true } = {}) {
    if (this.file) {
      try {
        await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
        await writeFile(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 });
        await rename(`${this.file}.tmp`, this.file);
      } catch {
        this.persistence = 'error'; this.emit(); throw new Error('会话保存失败，操作未应用，请检查本机存储');
      }
    }
    this.persistence = this.file ? 'ready' : 'memory';
    const before = this.state;
    this.state = next;
    this.pickScene.update(before, next, allowPickScene);
  }

  command(command) {
    return this.enqueue(async () => {
      if (command.type === 'resolve-incident' && !this.state.commandIds.includes(command.id) && currentRound(this.state)?.status === 'playing') {
        const room = this.live.tosu.data?.tourney;
        requireValue(this.live.tosu.status === 'live' && room?.ipcState === 3 &&
          this.live.tosu.data?.beatmap.id === entryOf(this.state, currentRound(this.state).entryId)?.beatmapId &&
          room.teams.left === this.state.auto.left && room.teams.right === this.state.auto.right &&
          room.players.some(p => p.side === 'left' && p.osuId > 0) && room.players.some(p => p.side === 'right' && p.osuId > 0),
        '尚未恢复到本图有效 Playing；请等待观战恢复，或由裁判确认重赛 / 人工核对赛果');
      }
      // Reset only the continuity whose meaning changed. Display, Roll, marks,
      // counters, future actions and unrelated corrections do not lose a finish.
      const continuity = state => {
        const round = currentRound(state);
        return JSON.stringify([state.id, state.auto.profile, state.auto.left, state.auto.right, state.paused, state.incident,
          round?.id, round?.entryId, entryOf(state, round?.entryId)?.beatmapId, round?.status, round?.runId]);
      };
      let effective = command;
      if (command.type === 'set-series') {
        const { finishRoundId: ignored, ...payload } = command.payload || {};
        effective = { ...command, payload: { ...payload,
          ...(this.seriesCorrection.canFinish(this.state, this.live.tosu, Date.now() - this.receivedAt < 5000)
            ? { finishRoundId: this.state.currentRoundId } : {}) } };
      }
      const next = transition(this.state, effective);
      if (next !== this.state) {
        // Archive before replacing the match, without exposing local files over HTTP.
        if (command.type === 'next-match' && this.file) {
          await mkdir(`${dirname(this.file)}/archive`, { recursive: true, mode: 0o700 });
          await writeFile(`${dirname(this.file)}/archive/${this.state.id}-${this.state.version}.json`, JSON.stringify(this.state), { mode: 0o600 });
        }
        const reset = continuity(next) !== continuity(this.state);
        const changedAction = next.action?.id !== this.state.action?.id || next.auto.bp !== this.state.auto.bp;
        const changedResults = next.auto.results !== this.state.auto.results;
        await this.save(next, { allowPickScene: !['undo', 'replay', 'referee-replay', 'resume', 'resolve-incident'].includes(command.type) });
        if (command.type === 'set-series' && !next.incident && !next.paused && currentRound(next)?.resultSource === 'series-correction') {
          this.live.note = '系列比分已确认，本图已处理；自动流程等待下一图，无需再单独记胜';
        }
        if (['display', 'undo', 'replay', 'referee-replay'].includes(command.type)) this.pickScene.cancel();
        if (reset) {
          this.spectatorRecovery.reset();
          if (this.live.tosu.status === 'live' && Date.now() - this.receivedAt < 5000) {
            this.automation.rebase(next, this.live.tosu.data, Date.parse(this.live.tosu.updatedAt));
          } else this.automation.reset();
        }
        else if (changedAction) this.automation.pending = null;
        if (changedResults) { this.automation.endRun = null; this.automation.scoreCandidate = null; }
        if (command.type === 'set-series' && currentRound(next)?.status === 'ranking') this.automation.endRun = null;
        this.emit();
      }
      return this.snapshot();
    });
  }

  sourceStatus(status) {
    return this.enqueue(async () => { if (status !== 'live') {
      this.pickScene.cancel();
      this.seriesCorrection.reset();
      this.spectatorRecovery.reset();
      this.parameterHold = null;
      if (!['stopped', 'connecting', 'idle'].includes(status) && !this.state.paused && (this.state.auto.bp || this.state.auto.scenes || this.state.auto.results)) {
        const held = this.automation.hold(this.state, `tosu ${status}，观战数据中断；比赛是否中止或重赛待核对`);
        if (held.state !== this.state) await this.save(held.state);
      }
      this.automation.reset(); this.live.tosu = { status, updatedAt: null, data: null };
      this.live.note = ['connecting', 'error', 'disconnected'].includes(status)
        ? '尚未连接 tosu，请确认 tosu 已启动并核对 WebSocket 地址。程序会自动重连，比赛资料与自动化设置已保留。'
        : `等待游戏数据恢复（${status}）；自动化设置不变，恢复后自动建立基线`;
      this.emit();
    } });
  }
  frame(frame, now = Date.now()) {
    return this.enqueue(async () => {
      const previousAt = Date.parse(this.live.tosu.updatedAt);
      if (!Number.isFinite(previousAt) || now - previousAt > 5000 || now < previousAt) this.parameterHold = null;
      this.receivedAt = Date.now();
      this.live.tosu = { status: 'live', updatedAt: new Date(now).toISOString(), data: frame };
      const recovered = this.spectatorRecovery.recover(this.state, frame, now);
      if (recovered !== this.state) {
        await this.save(recovered);
        this.automation.rebase(this.state, frame, now);
      }
      const result = this.automation.ingest(this.state, frame, now);
      this.live.note = result.note;
      if (result.state !== this.state) await this.save(result.state);
      this.spectatorRecovery.observe(this.state, frame, now);
      this.seriesCorrection.observe(this.state, frame, now);
      const display = rankingMapParameters(this.state, frame, this.parameterHold);
      this.parameterHold = display.hold;
      this.live.tosu.data = display.frame;
      this.emit();
      return this.snapshot();
    });
  }
}
