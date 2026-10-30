import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { bpProgress, currentRound, entryOf, newSession, requireValue, restoreAutomation, seriesOf, transition } from './model.js';
import { RoomAutomation } from './automation.js';

export class SessionStore {
  constructor({ file = null, state = newSession() } = {}) {
    this.file = file; this.state = restoreAutomation(state); this.listeners = new Set(); this.automation = new RoomAutomation();
    this.live = { tosu: { status: 'idle', updatedAt: null, data: null }, oclr: { status: 'idle', updatedAt: null, error: null }, note: '等待房间资料，自动化意图保持开启' };
    this.persistence = file ? 'ready' : 'memory'; this.tail = Promise.resolve();
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

  async save(next) {
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
    this.state = next;
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
      const next = transition(this.state, command);
      if (next !== this.state) {
        // Archive before replacing the match, without exposing local files over HTTP.
        if (command.type === 'next-match' && this.file) {
          await mkdir(`${dirname(this.file)}/archive`, { recursive: true, mode: 0o700 });
          await writeFile(`${dirname(this.file)}/archive/${this.state.id}-${this.state.version}.json`, JSON.stringify(this.state), { mode: 0o600 });
        }
        const reset = continuity(next) !== continuity(this.state);
        const changedAction = next.action?.id !== this.state.action?.id || next.auto.bp !== this.state.auto.bp;
        const changedResults = next.auto.results !== this.state.auto.results;
        await this.save(next);
        if (reset) {
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
      this.receivedAt = Date.now();
      this.live.tosu = { status: 'live', updatedAt: new Date(now).toISOString(), data: frame };
      const result = this.automation.ingest(this.state, frame, now);
      this.live.note = result.note;
      if (result.state !== this.state) await this.save(result.state);
      this.emit();
      return this.snapshot();
    });
  }
}
