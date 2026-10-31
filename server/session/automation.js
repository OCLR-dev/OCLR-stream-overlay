import { randomUUID } from 'node:crypto';
import { applyBp, automaticTransition, awardTosuResult, currentRound, entryOf, holdRound, releaseRoundBp, seriesComplete, startRound } from './model.js';
import { tosuRoomTeams } from '../../src/tosu.js';

const playerKeys = room => room.players.filter(p => p.osuId > 0).map(p => `${p.side}:${p.osuId}`).sort();
const validRoom = (config, frame) => {
  const room = frame?.tourney;
  return tosuRoomTeams(frame) && config.profile === 'stable-tourney' && config.left && config.right && room &&
    room.teams.left === config.left && room.teams.right === config.right &&
    ([1, 2].includes(room.ipcState) || room.players.some(p => p.side === 'left' && p.osuId > 0) && room.players.some(p => p.side === 'right' && p.osuId > 0)) &&
    [0, 1, 2, 3, 4].includes(room.ipcState) && Number.isSafeInteger(frame?.beatmap?.id) && frame.beatmap.id > 0;
};

// Only the server owns this observer. Browsers never ingest frames or advance BP.
// Continuity is deliberately volatile: restore/reconnect always establishes a baseline.
export class RoomAutomation {
  constructor() { this.reset(); }
  reset() { this.sourceRoom = null; this.presentation = null; this.baseline = null; this.pending = null; this.ranking = null; this.observedRun = null; this.lastAt = null; this.notice = null; this.playEdge = null; this.endRun = null; this.scoreCandidate = null; this.runPlayers = null; }

  rebase(state, frame, now) {
    const presentation = this.presentation;
    const sourceRoom = this.sourceRoom;
    this.reset();
    this.sourceRoom = sourceRoom;
    if (!state.paused && !state.incident && state.auto.scenes && presentation?.sessionId === state.id &&
      presentation.left === state.auto.left && presentation.right === state.auto.right &&
      frame?.tourney?.teams.left === state.auto.left && frame.tourney.teams.right === state.auto.right) this.presentation = presentation;
    if (!state.paused && !state.incident && validRoom(state.auto, frame)) {
      // Seed only the observation position, never an endRun or a Playing edge.
      // This consumes the known pre-command snapshot so the next new map is not
      // accidentally swallowed as the first baseline after incident handling.
      this.baseline = { mapId: frame.beatmap.id, ipc: frame.tourney.ipcState };
      this.lastAt = now;
    }
  }

  hold(state, reason) {
    this.reset();
    const round = currentRound(state);
    if (!state.incident && ['playing', 'ranking'].includes(round?.status)) {
      state = automaticTransition(state, draft => holdRound(draft, 'unverified', reason, 'tosu'), `本图异常待核对：${reason}`, randomUUID());
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
      state = automaticTransition(state, draft => {
        Object.assign(draft.auto, { profile: 'stable-tourney', ...teams });
        draft.match.teams.a.name = teams.left;
        draft.match.teams.b.name = teams.right;
      }, `自动读取 tosu 房间与播出队名：${teams.left} / ${teams.right}`, randomUUID(), { undo: false });
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
    if (playingEvent && !result.state.paused && !result.state.incident && result.state.phase !== 'winner' && !seriesComplete(result.state) &&
      (result.state.scene !== 'playing' || result.state.sceneOverride)) {
      result.state = automaticTransition(result.state, draft => {
        draft.scene = 'playing'; draft.sceneOverride = null;
      }, '房间正在 Playing：自动跟随播出画面（不补建本局或计胜）', randomUUID(), { undo: false });
    }
    const finished = currentRound(result.state);
    const rankingExit = bound && previous?.ipc === 4 && [1, 2].includes(room.ipcState) &&
      previous.sessionId === result.state.id && previous.left === config.left && previous.right === config.right;
    if (rankingExit && !result.state.paused && result.state.phase !== 'winner' && !seriesComplete(result.state) &&
      (!finished || ['prepared', 'ranking', 'recorded'].includes(finished.status)) &&
      (result.state.scene !== 'mappool' || result.state.sceneOverride)) {
      // Returning to the room is a presentation event, even without a new map.
      // Keep pending results/incidents intact; this never advances BP or awards.
      result.state = automaticTransition(result.state, draft => {
        draft.scene = 'mappool'; draft.sceneOverride = null;
        if (currentRound(draft) && !draft.incident) draft.phase = 'bp';
      }, 'tosu 离开 Ranking 返回房间：自动回到图池（保留本局赛果）', randomUUID(), { undo: false });
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
    const valid = validRoom(config, frame);
    if (!valid) return this.hold(state, '房间或观战客户端资料不完整，不能据此判断 abort、选手掉线或 Panic');
    const ipc = room.ipcState;
    if (this.lastAt !== null && (now - this.lastAt > 5000 || now < this.lastAt)) return this.hold(state, '观战数据连续性中断，请核对比赛是否仍在进行');
    this.lastAt = now;
    const counted = currentRound(state);
    // osu!tourney hides and clears aggregate scores after showing results,
    // while its clients still retain the verified final scores and IPC stays 4.
    const clearedDisplay = counted?.finalScore && room.scoreVisible === false &&
      room.totalScore.left === 0 && room.totalScore.right === 0;
    if (!clearedDisplay && ipc === 4 && counted?.status === 'recorded' && counted.resultSource === 'tosu' && !counted.autoProtected &&
      entryOf(state, counted.entryId)?.beatmapId === mapId &&
      (room.totalScore.left !== counted.finalScore?.a || room.totalScore.right !== counted.finalScore?.b)) {
      const next = automaticTransition(state, draft => {
        const round = currentRound(draft);
        round.status = 'ranking'; round.winner = null; round.resultSource = 'review'; round.finalScore = null;
        draft.winner = null;
        if (draft.phase === 'winner') { draft.phase = 'playing'; draft.scene = 'playing'; }
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
        else if (!seriesComplete(state) && state.phase !== 'winner' && round?.status !== 'playing' &&
          (state.phase === 'bp' || state.action || round?.status === 'prepared' || ['ranking', 'recorded'].includes(round?.status))) {
          try {
            // Return to BP only for an available map. Old/unavailable maps must not move the display.
            const occupied = Object.values(state.bans).some(slots => slots.includes(entry.id)) ||
              state.rounds.some(r => r.entryId === entry.id && r.status !== 'void' && r.id !== (round?.status === 'prepared' ? round.id : null));
            if (occupied) throw new Error('房间谱面已 Ban / 已打 / 正在使用，请手动纠正');
            const returnToBp = config.scenes && (['ranking', 'recorded'].includes(round?.status) || state.sceneOverride);
            const consumeBp = config.bp && (state.action || round?.status === 'prepared');
            if (returnToBp || consumeBp) next = automaticTransition(state, draft => {
              if (returnToBp) { draft.phase = 'bp'; draft.scene = 'mappool'; draft.sceneOverride = null; }
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
    if (sameMap && !this.pending && next.phase !== 'winner') {
      if (ipc === 3 && this.playEdge === mapId && round.status === 'prepared' && next.phase === 'bp' && !next.action && !seriesComplete(next)) {
        next = automaticTransition(next, draft => {
          const scene = draft.scene;
          startRound(draft, 'tosu');
          if (!config.scenes) draft.scene = scene;
          else draft.sceneOverride = null;
        }, 'tosu Playing → 本局开打', randomUUID());
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
              releaseRoundBp(draft, playing);
              if (config.scenes) { draft.scene = 'playing'; draft.sceneOverride = null; }
            }, 'tosu 连续 Playing → Ranking：保留 Playing 画面与总分', randomUUID());
            this.endRun = { roundId: round.id, runId: round.runId };
            this.observedRun = null; this.ranking = null;
          }
        }
      } else if (ipc !== 3 && ipc !== 4) { this.observedRun = null; this.ranking = null; }
    } else { this.observedRun = null; this.ranking = null; }
    // Keep observing a known continuous finish if totals arrive after Ranking.
    // A fresh connection at Ranking has no endRun and can never backfill a win.
    const finished = currentRound(next);
    if (config.results && ipc === 4 && sameMap && this.endRun?.roundId === finished.id && this.endRun.runId === finished.runId && finished.status === 'ranking' && !['manual', 'retracted'].includes(finished.resultSource)) {
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
    if (next.sceneOverride) note = `${config.scenes ? '画面人工覆盖中，下一有效换图 / 开打 / 结算自动接回。' : '自动选画面已关闭，保持人工画面；比赛数据跟随继续。'}${note}`;
    return { state: next, note };
  }
}
