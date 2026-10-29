import { randomUUID } from 'node:crypto';
import { applyBp, automaticTransition, awardTosuResult, currentRound, entryOf, holdRound, seriesComplete, startRound } from './model.js';

const playerKeys = room => room.players.filter(p => p.osuId > 0).map(p => `${p.side}:${p.osuId}`).sort();

// Only the server owns this observer. Browsers never ingest frames or advance BP.
// Continuity is deliberately volatile: restore/reconnect always establishes a baseline.
export class RoomAutomation {
  constructor() { this.reset(); }
  reset() { this.baseline = null; this.pending = null; this.ranking = null; this.observedRun = null; this.lastAt = null; this.notice = null; this.playEdge = null; this.endRun = null; this.scoreCandidate = null; this.runPlayers = null; }

  hold(state, reason) {
    this.reset();
    const round = currentRound(state);
    if (!state.incident && ['playing', 'ranking'].includes(round?.status)) {
      state = automaticTransition(state, draft => holdRound(draft, 'unverified', reason, 'tosu'), `本图异常待核对：${reason}`, randomUUID());
    }
    return { state, note: reason };
  }

  ingest(state, frame, now = Date.now()) {
    const config = state.auto;
    if (state.incident) {
      this.reset(); return { state, note: '本图异常待处理：自动推进与计胜已挂起；恢复观战不等于确认重赛' };
    }
    if (state.locked || state.scene === 'pause' || !(config.bp || config.scenes)) {
      this.reset(); return { state, note: state.scene === 'pause' ? '暂停中，自动跟随已挂起' : state.locked ? '手动画面锁定中' : '自动跟随关闭' };
    }
    const room = frame?.tourney;
    const mapId = frame?.beatmap?.id;
    const valid = config.profile === 'stable-tourney' && room &&
      room.teams.left === config.left && room.teams.right === config.right &&
      room.players.some(p => p.side === 'left' && p.osuId > 0) && room.players.some(p => p.side === 'right' && p.osuId > 0) &&
      [0, 1, 2, 3, 4].includes(room.ipcState) && Number.isSafeInteger(mapId) && mapId > 0;
    if (!valid) return this.hold(state, '房间或观战客户端资料不完整，不能据此判断 abort、选手掉线或 Panic');
    const ipc = room.ipcState;
    if (this.lastAt !== null && (now - this.lastAt > 5000 || now < this.lastAt)) return this.hold(state, '观战数据连续性中断，请核对比赛是否仍在进行');
    this.lastAt = now;
    const counted = currentRound(state);
    if (ipc === 4 && counted?.status === 'recorded' && counted.resultSource === 'tosu' && !counted.autoProtected &&
      entryOf(state, counted.entryId)?.beatmapId === mapId &&
      (room.totalScore.left !== counted.finalScore?.a || room.totalScore.right !== counted.finalScore?.b)) {
      const next = automaticTransition(state, draft => {
        const round = currentRound(draft);
        round.status = 'ranking'; round.winner = null; round.resultSource = 'review'; round.finalScore = null;
        draft.winner = null;
        if (draft.phase === 'winner') { draft.phase = 'playing'; draft.scene = 'map-result'; }
        holdRound(draft, 'unverified', '自动计胜后成绩仍有变化，已撤回该局自动加分；请等待全部结束后核对胜方', 'tosu');
      }, '成绩仍在变化：撤回本局自动计胜，等待人工核对', randomUUID());
      this.reset();
      return { state: next, note: '成绩仍在变化，暂不加分。全部结束后请选择正确胜方' };
    }
    if (!this.baseline) {
      this.baseline = { mapId, ipc };
      return { state, note: '已建立房间基线，等待新的换图 / Playing 转换' };
    }
    const active = currentRound(state);
    if (['playing', 'ranking'].includes(active?.status) && (this.observedRun || this.endRun || this.ranking)) {
      if (mapId !== entryOf(state, active.entryId)?.beatmapId && active.status === 'playing') return this.hold(state, '本局尚未正常结算但房间谱面已变化，请核对 abort 或重赛');
      if (active.status === 'playing' && ![3, 4].includes(ipc)) return this.hold(state, '观战已离开 Playing，原因待核对；不能据此宣布本局结束或重赛');
      const players = playerKeys(room);
      if (this.runPlayers?.some(key => !players.includes(key))) return this.hold(state, '本局观战选手或窗口缺失，请区分选手掉线与观战故障');
    }
    let next = state;
    let note = this.notice || '自动跟随房间';
    if (mapId !== this.baseline.mapId) {
      this.baseline.mapId = mapId;
      this.pending = { mapId, at: now, frames: 1, actionId: state.action?.id || null, roundId: currentRound(state)?.id || null, eventId: randomUUID() };
      this.observedRun = null; this.ranking = null;
      this.endRun = null; this.scoreCandidate = null;
      this.notice = null;
    } else if (this.pending) {
      const pending = this.pending;
      pending.frames++;
      if (now - pending.at >= config.mapDebounceMs && pending.frames >= 2) {
        this.pending = null; // Consume even rejected events; a later BP action cannot reuse this snapshot.
        const candidates = state.pool.filter(e => e.beatmapId === mapId);
        const entry = candidates.length === 1 ? candidates[0] : null;
        const round = currentRound(state);
        const applicable = state.action?.id === pending.actionId || (!state.action && pending.actionId === null && round?.id === pending.roundId);
        if (!entry) note = candidates.length > 1 ? '同一谱面对应多个槽位，请手动选择条目' : '房间谱面不在本场图池中';
        else if (!applicable) note = '换图所属动作已结束，等待新的换图';
        else if (!seriesComplete(state) && (state.phase === 'bp' ||
          (state.scene === 'mappool' && round?.status !== 'playing') ||
          (state.scene === 'map-result' && ['ranking', 'recorded'].includes(round?.status)))) {
          try {
            // Return to BP only for an available map. Old/unavailable maps must not move the display.
            const occupied = Object.values(state.bans).some(slots => slots.includes(entry.id)) ||
              state.rounds.some(r => r.entryId === entry.id && r.status !== 'void' && r.id !== (round?.status === 'prepared' ? round.id : null));
            if (occupied) throw new Error('房间谱面已 Ban / 已打 / 正在使用，请手动纠正');
            const returnToBp = config.scenes && (state.scene === 'map-result' || (state.scene === 'playing' && round?.status === 'recorded'));
            const consumeBp = config.bp && (state.action || round?.status === 'prepared');
            if (returnToBp || consumeBp) next = automaticTransition(state, draft => {
              if (returnToBp) { draft.phase = 'bp'; draft.scene = 'mappool'; }
              if (config.bp && (draft.action || currentRound(draft)?.status === 'prepared')) {
                draft.phase = 'bp';
                applyBp(draft, entry.id, 'room-map', pending.actionId, pending.eventId);
              }
            }, `房间换图 ${entry.label} · 按当前动作跟随`, pending.eventId);
          } catch (error) { note = error.message; }
        } else note = '当前阶段不应用自动 BP';
        this.notice = note === '自动跟随房间' ? null : note;
      } else note = '等待换图稳定';
    }

    const round = currentRound(next);
    const sameMap = round && entryOf(next, round.entryId)?.beatmapId === mapId;
    if (ipc === 4 && sameMap) {
      const scores = room.totalScore;
      if (!this.scoreCandidate || this.scoreCandidate.left !== scores.left || this.scoreCandidate.right !== scores.right) {
        this.scoreCandidate = { ...scores, at: now, frames: 1 };
      } else this.scoreCandidate.frames++;
    } else { this.scoreCandidate = null; this.endRun = null; }
    if (ipc === 3 && this.baseline.ipc !== 3) this.playEdge = mapId;
    if (ipc !== 3) this.playEdge = null;
    if (config.scenes && sameMap && !this.pending && next.phase !== 'winner') {
      if (ipc === 3 && this.playEdge === mapId && round.status === 'prepared' && next.phase === 'bp' && !next.action && !seriesComplete(next)) {
        next = automaticTransition(next, draft => startRound(draft, 'tosu'), 'tosu Playing → 游戏画面', randomUUID());
        this.observedRun = currentRound(next).runId;
        this.runPlayers = playerKeys(room);
        this.playEdge = null;
      } else if (ipc === 3 && round.status === 'playing') {
        // This also arms a manual start, but only on a continuous live Playing frame.
        this.observedRun = round.runId;
        this.runPlayers ||= playerKeys(room);
        this.ranking = null;
      } else if (ipc === 4 && this.observedRun === round.runId && round.status === 'playing') {
        if (this.baseline.ipc === 3) this.ranking = { at: now, frames: 0, runId: round.runId };
        if (this.ranking?.runId === round.runId) {
          this.ranking.frames++;
          if (now - this.ranking.at >= config.rankingDebounceMs && this.ranking.frames >= 2) {
            next = automaticTransition(next, draft => {
              const playing = currentRound(draft);
              playing.status = 'ranking';
              // A source snapshot, never persisted as live telemetry or used to assign a winner.
              playing.finalScore = { a: room.totalScore.left, b: room.totalScore.right };
              if (!draft.action) draft.action = draft.queue.shift() || null;
              draft.scene = 'map-result';
            }, 'tosu 连续 Playing → Ranking：展示单图结算（不计胜）', randomUUID());
            this.endRun = { roundId: round.id, runId: round.runId };
            this.observedRun = null; this.ranking = null;
          }
        }
      } else if (ipc !== 3 && ipc !== 4) { this.observedRun = null; this.ranking = null; }
    } else { this.observedRun = null; this.ranking = null; }
    // Keep observing a known continuous finish if totals arrive after Ranking.
    // A fresh connection at Ranking has no endRun and can never backfill a win.
    const finished = currentRound(next);
    if (config.scenes && ipc === 4 && sameMap && this.endRun?.roundId === finished.id && this.endRun.runId === finished.runId && finished.status === 'ranking') {
      const score = this.scoreCandidate;
      // Agreement is a necessary consistency check, not proof that every player finished.
      const consistent = ['left', 'right'].every(side => {
        const players = room.players.filter(p => p.side === side && p.osuId > 0);
        return players.length > 0 && players.every(p => Number.isSafeInteger(p.score) && p.score >= 0) &&
          players.reduce((sum, p) => sum + p.score, 0) === room.totalScore[side];
      });
      const ready = score && score.frames >= 2 && now - score.at >= config.rankingDebounceMs &&
        [score.left, score.right].every(n => Number.isSafeInteger(n) && n >= 0) && score.left !== score.right && consistent;
      if (ready && !seriesComplete(next)) {
        next = automaticTransition(next, draft => awardTosuResult(draft, finished.id, score),
          `tosu 最终队分 ${score.left}:${score.right} · 自动加赢图`, randomUUID());
        this.endRun = null;
        note = '本局已按最终队分自动计胜；可撤回、修正胜方或人工校正系列分';
        this.notice = note;
      } else if (!ready) note = '成绩还未确认，暂不加分；请等待全部结束，必要时人工核对胜方';
    }
    this.baseline.ipc = ipc;
    return { state: next, note };
  }
}
