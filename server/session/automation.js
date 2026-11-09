import { resultFacts } from './room-facts.js';
import { randomUUID } from 'node:crypto';
import { observedTransition, observation, currentRound, entryOf, seriesComplete, SessionRejection } from './model.js';
import { tosuRoomTeams } from '../../src/tosu.js';

const playerKeys = room => room.players.filter(p => p.osuId > 0).map(p => `${p.side}:${p.osuId}`).sort();
const validRoom = (state, frame) => {
  const config = state.auto;
  const room = frame?.tourney;
  // Ranking clients may be cleared before the next map arrives. After a
  // known finish, room/map observation does not require game-score clients.
  const finished = ['ranking', 'recorded'].includes(currentRound(state)?.status);
  return tosuRoomTeams(frame) && config.profile === 'stable-tourney' && config.left && config.right && room &&
    room.teams.left === config.left && room.teams.right === config.right &&
    ([1, 2].includes(room.ipcState) || finished || room.players.some(p => p.side === 'left' && p.osuId > 0) && room.players.some(p => p.side === 'right' && p.osuId > 0)) &&
    [0, 1, 2, 3, 4].includes(room.ipcState) && Number.isSafeInteger(frame?.beatmap?.id) && frame.beatmap.id > 0;
};
const preparedContext = (state, frame) => {
  const round = currentRound(state); const room = frame?.tourney;
  const expectedMap = entryOf(state, round?.entryId)?.beatmapId;
  const mapId = frame?.beatmap?.id;
  const unresolvedReplayMap = round?.replayOf && !(Number.isSafeInteger(mapId) && mapId > 0);
  if (round?.status !== 'prepared' || round.identityUnresolved || state.phase !== 'bp' || state.action || state.paused || state.incident || seriesComplete(state) ||
    !tosuRoomTeams(frame) || state.auto.profile !== 'stable-tourney' || room.teams.left !== state.auto.left || room.teams.right !== state.auto.right ||
    !expectedMap || mapId !== expectedMap && !unresolvedReplayMap) return null;
  return JSON.stringify([state.id, round.id, round.entryId, expectedMap, state.auto.left, state.auto.right]);
};

// Only the server owns this observer. Browsers never ingest frames or advance BP.
// Continuity is deliberately volatile: restore/reconnect always establishes a baseline.
export class RoomAutomation {
  constructor() { this.reset(); }
  checkpoint() { return structuredClone({ ...this }); }
  restoreEvidence(checkpoint) { Object.assign(this, checkpoint); }
  reset() { this.sourceRoom = null; this.presentation = null; this.baseline = null; this.pending = null; this.ranking = null; this.observedRun = null; this.lastAt = null; this.notice = null; this.playEdge = null; this.endRun = null; this.scoreCandidate = null; this.runPlayers = null; this.confirmedPlayers = null; this.preparedStart = null; }

  invalidate({ action = false, result = false } = {}) {
    if (action) this.pending = null;
    if (result) { this.endRun = null; this.scoreCandidate = null; }
  }

  observePreparedStart(state, frame, now) {
    const key = preparedContext(state, frame); const ipc = frame?.tourney?.ipcState;
    const previous = this.preparedStart;
    const continuous = previous?.key === key && now >= previous.at && now - previous.at <= 5000;
    // Only an observed ready room arms this intent. Loading/restoring at
    // Playing or Ranking cannot manufacture it. No run is created here.
    this.preparedStart = key && ([1, 2].includes(ipc) || continuous && [0, 3].includes(ipc)) ? { key, at: now } : null;
  }

  rebase(state, frame, now) {
    const presentation = this.presentation;
    const sourceRoom = this.sourceRoom;
    this.reset();
    this.sourceRoom = sourceRoom;
    if (!state.paused && !state.incident && state.auto.scenes && presentation?.sessionId === state.id &&
      presentation.left === state.auto.left && presentation.right === state.auto.right &&
      frame?.tourney?.teams.left === state.auto.left && frame.tourney.teams.right === state.auto.right) this.presentation = presentation;
    if (!state.paused && !state.incident && validRoom(state, frame)) {
      // Seed only the observation position, never an endRun or a Playing edge.
      // This consumes the known pre-command snapshot so the next new map is not
      // accidentally swallowed as the first baseline after incident handling.
      this.baseline = { mapId: frame.beatmap.id, ipc: frame.tourney.ipcState };
      this.lastAt = now;
    }
    this.observePreparedStart(state, frame, now);
  }

  hold(state, reason) {
    this.reset();
    const round = currentRound(state);
    if (!state.incident && ['playing', 'ranking'].includes(round?.status)) {
      state = observedTransition(state, observation(state, 'hold', { reason }, round), `本图异常待核对：${reason}`, randomUUID());
    }
    return { state, note: reason };
  }

  ingest(state, frame, now = Date.now()) {
    const teams = tosuRoomTeams(frame);
    const bindingChanged = teams && (state.auto.profile !== 'stable-tourney' || state.auto.left !== teams.left || state.auto.right !== teams.right);
    const namesChanged = teams && (state.match.teams.a.name !== teams.left || state.match.teams.b.name !== teams.right);
    if (teams && (bindingChanged || namesChanged)) {
      // Room sides own both connection identity and the displayed team names.
      // A display-only name refresh must not reset an observed game's finish.
      const changedRoom = this.sourceRoom && (this.sourceRoom.left !== teams.left || this.sourceRoom.right !== teams.right);
      if (changedRoom) state = this.hold(state, 'tosu 房间已变化，原局观战连续性中断；新房间队名已自动读取').state;
      state = observedTransition(state, observation(state, 'bind-room', teams), `自动读取 tosu 房间与播出队名：${teams.left} / ${teams.right}`, randomUUID(), { undo: false });
      if (bindingChanged) this.reset();
    }
    this.sourceRoom = teams;
    // Presentation can join a live room mid-map. It never creates a round,
    // seeds an observed run or supplies evidence for result recording.
    const previous = this.presentation;
    const result = this.ingestProgress(state, frame, now);
    const config = result.state.auto;
    const room = frame?.tourney;
    const bound = config.scenes && tosuRoomTeams(frame) && config.profile === 'stable-tourney' && config.left && config.right &&
      room?.teams.left === config.left && room.teams.right === config.right && [0, 1, 2, 3, 4].includes(room.ipcState);
    this.presentation = bound ? { ipc: room.ipcState, mapId: frame?.beatmap?.id, sessionId: result.state.id, left: config.left, right: config.right } : null;
    const playingEvent = bound && room.ipcState === 3 && (!previous || previous.ipc !== 3 || previous.mapId !== frame?.beatmap?.id);
    if (playingEvent && !result.state.warmup && !result.state.paused && !result.state.incident && result.state.phase !== 'winner' && !seriesComplete(result.state) &&
      (result.state.scene !== 'playing' || result.state.sceneOverride)) {
      result.state = observedTransition(result.state, observation(result.state, 'scene', { scene: 'playing' }), '房间正在 Playing：自动跟随播出画面（不补建本局或计胜）', randomUUID(), { undo: false });
    }
    const finished = currentRound(result.state);
    const rankingExit = bound && previous?.ipc === 4 && [1, 2].includes(room.ipcState) &&
      previous.sessionId === result.state.id && previous.left === config.left && previous.right === config.right;
    if (rankingExit && !result.state.warmup && !result.state.paused && result.state.phase !== 'winner' && !seriesComplete(result.state) &&
      (!finished || ['prepared', 'ranking', 'recorded'].includes(finished.status)) &&
      (result.state.scene !== 'mappool' || result.state.sceneOverride)) {
      // Returning to the room is a presentation event, even without a new map.
      // Keep pending results/incidents intact; this never advances BP or awards.
      result.state = observedTransition(result.state, observation(result.state, 'room-return', {}, finished), 'tosu 离开 Ranking 返回房间：自动回到图池（保留本局赛果）', randomUUID(), { undo: false });
      if (!result.state.incident) result.note = '已返回房间，自动回到图池；尚未记录的本局赛果保留';
    }
    if (bound && room.ipcState === 3 && !result.state.paused && !result.state.incident && !currentRound(result.state)) {
      result.note = '正在接收 Playing 实时队分；尚无本局记录，仅展示，不自动记胜';
      if (result.state.sceneOverride) result.note = `保持所选画面，实时队分继续更新。${result.note}`;
    }
    return result;
  }

  ingestProgress(state, frame, now = Date.now()) {
    const config = state.auto;
    if (currentRound(state)?.identityUnresolved) {
      this.reset(); return { state, note: '旧比赛记录关联不明确，请人工处理该图；实时画面继续跟随' };
    }
    if (state.incident) {
      this.reset(); return { state, note: '本图异常待处理：自动推进与计胜已挂起；恢复观战不等于确认重赛' };
    }
    if (state.paused || !(config.bp || config.scenes || config.results)) {
      this.reset(); return { state, note: state.paused ? '明确暂停中，结束暂停后自动建立基线' : '自动跟随已明确关闭' };
    }
    if (!tosuRoomTeams(frame)) {
      return this.hold(state, '等待 tosu 提供赛事房间队名；收到后自动跟随，无需手动填写');
    }
    const room = frame?.tourney;
    const mapId = frame?.beatmap?.id;
    this.observePreparedStart(state, frame, now);
    const valid = validRoom(state, frame);
    if (!valid) {
      const preparedStart = this.preparedStart;
      const held = this.hold(state, '房间或观战客户端资料不完整，不能据此判断 abort、选手掉线或 Panic');
      // Loading can temporarily clear player IDs after a known ready room.
      // Keep only that prepared start intent, never a previous run or finish.
      if (preparedStart?.key === preparedContext(held.state, frame)) this.preparedStart = preparedStart;
      return held;
    }
    const ipc = room.ipcState;
    if (this.lastAt !== null && (now - this.lastAt > 5000 || now < this.lastAt)) return this.hold(state, '观战数据连续性中断，请核对比赛是否仍在进行');
    this.lastAt = now;
    const counted = currentRound(state);
    // osu!tourney hides and clears aggregate scores after showing results,
    // while its clients still retain the verified final scores and IPC stays 4.
    const clients = room.players.filter(p => p.osuId > 0);
    const confirmed = this.confirmedPlayers?.roundId === counted?.id ? this.confirmedPlayers : null;
    const sameClients = confirmed && clients.length === confirmed.scores.size &&
      clients.every(p => confirmed.scores.has(`${p.side}:${p.osuId}`));
    // Resetting a client to zero is display cleanup. A changed positive score
    // from the same confirmed clients is new evidence, even if totals are hidden.
    const changedClientScore = sameClients && clients.some(p => Number.isSafeInteger(p.score) && p.score > 0 &&
      p.score !== confirmed.scores.get(`${p.side}:${p.osuId}`));
    const clearedDisplay = counted?.finalScore && room.scoreVisible === false &&
      room.totalScore.left === 0 && room.totalScore.right === 0 && !changedClientScore;
    if (confirmed && !clearedDisplay && ipc === 4 && counted?.status === 'recorded' && counted.resultSource === 'tosu' && !counted.autoProtected &&
      entryOf(state, counted.entryId)?.beatmapId === mapId &&
      (room.totalScore.left !== counted.finalScore?.a || room.totalScore.right !== counted.finalScore?.b)) {
      const next = observedTransition(state, observation(state, 'review-result', { reason: '自动计胜后成绩仍有变化，请人工核对胜方' }, counted), '成绩仍在变化：撤回本局自动计胜，等待人工核对', randomUUID());
      this.reset();
      return { state: next, note: '成绩仍在变化，暂不加分。全部结束后请选择正确胜方' };
    }
    if (!this.baseline) {
      this.baseline = { mapId, ipc };
      if (ipc === 3 && this.preparedStart?.key === preparedContext(state, frame)) this.playEdge = mapId;
      else return { state, note: '已建立房间基线，等待新的换图 / Playing 转换' };
    }
    const leaving = currentRound(state);
    if (leaving?.status === 'playing' && this.observedRun === leaving.runId && this.ranking?.runId === leaving.runId &&
      this.baseline.ipc === 4 && ([1, 2].includes(ipc) || ipc === 4 && mapId !== entryOf(state, leaving.entryId)?.beatmapId)) {
      // A fast room return / next selection can follow a single Ranking frame.
      // Release BP from the observed finish, without treating its transient
      // scores (or the next map's scores) as a confirmed result.
      state = observedTransition(state, observation(state, 'finish-attempt', {}, leaving), 'tosu 已离开本图 Ranking：开放下一 BP，原局成绩待核对', randomUUID());
      this.observedRun = null; this.ranking = null; this.endRun = null;
      this.scoreCandidate = null; this.runPlayers = null;
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
        else if (!seriesComplete(state) && state.phase !== 'winner' && round?.status !== 'playing' &&
          (state.phase === 'bp' || state.action || round?.status === 'prepared' || ['ranking', 'recorded'].includes(round?.status))) {
          try {
            if (config.bp && state.action) next = observedTransition(state, observation(state, 'confirm-bp', { entryId: entry.id }), `房间换图 ${entry.label} · 按当前动作跟随`, pending.eventId);
            else if (round?.status === 'prepared') note = '本次 Pick 已确认；如需纠正，请手动修改选图';
          } catch (error) {
            if (!(error instanceof SessionRejection)) throw error;
            note = error.message;
          }
        } else note = '当前阶段不应用自动 BP';
        this.notice = note === '自动跟随房间' ? null : note;
      } else note = '等待换图稳定';
    }

    this.observePreparedStart(next, frame, now);
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
    if (sameMap && !this.pending && next.phase !== 'winner') {
      if (ipc === 3 && this.playEdge === mapId && round.status === 'prepared' && next.phase === 'bp' && !next.action && !seriesComplete(next)) {
        next = observedTransition(next, observation(next, 'start-attempt', {}, round), 'tosu Playing → 本局开始', randomUUID());
        this.observedRun = currentRound(next).runId;
        this.runPlayers = playerKeys(room);
        this.playEdge = null;
        this.preparedStart = null;
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
            next = observedTransition(next, observation(next, 'finish-attempt', { scores: { a: room.totalScore.left, b: room.totalScore.right } }, round), 'tosu 连续 Playing → Ranking：保留 Playing 画面与总分', randomUUID());
            this.endRun = { roundId: round.id, runId: round.runId };
            this.observedRun = null; this.ranking = null;
          }
        }
      } else if (ipc !== 3 && ipc !== 4) { this.observedRun = null; this.ranking = null; }
    } else { this.observedRun = null; this.ranking = null; }
    // Keep observing a known continuous finish if totals arrive after Ranking.
    // A fresh connection at Ranking has no endRun and can never backfill a win.
    const finished = currentRound(next);
    const evidence = resultFacts(room);
    if (config.results && ipc === 4 && sameMap && this.endRun?.roundId === finished.id && this.endRun.runId === finished.runId && finished.status === 'ranking' && !['manual', 'retracted', 'series-correction'].includes(finished.resultSource)) {
      const score = this.scoreCandidate;
      const ready = score && score.frames >= 2 && now - score.at >= config.rankingDebounceMs &&
        [score.left, score.right].every(n => Number.isSafeInteger(n) && n >= 0) && score.left !== score.right;
      if (ready) {
        next = observedTransition(next, observation(next, 'confirm-result', { scores: score, evidence }, finished),
          `tosu 最终队分 ${score.left}:${score.right} · 自动加赢图`, randomUUID());
        if (next.rounds.find(round => round.id === finished.id).status !== 'recorded') {
          this.baseline.ipc = ipc;
          return { state: next, note: '本图分数或赛制尚不满足自动计胜条件' };
        }
        this.confirmedPlayers = { roundId: finished.id,
          scores: new Map(room.players.filter(p => p.osuId > 0).map(p => [`${p.side}:${p.osuId}`, p.score])) };
        this.endRun = null;
        note = '本局已按最终队分自动计胜；可撤回、修正胜方或人工校正系列分';
        this.notice = note;
      } else if (!ready) note = '成绩还未确认，暂不加分；请等待全部结束，必要时人工核对胜方';
    }
    this.baseline.ipc = ipc;
    if (next.sceneOverride) note = `${config.scenes ? '画面人工覆盖中，下一次有效换图 / 比赛开始 / 结算时自动接回。' : '自动选画面已关闭，保持人工画面；比赛数据跟随继续。'}${note}`;
    return { state: next, note };
  }
}
