import { migrateSession, validateSessionV2 } from './records.js';
import { randomUUID } from 'node:crypto';
import { observedTransition, observation, tiebreakerProgress, canShowWinner, currentRound, entryOf, newSession, requireValue, SessionRejection, restoreAutomation, transition } from './model.js';
import { RoomAutomation } from './automation.js';
import { rankingMapParameters } from './map-parameters.js';
import { PickSceneDelay } from './pick-scene-delay.js';
import { SeriesCorrectionTracker } from './series-correction.js';
import { SpectatorRecovery } from './spectator-recovery.js';
import { ReadyReturnRecovery } from './ready-return-recovery.js';

function forkObserver(observer) {
  const next = new observer.constructor();
  next.restoreEvidence(observer.checkpoint());
  return next;
}

export class SessionApplication {
  constructor({ state = newSession() } = {}) {
    if (state.schema === 2) validateSessionV2(state);
    this.state = migrateSession(restoreAutomation(state)); this.automation = new RoomAutomation();
    this.state.warmup ??= false;
    if (this.state.pauseTimer === undefined) this.state.pauseTimer = null;
    if (this.state.resumeAt === undefined) this.state.resumeAt = null;
    if (!['normal', 'technical', 'tactical'].includes(this.state.pauseType)) this.state.pauseType = 'normal';
    this.closed = false;
    this.pendingSourceStatus = null;
    this.resumeTimer = null;
    this.winnerTimer = null;
    if (this.state.winnerPending && (!['a', 'b'].includes(this.state.winnerPending.team) || !Number.isSafeInteger(this.state.winnerPending.endsAt))) this.state.winnerPending = null;
    if (this.state.winnerPending === undefined) this.state.winnerPending = null;
    this.parameterHold = null;
    // Remember when the room itself changed map, so "use the current room map"
    // cannot silently consume a selection that has been sitting there for long.
    this.roomMap = { id: null, at: 0 };
    this.seriesCorrection = new SeriesCorrectionTracker();
    this.spectatorRecovery = new SpectatorRecovery();
    this.readyReturn = new ReadyReturnRecovery();
    this.live = { tosu: { status: 'idle', updatedAt: null, data: null }, oclr: { status: 'idle', updatedAt: null, error: null }, note: '等待房间资料，自动化意图保持开启' };
    this.pickScene = new PickSceneDelay(token => this.enqueue(async () => {
      if (!this.pickScene.matches(token, this.state)) return;
      const next = observedTransition(this.state, observation(this.state, 'scene', { scene: 'playing' }), '本次 Pick 展示满 5 秒：自动切到 Playing（本局仍等待比赛开始）', randomUUID(), { undo: false });
      await this.save(next);
      this.emit();
    }).catch(() => { this.pickScene.retry(token, this.state); this.live.note = '自动切换画面未保存，请检查本机存储'; this.emit(); }));
    this.scheduleResume();
    this.scheduleWinnerConfirm();
  }

  close() { this.closed = true; this.pickScene.cancel(); clearTimeout(this.resumeTimer); this.resumeTimer = null; clearTimeout(this.winnerTimer); this.winnerTimer = null; }

  // "即将开始" gives a 10 second grace period. The deadline lives in the
  // session, so a reload keeps counting and the output does not depend on the
  // console staying open.
  scheduleResume(retryMs = 0) {
    clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    if (this.closed || !this.state.paused || !Number.isSafeInteger(this.state.resumeAt)) return;
    const token = { matchId: this.state.id, deadline: this.state.resumeAt };
    const delay = Math.max(retryMs, token.deadline - Date.now());
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      this.resumeNow(token);
    }, delay);
    this.resumeTimer.unref?.();
  }

  resumeNow(token = { matchId: this.state.id, deadline: this.state.resumeAt }) {
    return this.enqueue(async () => {
      if (this.closed || this.state.id !== token.matchId || this.state.resumeAt !== token.deadline) return;
      if (!this.state.paused || !this.state.returnScene || !Number.isSafeInteger(this.state.resumeAt)) return;
      if (this.state.resumeAt > Date.now()) { this.scheduleResume(); return; }
      const next = observedTransition(this.state, observation(this.state, 'resume-deadline', { deadline: this.state.resumeAt, now: Date.now() }), '“即将开始”倒计时结束：已自动返回暂停前的画面', randomUUID(), { undo: false });
      await this.save(next);
      this.live.note = '“即将开始”倒计时结束，已自动返回暂停前的画面';
      this.emit();
    }).catch(() => {
      if (this.state.id === token.matchId && this.state.resumeAt === token.deadline) this.scheduleResume(1000);
      this.live.note = '“即将开始”自动返回未保存，请检查本机存储'; this.emit();
    });
  }

  // A pending Winner confirmation is an absolute deadline saved with the
  // session, so closing/reloading the console cannot stop the countdown.
  scheduleWinnerConfirm(retryMs = 0) {
    clearTimeout(this.winnerTimer);
    this.winnerTimer = null;
    const pending = this.state.winnerPending;
    if (this.closed || !pending || !Number.isSafeInteger(pending.endsAt)) return;
    const token = { matchId: this.state.id, deadline: pending.endsAt, team: pending.team };
    const delay = Math.max(retryMs, token.deadline - Date.now());
    this.winnerTimer = setTimeout(() => {
      this.winnerTimer = null;
      this.confirmWinnerNow(token);
    }, delay);
    this.winnerTimer.unref?.();
  }

  confirmWinnerNow(token = { matchId: this.state.id, deadline: this.state.winnerPending?.endsAt, team: this.state.winnerPending?.team }) {
    return this.enqueue(async () => {
      if (this.closed || this.state.id !== token.matchId || this.state.winnerPending?.endsAt !== token.deadline || this.state.winnerPending?.team !== token.team) return;
      const pending = this.state.winnerPending;
      if (!pending) return;
      if (pending.endsAt > Date.now()) { this.scheduleWinnerConfirm(); return; }
      if (this.state.incident || this.state.paused || !canShowWinner(this.state, pending.team)) {
        const note = '5 秒自动确认已取消：比赛状态或系列比分已变化，请手动确认胜方';
        const cancelled = observedTransition(this.state, observation(this.state, 'cancel-winner-deadline'), note, randomUUID(), { undo: false });
        await this.save(cancelled);
        this.live.note = note;
        this.emit();
        return;
      }
      const next = observedTransition(this.state, observation(this.state, 'winner-deadline', { deadline: pending.endsAt, now: Date.now() }), `5 秒倒计时结束：自动确认 ${this.state.match.teams[pending.team].name} 为胜方`, randomUUID());
      // Undo returns to the reviewed Winner screen without re-arming a stale
      // expired deadline. The operator can then confirm or cancel manually.
      next.undo.at(-1).state.winnerPending = null;
      await this.save(next);
      this.live.note = `5 秒倒计时结束：已自动确认 ${this.state.match.teams[pending.team].name} 为胜方`;
      this.emit();
    }).catch(() => {
      if (this.state.id === token.matchId && this.state.winnerPending?.endsAt === token.deadline && this.state.winnerPending?.team === token.team) this.scheduleWinnerConfirm(1000);
      this.live.note = 'Winner 自动确认未保存，请检查本机存储后手动确认'; this.emit();
    });
  }

  command(command) {
    return this.enqueue(async () => {
      const startupToken = command.payload?.startupChoice;
      if (command.type === 'continue-match' || startupToken !== undefined) {
        requireValue(startupToken && startupToken === this.startupChoice &&
          ['continue-match', 'next-match'].includes(command.type), '开场选择已更新，请核对当前比赛');
        if (command.type === 'continue-match') {
          this.startupChoice = null;
          this.emit();
          return this.snapshot();
        }
      }
      if (command.type === 'resolve-incident' && !this.state.commandIds.includes(command.id) && currentRound(this.state)?.status === 'playing') {
        const room = this.live.tosu.data?.tourney;
        requireValue(this.live.tosu.status === 'live' && room?.ipcState === 3 &&
          this.live.tosu.data?.beatmap.id === entryOf(this.state, currentRound(this.state).entryId)?.beatmapId &&
          room.teams.left === this.state.auto.left && room.teams.right === this.state.auto.right &&
          room.players.some(p => p.side === 'left' && p.osuId > 0) && room.players.some(p => p.side === 'right' && p.osuId > 0),
        '尚未恢复到本图有效 Playing；请等待观战恢复，或由裁判确认重赛 / 人工核对赛果');
      }
      if (!this.state.commandIds.includes(command.id)) {
        const p = command.payload || {};
        if (command.type === 'confirm-room-map') {
          const review = this.roomReview();
          requireValue(review?.entryId && review.entryId === p.entryId && review.kind === p.kind &&
            review.stage === p.stage && ['ready', 'finished'].includes(review.stage) && review.roundId === p.ifCurrentRoundId,
          '房间谱面或比赛进度已改变，请重新核对');
        }
        if (command.type === 'prepare-round' && p.tiebreaker) {
          const review = this.roomReview();
          requireValue(review?.kind !== 'tb' || review.stage === 'ready' ||
            (p.forReplay === true && review.stage === 'finished' && [1, 2].includes(this.live.tosu.data.tourney.ipcState)),
          '房间的 TB 已开打或已结束，请先核对本图');
        }
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
      let next = transition(this.state, effective);
      // A room map can be selected before the operator picks the BP action. Use
      // that already-visible map once, but only for an explicit action request
      // and only when the map is still fresh and uniquely identified by the pool.
      if (next !== this.state && (command.type === 'select-bp-action' || command.type === 'set-action') &&
        command.payload?.applyRoomMap && next.action && next.action.id !== this.state.action?.id) {
        const entry = this.currentRoomMap(next);
        if (entry) {
          try {
            next = transition(next, { id: randomUUID(), version: next.version, type: 'apply-room-map',
              payload: { entryId: entry.id, eventId: randomUUID() } });
          } catch (error) {
            if (!(error instanceof SessionRejection)) throw error;
            this.live.note = error.message;
          }
        }
      }
      if (next !== this.state) {
        // Archive before replacing the match, without exposing local files over HTTP.
        if (command.type === 'next-match') await this.archive();
        const reset = continuity(next) !== continuity(this.state);
        const changedAction = next.action?.id !== this.state.action?.id || next.auto.bp !== this.state.auto.bp;
        const changedResults = next.auto.results !== this.state.auto.results;
        await this.save(next, { allowPickScene: !['undo', 'replay', 'referee-replay', 'resume', 'resolve-incident'].includes(command.type) });
        if (command.type === 'next-match') this.startupChoice = null;
        if (command.type === 'set-series' && !next.incident && !next.paused && currentRound(next)?.resultSource === 'series-correction') {
          this.live.note = '系列比分已确认，本图已处理；自动流程等待下一图，无需再单独记胜';
        }
        if (['display', 'undo', 'replay', 'referee-replay'].includes(command.type)) this.pickScene.cancel();
        if (reset) {
          this.spectatorRecovery.reset();
          this.readyReturn.reset();
          if (this.live.tosu.status === 'live' && Date.now() - this.receivedAt < 5000) {
            this.automation.rebase(next, this.live.tosu.data, Date.parse(this.live.tosu.updatedAt));
          } else this.automation.reset();
        }
        else if (changedAction) this.automation.invalidate({ action: true });
        if (changedResults) this.automation.invalidate({ result: true });
        if (command.type === 'set-series' && currentRound(next)?.status === 'ranking') this.automation.invalidate({ result: true });
        this.emit();
      }
      return this.snapshot();
    });
  }

  roomReview() {
    const s = this.state; const frame = this.live.tosu.data; const room = frame?.tourney;
    if (this.live.tosu.status !== 'live' || !this.receivedAt || Date.now() - this.receivedAt > 5000 ||
        s.paused || s.warmup || s.incident || !room || ![1, 2, 3, 4].includes(room.ipcState) ||
        !s.auto.left || !s.auto.right || room.teams?.left !== s.auto.left || room.teams?.right !== s.auto.right) return null;
    const mapId = frame.beatmap?.id;
    if (!Number.isSafeInteger(mapId) || mapId <= 0) return null;
    const round = currentRound(s);
    const prepared = round?.status === 'prepared' ? entryOf(s, round.entryId) : null;
    const matches = s.pool.filter(e => e.beatmapId === mapId);
    const entry = matches.length === 1 ? matches[0] : null;
    let kind;
    if (prepared && prepared.beatmapId !== mapId) kind = 'pick';
    else if (entry?.mod === 'TB' && (round?.status === 'void' || round?.entryId !== entry.id) && tiebreakerProgress(s).canPrepare &&
        s.pool.filter(e => e.mod === 'TB').length === 1) kind = 'tb';
    else return null;
    let unavailableReason = null;
    if (!entry) unavailableReason = matches.length ? '对应多个图池条目' : '不在本场图池中';
    else if (Object.values(s.bans).some(slots => slots.includes(entry.id))) unavailableReason = '已被 Ban';
    else if (s.rounds.some(r => r.status !== 'void' && r.entryId === entry.id)) unavailableReason = '已用于其他局';
    else if (kind !== 'tb' && (prepared.mod === 'TB' || entry.mod === 'TB')) unavailableReason = '不能在普通 Pick 与决胜图之间替换';
    const key = JSON.stringify([s.id, s.currentRoundId, prepared?.id, kind, mapId, room.teams.left, room.teams.right]);
    let stage = 'ready';
    if (room.ipcState === 3) stage = 'playing';
    else if (this.reviewRankingKey === key) stage = 'finished';
    else if (room.ipcState === 4) stage = 'ranking';
    return { key, kind, stage, roundId: s.currentRoundId, unavailableReason, entryId: unavailableReason ? null : entry.id,
      roomLabel: entry?.label || `谱面 ${mapId}`, preparedLabel: prepared?.label || null };
  }

  currentRoomMap(state) {
    const frame = this.live.tosu.data; const room = frame?.tourney;
    const seenAt = Date.parse(this.live.tosu.updatedAt);
    if (this.live.tosu.status !== 'live' || !Number.isFinite(seenAt) || Date.now() - seenAt > 5000 || !room ||
      ![1, 2].includes(room.ipcState) || room.teams?.left !== state.auto.left || room.teams?.right !== state.auto.right) return null;
    if (this.roomMap.id !== frame.beatmap?.id || Date.now() - this.roomMap.at > 10000) return null;
    const candidates = state.pool.filter(entry => entry.beatmapId === frame.beatmap?.id);
    return candidates.length === 1 ? candidates[0] : null;
  }

  sourceStatus(status) {
    return this.enqueue(async () => {
      const pending = this.pendingSourceStatus;
      if (pending) await this.commitSourceStatus(pending);
      if (status !== 'live' && status !== pending) await this.commitSourceStatus(status);
    });
  }

  async commitSourceStatus(status) {
    // Work on an observer copy until the hold has been persisted.
    const automation = forkObserver(this.automation);
    if (!['stopped', 'connecting', 'idle'].includes(status) && !this.state.paused && (this.state.auto.bp || this.state.auto.scenes || this.state.auto.results)) {
      const held = automation.hold(this.state, `tosu ${status}，观战数据中断；比赛是否中止或重赛待核对`);
      if (held.state !== this.state) {
        try { await this.save(held.state); }
        catch (error) { this.pendingSourceStatus = status; throw error; }
      }
    }
    this.pendingSourceStatus = null;
    this.reviewRankingKey = null; this.reviewPlayingKey = null;
    this.pickScene.cancel();
    this.seriesCorrection.reset(); this.spectatorRecovery.reset(); this.readyReturn.reset();
    this.parameterHold = null; this.automation.reset(); this.roomMap = { id: null, at: 0 };
    this.live.tosu = { status, updatedAt: null, data: null };
    this.live.note = ['connecting', 'error', 'disconnected'].includes(status)
      ? '尚未连接 tosu，请确认 tosu 已启动并核对 WebSocket 地址。程序会自动重连，比赛资料与自动化设置已保留。'
      : `等待游戏数据恢复（${status}）；自动化设置不变，恢复后自动建立基线`;
    this.emit();
  }
  frame(frame, now = Date.now()) {
    return this.enqueue(async () => {
      if (this.pendingSourceStatus) await this.commitSourceStatus(this.pendingSourceStatus);
      const originals = [this.automation, this.readyReturn, this.spectatorRecovery, this.seriesCorrection];
      const [automation, readyReturn, spectatorRecovery, seriesCorrection] = originals.map(forkObserver);
      let parameterHold = this.parameterHold;
      let roomMap = { ...this.roomMap };
      const previousAt = Date.parse(this.live.tosu.updatedAt);
      if (!Number.isFinite(previousAt) || now - previousAt > 5000 || now < previousAt) parameterHold = null;
      const receivedAt = Date.now();
      const mapId = frame?.beatmap?.id;
      let mapPushed = false;
      if (Number.isSafeInteger(mapId) && mapId > 0) {
        if (roomMap.id === null) { roomMap.id = mapId; mapPushed = true; }
        else if (roomMap.id !== mapId) { roomMap = { id: mapId, at: now }; mapPushed = true; }
      }
      // Observe against a private working snapshot and commit once. No
      // subscriber can see a finish without its result/EX contribution.
      const returned = readyReturn.recover(this.state, frame, now);
      const restoredReady = returned !== this.state;
      if (restoredReady) {
        spectatorRecovery.reset(); seriesCorrection.reset(); parameterHold = null;
        automation.rebase(returned, frame, now);
      }
      const recovered = spectatorRecovery.recover(returned, frame, now);
      if (recovered !== returned) automation.rebase(recovered, frame, now);
      const result = automation.ingest(recovered, frame, now);
      spectatorRecovery.observe(result.state, frame, now);
      readyReturn.observe(result.state, frame, now, automation.observedRun);
      seriesCorrection.observe(result.state, frame, now);
      const display = result.state.warmup ? { frame, hold: null } : rankingMapParameters(result.state, frame, parameterHold);
      if (result.state !== this.state) await this.save(result.state, { allowPickScene: !restoredReady });
      [automation, readyReturn, spectatorRecovery, seriesCorrection].forEach((observer, index) => originals[index].restoreEvidence(observer.checkpoint()));
      this.parameterHold = display.hold; this.roomMap = roomMap; this.receivedAt = receivedAt;
      this.live.tosu = { status: 'live', updatedAt: new Date(now).toISOString(), data: display.frame };
      const review = this.roomReview();
      const ipc = frame.tourney?.ipcState;
      // A new map can appear while the previous Ranking screen is still up.
      // Only carry a missed finish into Ready after observing this map in play.
      const continuous = now >= previousAt && now - previousAt <= 5000;
      if (!continuous || !review || review.key !== this.reviewRankingKey || ipc === 3) this.reviewRankingKey = null;
      if (continuous && ipc === 4 && review && this.reviewPlayingKey === review.key) this.reviewRankingKey = review.key;
      this.reviewPlayingKey = ipc === 3 ? review?.key : null;
      if (restoredReady) this.pickScene.cancel();
      if (mapPushed) this.pickScene.observeRoomMap(this.state, mapId);
      this.live.note = restoredReady ? '本局已返回准备状态，保留原图，等待裁判重新开始比赛。' : result.note;
      this.emit();
      return this.snapshot();
    });
  }
}
