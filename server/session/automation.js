import { randomUUID } from 'node:crypto';
import { applyBp, automaticTransition, awardTosuResult, currentRound, entryOf, seriesComplete, startRound } from './model.js';

// Only the server owns this observer. Browsers never ingest frames or advance BP.
// Continuity is deliberately volatile: restore/reconnect always establishes a baseline.
export class RoomAutomation {
  constructor() { this.reset(); }
  reset() { this.baseline = null; this.pending = null; this.ranking = null; this.observedRun = null; this.lastAt = null; this.notice = null; this.playEdge = null; this.endRun = null; this.scoreCandidate = null; }

  ingest(state, frame, now = Date.now()) {
    const config = state.auto;
    if (state.locked || state.scene === 'pause' || !(config.bp || config.scenes)) {
      this.reset(); return { state, note: state.scene === 'pause' ? '暂停中，自动跟随已挂起' : state.locked ? '手动画面锁定中' : '自动跟随关闭' };
    }
    const room = frame?.tourney;
    const mapId = frame?.beatmap?.id;
    const valid = config.profile === 'stable-tourney' && room &&
      room.teams.left === config.left && room.teams.right === config.right &&
      room.players.some(p => p.side === 'left' && p.osuId > 0) && room.players.some(p => p.side === 'right' && p.osuId > 0) &&
      [0, 1, 2, 3, 4].includes(room.ipcState) && Number.isSafeInteger(mapId) && mapId > 0;
    if (!valid) { this.reset(); return { state, note: '自动跟随等待：房间绑定、赛事客户端或谱面无效' }; }
    const ipc = room.ipcState;
    if (this.lastAt !== null && (now - this.lastAt > 5000 || now < this.lastAt)) this.reset();
    this.lastAt = now;
    if (!this.baseline) {
      this.baseline = { mapId, ipc };
      return { state, note: '已建立房间基线，等待新的换图 / Playing 转换' };
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
        else if (!seriesComplete(state) && (state.phase === 'bp' || (state.scene === 'map-result' && ['ranking', 'recorded'].includes(round?.status)))) {
          try {
            // Return to BP only for an available map. Old/unavailable maps must not move the display.
            const occupied = Object.values(state.bans).some(slots => slots.includes(entry.id)) ||
              state.rounds.some(r => r.entryId === entry.id && r.status !== 'void' && r.id !== (round?.status === 'prepared' ? round.id : null));
            if (occupied) throw new Error('房间谱面已 Ban / 已打 / 正在使用，请手动纠正');
            const returnToBp = config.scenes && state.scene === 'map-result';
            const consumeBp = config.bp && (state.action || round?.status === 'prepared');
            if (returnToBp || consumeBp) next = automaticTransition(state, draft => {
              if (config.scenes && draft.scene === 'map-result') { draft.phase = 'bp'; draft.scene = 'mappool'; }
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
        this.playEdge = null;
      } else if (ipc === 3 && round.status === 'playing') {
        // This also arms a manual start, but only on a continuous live Playing frame.
        this.observedRun = round.runId;
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
      const ready = score && score.frames >= 2 && now - score.at >= config.rankingDebounceMs &&
        [score.left, score.right].every(n => Number.isSafeInteger(n) && n >= 0) && score.left !== score.right;
      if (ready && !seriesComplete(next)) {
        next = automaticTransition(next, draft => awardTosuResult(draft, finished.id, score),
          `tosu 最终队分 ${score.left}:${score.right} · 自动加赢图`, randomUUID());
        this.endRun = null;
        note = '本局已按最终队分自动计胜；可撤回、修正胜方或人工校正系列分';
        this.notice = note;
      } else if (!ready) note = '已展示单图结算：最终队分尚未稳定、缺失或平分，保留人工处理';
    }
    this.baseline.ipc = ipc;
    return { state: next, note };
  }
}
