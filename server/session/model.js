import { randomUUID } from 'node:crypto';

export const SCENES = ['waiting', 'roll', 'mappool', 'playing', 'map-result', 'victory', 'pause'];
const MODS = ['NM', 'HD', 'HR', 'DT', 'FM', 'TB'];
const SIDES = ['a', 'b'];
export const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const text = (value, max = 160) => typeof value === 'string' && value.length <= max;
const side = value => SIDES.includes(value);
const clone = value => structuredClone(value);

export function newSession() {
  return {
    schema: 1, id: randomUUID(), version: 0,
    match: { title: 'OCLR S11', edition: null, fixtureId: null, poolId: null, provenance: 'manual',
      stage: 'group', mode: '4v4', source: '4x3',
      teams: { a: { id: null, name: '左队待设置', roster: [] }, b: { id: null, name: '右队待设置', roster: [] } } },
    pool: [], poolMarks: [], poolChoice: null, arrived: { a: false, b: false }, ready: { a: false, b: false },
    roll: { a: null, b: null, winner: null, pickFirst: null, banFirst: null },
    phase: 'arrival', scene: 'waiting', returnScene: null, paused: false, sceneOverride: null, automationVersion: 3,
    auto: { bp: true, scenes: true, results: true, profile: 'unverified', left: '', right: '', mapDebounceMs: 400, rankingDebounceMs: 250 },
    action: null, queue: [], bpFlow: null, emptyBans: { a: [false, false], b: [false, false] }, planVerification: null, bans: { a: [null, null], b: [null, null] }, bpHistory: [],
    rounds: [], currentRoundId: null, incident: null, winner: null, seriesAdjustment: { a: 0, b: 0 },
    ex: { team: null, remaining: { a: 2, b: 2 } }, pauseType: 'technical',
    history: [], undo: [], commandIds: [],
  };
}

// Upgrade the old implicit global locks only when their origin is known. An
// explicit/ambiguous old hold becomes an explicit pause. Upgrade undo
// domains too, so undo cannot silently reinstall the old defaults or locks.
export function restoreAutomation(state) {
  if (state.automationVersion === 3) return state;
  const next = clone(state);
  const upgrade = (draft, trail) => {
    if (draft.automationVersion === 3) return;
    const cause = [...trail].reverse().find(item => !item.state.locked)?.message;
    const incidental = draft.automationVersion !== 2 && cause && /手动切画面并锁定|已准备本图|人工调整本图|保存本场队伍与图池|已同步本场图池/.test(cause);
    if (draft.locked && incidental) draft.sceneOverride = { scene: draft.scene, until: 'next-match-event' };
    draft.paused = !!draft.paused || draft.scene === 'pause' || (!!draft.locked && !incidental);
    if (draft.paused) draft.returnScene ||= draft.scene === 'pause' ? 'waiting' : draft.scene;
    delete draft.locked;
    draft.sceneOverride ??= null;
    draft.auto.results ??= true;
    if (draft.auto.profile === 'unverified' && !draft.auto.left && !draft.auto.right) {
      draft.auto.bp = true; draft.auto.scenes = true;
    }
    draft.automationVersion = 3;
  };
  const oldTrail = clone(next.undo || []);
  upgrade(next, oldTrail);
  next.undo?.forEach((item, index) => upgrade(item.state, oldTrail.slice(0, index)));
  return next;
}

export const targetOf = s => s.match.stage === 'final' ? 7 : 6;
export const currentRound = s => s.rounds.find(r => r.id === s.currentRoundId) || null;
export const seriesOf = s => Object.fromEntries(SIDES.map(team => [team,
  s.rounds.filter(r => r.status === 'recorded' && r.winner === team).length + (s.seriesAdjustment?.[team] || 0)]));
export const seriesComplete = s => SIDES.some(team => seriesOf(s)[team] >= targetOf(s));
export const entryOf = (s, id) => s.pool.find(e => e.id === id);
const domain = s => ({ poolMarks: [], poolChoice: null, ...Object.fromEntries(Object.entries(s).filter(([key]) => !['version', 'history', 'undo', 'commandIds'].includes(key))) });

export function holdRound(s, kind, reason, source = 'manual') {
  const round = currentRound(s);
  requireValue(round && ['prepared', 'playing', 'ranking'].includes(round.status), '没有待处理本图；已计胜请先撤回本局计胜');
  s.incident = { kind: kind === 'abort' && round.status === 'prepared' ? 'prestart-abort' : kind,
    roundId: round.id, reason, source, at: new Date().toISOString() };
}

const requireResolved = (s, roundId = s.currentRoundId) => requireValue(!s.incident || s.incident.roundId !== roundId, '本图异常尚未处理，请确认继续本局或由裁判确认重赛');

export function normalizePool(entries) {
  requireValue(Array.isArray(entries) && entries.length <= 120, '图池格式无效（最多 120 条）');
  const ids = new Set();
  return entries.map(entry => {
    requireValue(entry && text(entry.id, 100) && entry.id && !ids.has(entry.id), '图池条目 ID 必须唯一');
    ids.add(entry.id);
    requireValue(Number.isSafeInteger(entry.beatmapId) && entry.beatmapId > 0 && MODS.includes(entry.mod), '谱面 ID 或 mod 无效');
    requireValue(text(entry.label, 24) && entry.label, '请填写图池标签，例如 HD2');
    for (const field of ['title', 'artist', 'difficulty']) requireValue(entry[field] == null || text(entry[field], 300), '谱面文字过长');
    return { id: entry.id, beatmapId: entry.beatmapId, mod: entry.mod, label: entry.label,
      title: entry.title || '', artist: entry.artist || '', difficulty: entry.difficulty || '',
      ...(Number.isSafeInteger(entry.setId) && entry.setId > 0 ? { setId: entry.setId } : {}) };
  });
}

function normalizeTeams(teams) {
  const result = {};
  for (const team of SIDES) {
    const value = teams?.[team];
    requireValue(value && text(value.name, 300) && value.name.trim(), '请填写双方队名');
    requireValue(value.id == null || text(value.id, 100), '队伍 ID 无效');
    requireValue(Array.isArray(value.roster) && value.roster.length <= 20, '名单格式无效');
    result[team] = { id: value.id || null, name: value.name.trim(), roster: value.roster.map(p => {
      requireValue(p && text(p.name, 80) && p.name.trim(), '选手姓名无效');
      requireValue(p.osuId == null || (Number.isSafeInteger(p.osuId) && p.osuId > 0), '选手 ID 无效');
      return { name: p.name.trim(), osuId: p.osuId ?? null };
    }) };
  }
  requireValue(!result.a.id || result.a.id !== result.b.id, '左右队伍不能相同');
  return result;
}

function normalizeAction(action) {
  requireValue(action && ['ban', 'pick'].includes(action.kind) && side(action.team), '请明确 BP 动作与行动队伍');
  requireValue(action.kind !== 'ban' || [0, 1].includes(action.slot), 'Ban 槽位无效');
  return { id: randomUUID(), kind: action.kind, team: action.team, slot: action.kind === 'ban' ? action.slot : null };
}

// The two Roll choices are independent. Only a pristine match is enrolled;
// existing/manual sessions and their undo domains keep their original order.
const bpStarted = s => s.rounds.length > 0 || (s.bpHistory || []).length > 0 || SIDES.some(t => s.bans[t].some(Boolean));
function syncRollFlow(s) {
  if (bpStarted(s) || s.bpFlow?.mode === 'manual' || (!s.bpFlow &&
    (s.action || s.queue.length || s.planVerification || (s.bpFlow === undefined && s.history.some(h => /设置明确 BP|更新明确配置的后续 BP/.test(h.message)))))) return false;
  if (!side(s.roll.banFirst) || !side(s.roll.pickFirst)) {
    if (s.bpFlow?.mode === 'roll') { s.action = null; s.queue = []; s.bpFlow = null; }
    return false;
  }
  const { banFirst, pickFirst } = s.roll;
  if (s.bpFlow?.banFirst === banFirst && s.bpFlow?.pickFirst === pickFirst) return true;
  const other = team => team === 'a' ? 'b' : 'a';
  const ban = (team, slot) => normalizeAction({ kind: 'ban', team, slot });
  const pick = team => ({ ...normalizeAction({ kind: 'pick', team }), ordinal: 1 });
  s.bpFlow = { version: 1, mode: 'roll', banFirst, pickFirst, nextPair: 2 };
  s.queue = [ban(banFirst, 0), ban(other(banFirst), 0), pick(pickFirst), pick(other(pickFirst)), ban(banFirst, 1), ban(other(banFirst), 1)];
  s.action = s.queue.shift();
  if (['arrival', 'roll'].includes(s.phase)) s.phase = 'bp';
  return true;
}

function takeBpAction(s) {
  const replenish = () => {
    if (s.bpFlow?.mode !== 'roll' || s.queue.length) return;
    const { pickFirst, nextPair } = s.bpFlow;
    s.queue.push(...[pickFirst, pickFirst === 'a' ? 'b' : 'a'].map(team => ({
      ...normalizeAction({ kind: 'pick', team }), ordinal: nextPair,
    })));
    s.bpFlow.nextPair++;
  };
  replenish();
  const action = s.queue.shift() || null;
  replenish();
  return action;
}

// End-of-map and awarding a win are deliberately separate. Release once at a
// verified finish; missing totals must not prevent preparing the next map.
export function releaseRoundBp(s, round) {
  if (round.bpReleased) return;
  round.bpReleased = true;
  round.bpReleaseHistory = (s.bpHistory || []).length;
  if (round.id === s.currentRoundId && !s.action && entryOf(s, round.entryId)?.mod !== 'TB') s.action = takeBpAction(s);
  if (s.action) s.poolChoice = { team: s.action.team, kind: s.action.kind };
}

export function bpStopReason(s) {
  if (seriesComplete(s) || s.phase === 'winner') return '比赛已结束，停止 BP；请核对比分并展示 Winner';
  const round = currentRound(s);
  if (round && entryOf(s, round.entryId)?.mod === 'TB') return ['ranking', 'recorded'].includes(round.status) ? 'TB 已结束，等待核对赛果；不推进普通 Pick' : null;
  if (s.bpFlow?.mode === 'roll') {
    const finished = s.rounds.filter(r => ['ranking', 'recorded'].includes(r.status) && entryOf(s, r.entryId)?.mod !== 'TB').length;
    if (finished >= 2 * (targetOf(s) - 1) || SIDES.every(t => seriesOf(s)[t] === targetOf(s) - 1)) return '常规选图已结束，等待裁判核对赛果与 TB；TB 单独准备';
  }
  return null;
}

export function bpProgress(s) {
  const round = currentRound(s);
  const stop = bpStopReason(s);
  const waiting = stop || (s.incident ? '本图异常待核对，BP 暂停推进' : s.paused ? '明确暂停中，返回原画面后继续'
    : round?.status === 'prepared' ? `${s.match.teams[round.pickedBy].name}已选图，等待本图开打`
    : round?.status === 'playing' ? '本图进行中，结束后继续 BP' : null);
  return { current: waiting ? null : s.action, next: stop ? null : waiting ? s.action || s.queue[0] || null : s.queue[0] || null,
    waiting, stopped: !!stop, mode: s.bpFlow?.mode || 'legacy',
    canApply: !waiting && !!s.action, canReplace: !stop && !s.incident && !s.paused && round?.status === 'prepared',
    rollChanged: s.bpFlow?.mode === 'roll' && (s.roll.banFirst !== s.bpFlow.banFirst || s.roll.pickFirst !== s.bpFlow.pickFirst) };
}

function updatePool(s, entries) {
  const pool = normalizePool(entries);
  const used = new Set([...Object.values(s.bans).flat().filter(Boolean), ...s.rounds.filter(r => r.status !== 'void').map(r => r.entryId)]);
  requireValue([...used].every(id => pool.some(e => e.id === id)), '不能删除已 Ban、已选或已打的谱面；其他资料已保留，请先修正相关记录');
  for (const slots of Object.values(s.bans)) {
    const mods = slots.filter(Boolean).map(id => pool.find(e => e.id === id).mod);
    requireValue(!mods.includes('TB') && ['HD', 'HR', 'DT'].every(mod => mods.filter(m => m === mod).length <= 1), '该谱面改动会使现有 Ban 不符合限制，请先修正 Ban');
  }
  const round = currentRound(s);
  const before = entryOf(s, round?.entryId);
  const after = pool.find(e => e.id === round?.entryId);
  if (before && after && (before.beatmapId !== after.beatmapId || before.mod !== after.mod)) {
    if (after.mod === 'TB') { s.ex.team = null; round.exTeam = null; }
  }
  s.pool = pool;
  s.poolMarks = (s.poolMarks || []).filter(mark => pool.some(entry => entry.id === mark.entryId));
}

function available(s, entryId, exceptRoundId) {
  const entry = entryOf(s, entryId);
  requireValue(entry, '该条目不在本场图池中');
  requireValue(!SIDES.some(t => s.bans[t].includes(entryId)), '该图已经 Ban');
  requireValue(!s.rounds.some(r => r.id !== exceptRoundId && r.entryId === entryId && r.status !== 'void'), '该图已选用或已打');
  return entry;
}

function recordBp(s, action, entryId, source, eventId, kind = action.kind) {
  s.bpHistory ||= [];
  s.bpHistory.push({ id: randomUUID(), matchId: s.id, actionId: action.id, kind,
    team: action.team, slot: action.slot ?? null, entryId, source, eventId, at: new Date().toISOString() });
}

export function applyBp(s, entryId, source = 'manual', actionId = s.action?.id, eventId = null) {
  requireResolved(s);
  requireValue(!s.paused && !bpStopReason(s), bpStopReason(s) || '明确暂停中，请先返回原画面');
  requireValue(s.scene !== 'pause' && (source === 'manual' || s.phase === 'bp' || s.scene === 'mappool'), '请先进入 BP');
  const round = currentRound(s);
  requireValue(round?.status !== 'playing', '本图尚未结束，不能执行下一个 BP 动作');
  const replace = round?.status === 'prepared' && (!s.action || (source === 'manual' && s.action.kind === 'pick'));
  requireValue(replace || (s.action && s.action.id === actionId), 'BP 动作已改变，请刷新当前动作');
  if (replace) {
    available(s, entryId, round.id);
    requireValue(s.bpFlow?.mode !== 'roll' || (entryOf(s, entryId).mod === 'TB') === (entryOf(s, round.entryId)?.mod === 'TB'), 'TB 单独准备，不作为普通 Pick 或改图');
    round.entryId = entryId;
    round.source = source;
    round.eventId = eventId;
    if (s.action) {
      round.pickedBy = s.action.team;
      round.actionId = s.action.id;
      s.action = null;
    }
    recordBp(s, { id: round.actionId, team: round.pickedBy, kind: 'pick' }, entryId, source, eventId, 'replace-pick');
    if (entryOf(s, entryId).mod === 'TB') s.ex.team = null;
    return '替换本轮准备图';
  }
  const action = s.action;
  requireValue(round?.status !== 'prepared' || (source === 'manual' && action.kind === 'ban' && s.bpFlow?.mode !== 'roll'), '当前图已准备，请开打或作废本轮后再执行新动作');
  const entry = available(s, entryId);
  if (action.kind === 'ban') {
    requireValue(entry.mod !== 'TB', 'TB 不可 Ban');
    requireValue(s.bans[action.team][action.slot] === null && !s.emptyBans?.[action.team]?.[action.slot], '该 Ban 槽已有记录，请先修正或撤销');
    requireValue(!['HD', 'HR', 'DT'].includes(entry.mod) || !s.bans[action.team].some(id => entryOf(s, id)?.mod === entry.mod), '同队不能重复 Ban 此 mod（NM/FM 例外）');
    s.bans[action.team][action.slot] = entryId;
  } else {
    requireValue(s.bpFlow?.mode !== 'roll' || entry.mod !== 'TB', 'TB 单独准备，不混入普通 Pick 队列');
    const next = { id: randomUUID(), entryId, pickedBy: action.team, status: 'prepared', winner: null,
      source, actionId: action.id, bpAction: clone(action), eventId, runId: null, finalScore: null, exTeam: null };
    s.rounds.push(next);
    s.currentRoundId = next.id;
    s.ex.team = null;
    s.phase = 'bp';
  }
  recordBp(s, action, entryId, source, eventId);
  s.action = action.kind === 'ban' && round?.status !== 'prepared' ? takeBpAction(s) : null;
  if (s.action) s.poolChoice = { team: s.action.team, kind: s.action.kind };
  else if (action.kind === 'ban') s.poolChoice = null;
  return `${s.match.teams[action.team].name} ${action.kind === 'ban' ? `Ban ${action.slot + 1}` : 'Pick'} ${entry.label}`;
}

export function startRound(s, source = 'manual') {
  requireResolved(s);
  const round = currentRound(s);
  requireValue(round?.status === 'prepared', '尚未准备本轮谱面');
  requireValue(!s.action, '当前还有 BP 动作，完成后再开打');
  requireValue(!seriesComplete(s), '系列已达到目标，请核对 Winner 或人工修正比分');
  requireValue(!bpStopReason(s), bpStopReason(s));
  round.status = 'playing'; round.runId = randomUUID(); round.startedBy = source; round.exTeam = s.ex.team;
  delete round.autoProtected;
  s.phase = 'playing'; s.scene = 'playing';
}

// Ranking changes the display; this separately awards the round from validated
// totals. Calling it twice cannot award again. Winner display remains an operator action.
export function awardTosuResult(s, roundId, scores) {
  requireResolved(s, roundId);
  const round = s.rounds.find(r => r.id === roundId);
  requireValue(round?.status === 'ranking', '该局已计胜或尚未结算');
  const { left, right } = scores;
  requireValue([left, right].every(n => Number.isSafeInteger(n) && n >= 0) && left !== right, '最终队分缺失或平分，等待人工处理');
  const winner = left > right ? 'a' : 'b';
  requireValue(seriesOf(s)[winner] < targetOf(s), '系列已达到目标，等待直播员核对');
  round.finalScore = { a: left, b: right };
  round.status = 'recorded'; round.winner = winner; round.resultSource = 'tosu';
}

function leaveInvalidWinner(s) {
  s.winner = null;
  if (s.phase === 'winner') {
    s.phase = 'bp'; s.scene = currentRound(s) ? 'map-result' : 'mappool';
  }
}

function applyCommand(s, command) {
  const p = command.payload || {};
  switch (command.type) {
    case 'map-mark': {
      const entry = entryOf(s, p.entryId);
      requireValue(entry && ['open', 'banned', 'picked'].includes(p.status), '请选择谱面及 Ban / Pick 标记');
      requireValue(p.status === 'open' ? p.team === null : side(p.team), '请选择标记队伍');
      s.poolMarks = (s.poolMarks || []).filter(mark => mark.entryId !== entry.id);
      s.poolMarks.push({ entryId: entry.id, status: p.status, team: p.team });
      return p.status === 'open' ? `已清除 ${entry.label} 的图池标记` : `已标记 ${s.match.teams[p.team].name} ${p.status === 'banned' ? 'Ban' : 'Pick'} ${entry.label}`;
    }
    case 'choose-pool-map': {
      const choice = s.poolChoice;
      requireValue(choice && side(choice.team) && ['ban', 'pick'].includes(choice.kind), '先选择队伍的 Ban／Pick，或直接选择谱面后再点击动作');
      const message = applyCommand(s, { type: 'map-mark', payload: { entryId: p.entryId, status: choice.kind === 'ban' ? 'banned' : 'picked', team: choice.team } });
      const round = currentRound(s);
      const occupied = SIDES.some(t => s.bans[t].includes(p.entryId)) || s.rounds.some(r => r.entryId === p.entryId && r.status !== 'void' && !(r.id === round?.id && r.status === 'prepared'));
      // Marks stay editable without rewriting an active run or its result.
      if (s.paused || s.incident || seriesComplete(s) || s.phase === 'winner' || round?.status === 'playing' || occupied) return `${message}（比赛记录保留）`;
      if (!targetOf(s) || entryOf(s, p.entryId)?.mod === 'TB') return message;
      if (choice.kind === 'pick') return applyCommand(s, { type: 'prepare-round', payload: { entryId: p.entryId, pickedBy: choice.team } });
      if (round?.status !== 'prepared' && s.action?.kind === 'ban' && s.action.team === choice.team && !bpStopReason(s)) return applyBp(s, p.entryId);
      return message;
    }
    case 'prepare-round': {
      requireValue(!('ifCurrentRoundId' in p) || p.ifCurrentRoundId === s.currentRoundId, '本局已切换，请在最新轮次重新修改');
      requireValue(side(p.pickedBy), '请选择本局选图队伍');
      requireResolved(s);
      requireValue(!s.paused && !seriesComplete(s), '暂停中或比赛已结束，不能准备新图');
      const round = currentRound(s);
      requireValue(round?.status !== 'playing', '本图尚未结束，不能准备下一图');
      if (round?.status === 'prepared') {
        if (s.action) s.queue.unshift(s.action);
        s.action = null;
        applyBp(s, p.entryId);
        round.pickedBy = p.pickedBy;
        return `已替换本图 ${entryOf(s, p.entryId).label}，保留原 Pick 次数与后续顺序`;
      }
      if (entryOf(s, p.entryId)?.mod === 'TB') {
        requireValue(p.tiebreaker === true, '请明确使用单独的 TB 准备');
        available(s, p.entryId);
        const next = { id: randomUUID(), entryId: p.entryId, pickedBy: p.pickedBy, status: 'prepared', winner: null,
          source: 'manual-tb', actionId: null, eventId: null, runId: null, finalScore: null, exTeam: null };
        if (s.action) s.queue.unshift(s.action);
        s.action = null; s.rounds.push(next); s.currentRoundId = next.id; s.ex.team = null; s.phase = 'bp';
        return '人工确认当前 TB，单独准备（禁 EX，不补录此前 BP）';
      }
      // A manual current-map declaration can join a match mid-series. Do not
      // invent prior Bans/Picks or force the operator through the old cursor.
      const followsCurrent = s.action?.kind === 'pick' && s.action.team === p.pickedBy;
      if (!followsCurrent && s.bpFlow?.mode === 'roll') { s.queue = []; s.bpFlow = { mode: 'manual' }; }
      s.action = { id: randomUUID(), kind: 'pick', team: p.pickedBy, slot: null };
      applyBp(s, p.entryId);
      return `已准备本图 ${entryOf(s, p.entryId).label}，等待开打`;
    }
    case 'wait-result': {
      const round = currentRound(s);
      requireValue(round && ['playing', 'ranking', 'recorded'].includes(round.status), '本图尚未开打');
      if (round.status === 'recorded') applyCommand(s, { type: 'retract-result', payload: { roundId: round.id, reason: p.reason } });
      requireValue(['player-disconnect', 'spectator'].includes(p.kind) && text(p.reason) && p.reason.trim(), '请选择现场情况');
      holdRound(s, p.kind, p.reason);
      return `本图暂不加分，保留本次开打：${p.reason}`;
    }
    case 'referee-replay': {
      const round = currentRound(s);
      requireValue(round, '没有当前谱面');
      if (round.status === 'recorded') applyCommand(s, { type: 'retract-result', payload: { roundId: round.id, reason: p.reason } });
      return applyCommand(s, { type: 'replay', payload: p });
    }
    case 'incident': {
      requireValue(['abort', 'player-disconnect', 'spectator'].includes(p.kind) && text(p.reason) && p.reason.trim(), '请选择异常类型并填写原因');
      holdRound(s, p.kind, p.reason.trim());
      return `标记本图异常（停止自动推进与计胜）：${p.reason.trim()}`;
    }
    case 'resolve-incident': {
      requireValue(s.incident && s.incident.roundId === s.currentRoundId && text(p.reason) && p.reason.trim(), '请填写本图恢复核对说明');
      requireValue(currentRound(s)?.status !== 'ranking', '本局已进入结算，请填写核对说明后人工记录赛果，或由裁判确认重赛');
      s.incident = null;
      return `确认继续同一本局（保留选图与开打记录）：${p.reason.trim()}`;
    }
    case 'set-stage': {
      requireValue(['group', 'elimination', 'final'].includes(p.stage), '比赛阶段无效');
      s.match.stage = p.stage;
      requireValue(SIDES.every(t => seriesOf(s)[t] <= targetOf(s)), '现有系列比分超出该阶段目标，请先校正比分');
      if (s.winner && seriesOf(s)[s.winner] < targetOf(s)) leaveInvalidWinner(s);
      return `更新比赛阶段：${{ group: '小组赛 · BO11', elimination: '淘汰赛 · BO11', final: '决赛 · BO13' }[p.stage]}`;
    }
    case 'setting': {
      const { field, value } = p;
      if (field === 'title') { requireValue(text(value), '比赛标题最多 160 字'); s.match.title = value; }
      else if (field === 'mode') { requireValue(['3v3', '4v4'].includes(value), '常规人数无效'); s.match.mode = value; }
      else if (field === 'source') { requireValue(['4x3', '16x9'].includes(value), '游戏源比例无效'); s.match.source = value; }
      else if (field === 'team-name' || field === 'roster') {
        requireValue(side(p.team), '请选择对应队伍');
        const teams = clone(s.match.teams);
        if (field === 'team-name') teams[p.team].name = value;
        else teams[p.team].roster = value;
        s.match.teams = normalizeTeams(teams);
        s.match.provenance = 'manual';
      } else if (field === 'pool') { updatePool(s, value); s.match.provenance = 'manual'; }
      else throw new Error('设置字段无效');
      return `已同步${{ title: '比赛标题', mode: '常规人数', source: '游戏源比例', 'team-name': '队名', roster: '上场名单', pool: '本场图池' }[field]}，保留比赛进度与记录`;
    }
    case 'adjust-round': {
      const round = currentRound(s);
      requireValue(!('ifCurrentRoundId' in p) || p.ifCurrentRoundId === s.currentRoundId, '本局已切换，请在最新轮次重新修改');
      requireValue(round && ['prepared', 'playing', 'ranking'].includes(round.status), '请先选择尚未计胜的本图');
      requireValue(side(p.pickedBy), '请选择 Pick 方');
      const entry = available(s, p.entryId, round.id);
      requireValue(s.bpFlow?.mode !== 'roll' || (entry.mod === 'TB') === (entryOf(s, round.entryId)?.mod === 'TB'), 'TB 单独准备，不能把普通 Pick 与 TB 相互转换；需要时先撤销本次准备');
      round.entryId = entry.id; round.pickedBy = p.pickedBy;
      if (entry.mod === 'TB') { s.ex.team = null; round.exTeam = null; }
      return `人工调整本图为 ${entry.label}，Pick 方 ${s.match.teams[p.pickedBy].name}；保留其他自动流程，可撤销`;
    }
    case 'set-roll': {
      for (const team of SIDES) {
        if (p[team] !== undefined) {
          requireValue(p[team] === null || (Number.isSafeInteger(p[team]) && p[team] >= 0), 'Roll 结果必须为实际非负整数或未知');
          s.roll[team] = p[team];
        }
      }
      for (const field of ['winner', 'pickFirst', 'banFirst']) requireValue(p[field] === null || side(p[field]), '先手归属无效');
      for (const field of ['winner', 'pickFirst', 'banFirst']) s.roll[field] = p[field];
      const built = syncRollFlow(s);
      return built ? '已同步 Roll，按独立先 Ban / 先 Pick 自动建立 BP 当前动作与后续顺序' : '已同步 Roll 点数与先手，保留当前局、BP 和比分；后续有误可在手动调整中修正';
    }
    case 'import-streaming': {
      requireValue(!s.match.fixtureId && !s.pool.length && !s.rounds.length && !s.bpHistory?.length && !s.action && !s.queue.length &&
        s.phase === 'arrival' && s.scene === 'waiting' && !s.paused && !s.incident && s.roll.a === null && s.roll.b === null && !s.roll.winner && !s.roll.pickFirst && !s.roll.banFirst &&
        !s.poolMarks?.length && SIDES.every(t => !s.bans[t].some(Boolean) && seriesOf(s)[t] === 0),
      '请先初始化并存档本场，再使用下一场资料');
      p.source = s.match.source;
    } // fall through: same validated setup transition, guarded atomically above
    case 'update-setup':
    case 'setup': {
      if (command.type === 'setup') requireValue(s.rounds.length === 0 && !SIDES.some(t => s.bans[t].some(Boolean)), '已有 BP/赛果，请先准备下一场，避免覆盖比赛记录');
      requireValue(text(p.title) && ['group', 'elimination', 'final'].includes(p.stage) && ['3v3', '4v4'].includes(p.mode) && ['4x3', '16x9'].includes(p.source), '本场设置无效');
      updatePool(s, p.pool);
      s.match = { title: p.title, edition: p.edition || null, fixtureId: p.fixtureId || null, poolId: p.poolId || null,
        provenance: ['oclr', 'oclr-archive', 'oclr-streaming'].includes(p.provenance) ? p.provenance : 'manual', stage: p.stage, mode: p.mode, source: p.source, teams: normalizeTeams(p.teams) };
      requireValue(SIDES.every(t => seriesOf(s)[t] <= targetOf(s)), '现有比分超出该阶段目标，请先校正比分');
      if (s.winner && seriesOf(s)[s.winner] < targetOf(s)) leaveInvalidWinner(s);
      if (command.type === 'setup' && s.bpFlow?.mode !== 'roll') { s.action = null; s.queue = []; }
      return '保存本场队伍与图池';
    }
    case 'arrival':
      requireValue(side(p.team) && typeof p.arrived === 'boolean' && typeof p.ready === 'boolean', '到场状态无效');
      requireValue(!p.ready || p.arrived, '未到场不能标记就绪');
      s.arrived[p.team] = p.arrived; s.ready[p.team] = p.ready;
      return '更新到场 / 就绪';
    case 'begin-roll': s.phase = 'roll'; s.scene = 'roll'; return '开始展示 Roll';
    case 'roll': {
      for (const team of SIDES) requireValue(p[team] === null || (Number.isSafeInteger(p[team]) && p[team] >= 0), 'Roll 结果必须为实际非负整数或未知');
      for (const field of ['winner', 'pickFirst', 'banFirst']) requireValue(p[field] === null || side(p[field]), '先手归属无效');
      s.roll = { a: p.a, b: p.b, winner: p.winner, pickFirst: p.pickFirst, banFirst: p.banFirst };
      if (!bpStarted(s)) s.phase = p.enterBp === false ? 'roll' : 'bp';
      s.scene = p.enterBp === false ? 'roll' : 'mappool';
      syncRollFlow(s);
      return p.enterBp === false ? '展示真实 Roll 与独立先手' : '记录真实 Roll 与独立先手，进入 BP';
    }
    case 'bp': s.phase = 'bp'; s.scene = 'mappool'; return '进入 BP（保留比赛记录）';
    case 'select-bp-action': {
      requireValue(side(p.team) && ['ban', 'pick'].includes(p.kind), '请选择下一动作及行动队伍');
      s.poolChoice = { team: p.team, kind: p.kind };
      if (s.paused || s.incident || seriesComplete(s) || s.phase === 'winner' || ['prepared', 'playing'].includes(currentRound(s)?.status)) return '已选择图池标记动作；当前局与比赛记录保留';
      const slot = p.kind === 'ban' ? [0, 1].find(slot => !s.bans[p.team][slot] && !s.emptyBans?.[p.team]?.[slot]) : null;
      if (slot === undefined) return '已选择 Ban 标记；该队 Ban 记录已满，仅修改播出标记';
      // An explicit jump to a current Pick does not prove where a late join
      // sits in the generated OCLR order. Keep unknown earlier actions unknown.
      if (p.kind === 'pick' && s.bpFlow?.mode === 'roll' && (s.action?.kind !== 'pick' || s.action.team !== p.team)) {
        s.queue = []; s.bpFlow = { mode: 'manual' };
      }
      // Arm one event under the established rule; move a queued match here once.
      // A pending old map event is invalidated by the new action ID in Store.
      const queued = s.queue.findIndex(action => action.team === p.team && action.kind === p.kind && (p.kind !== 'ban' || action.slot === slot));
      const selected = queued < 0 ? {} : s.queue.splice(queued, 1)[0];
      s.action = { ...selected, ...normalizeAction({ ...p, slot }) };
      s.bpFlow ||= { mode: 'manual' };
      s.phase = 'bp';
      return `下一动作：${s.match.teams[p.team].name} ${p.kind === 'ban' ? 'Ban' : 'Pick'}；等待新的房间换图，尚未操作谱面`;
    }
    case 'set-action':
      s.bpFlow = { ...s.bpFlow, mode: 'manual' };
      s.action = p.action === null ? null : normalizeAction(p.action);
      if (p.queue !== undefined) {
        requireValue(Array.isArray(p.queue) && p.queue.length <= 40, 'BP 序列过长');
        s.queue = p.queue.map(normalizeAction);
      }
      return '设置明确 BP 动作与后续序列';
    case 'set-plan':
      s.bpFlow = { ...s.bpFlow, mode: 'manual' };
      requireValue(p.verifiedBy == null || text(p.verifiedBy), '核实来源说明过长');
      requireValue(Array.isArray(p.queue) && p.queue.length <= 40, 'BP 序列过长');
      s.queue = p.queue.map(normalizeAction);
      s.planVerification = p.verifiedBy?.trim() || null;
      return `更新明确配置的后续 BP 顺序（不修改当前动作）${s.planVerification ? `：${s.planVerification}` : ''}`;
    case 'apply-bp': return applyBp(s, p.entryId, 'manual', p.actionId);
    case 'skip-ban': {
      const progress = bpProgress(s);
      requireValue(progress.canApply && s.action.kind === 'ban' && s.action.id === p.actionId, '当前不是可处理的 Ban，或动作已改变');
      requireValue(text(p.reason) && p.reason.trim(), '请记录裁判确认空 Ban 的原因');
      const action = s.action;
      requireValue(!s.bans[action.team][action.slot] && !s.emptyBans?.[action.team]?.[action.slot], '该 Ban 槽已有记录，请先修正或撤销');
      s.emptyBans ||= { a: [false, false], b: [false, false] };
      s.emptyBans[action.team][action.slot] = true;
      recordBp(s, action, null, 'manual', null, 'empty-ban');
      s.action = takeBpAction(s);
      return `裁判确认 ${s.match.teams[action.team].name} 空 Ban：${p.reason}`;
    }
    case 'clear-ban':
      requireValue(side(p.team) && [0, 1].includes(p.slot), 'Ban 槽无效');
      requireValue(text(p.reason) && p.reason.trim(), '请填写修正原因');
      s.bans[p.team][p.slot] = null;
      if (s.emptyBans) s.emptyBans[p.team][p.slot] = false;
      return `修正 Ban：${p.reason}`;
    case 'start': startRound(s); return '手动进入 Playing';
    case 'ranking': {
      requireResolved(s);
      const round = currentRound(s);
      requireValue(round && ['playing', 'ranking'].includes(round.status), '没有进行中的轮次');
      round.status = 'ranking'; s.scene = 'map-result';
      releaseRoundBp(s, round);
      return '展示单图结算（不计胜）';
    }
    case 'record-result': {
      const round = s.rounds.find(r => r.id === p.roundId);
      if (s.incident?.roundId === p.roundId) {
        requireValue(text(p.reviewReason) && p.reviewReason.trim(), '本图有异常，请填写核对说明后人工记录赛果');
        if (round) round.finalScore = null;
        s.incident = null;
      }
      requireValue(round && ['playing', 'ranking'].includes(round.status), '该局未开打、已记录或已作废');
      requireValue(side(p.winner), '请指定本图胜方');
      requireValue(seriesOf(s)[p.winner] < targetOf(s), '该队已达到系列目标，请核对比赛记录');
      round.status = 'recorded'; round.winner = p.winner; round.resultSource = 'manual';
      releaseRoundBp(s, round);
      requireValue(p.keepDisplay === undefined || typeof p.keepDisplay === 'boolean', '赛果显示选项无效');
      if (p.keepDisplay) {
        if (round.id === s.currentRoundId) {
          s.phase = 'bp';
        }
        return `已记录 ${entryOf(s, round.entryId).label}：${s.match.teams[p.winner].name} 胜，系列比分 ${seriesOf(s).a}:${seriesOf(s).b}；保留当前画面`;
      }
      if (seriesOf(s)[p.winner] >= targetOf(s)) {
        s.winner = p.winner; s.phase = 'winner'; s.scene = 'victory';
      } else if (round.id === s.currentRoundId) {
        s.phase = 'bp'; s.scene = 'mappool';
      }
      return p.reviewReason ? `异常赛果经人工核对后计胜：${p.reviewReason}` : round.id === s.currentRoundId ? '记录本图结果并更新播出画面' : '补记上一局结果，保留当前轮次与画面';
    }
    case 'correct-result': {
      const round = s.rounds.find(r => r.id === p.roundId);
      requireValue(round?.status === 'recorded' && side(p.winner) && text(p.reason) && p.reason.trim(), '请指定已记录局、修正胜方及原因');
      round.winner = p.winner;
      round.resultSource = 'manual';
      requireValue(SIDES.every(t => seriesOf(s)[t] >= 0 && seriesOf(s)[t] <= targetOf(s)), '修正后系列分超出范围，请先核对人工系列分校正');
      leaveInvalidWinner(s);
      return `修正本图结果：${p.reason}`;
    }
    case 'retract-result': {
      const round = s.rounds.find(r => r.id === p.roundId);
      requireValue(round?.status === 'recorded' && text(p.reason) && p.reason.trim(), '请指定已计胜局并填写撤回原因');
      round.status = 'ranking'; round.winner = null; round.resultSource = 'retracted';
      requireValue(SIDES.every(t => seriesOf(s)[t] >= 0), '撤回后系列分低于零，请先核对人工系列分校正');
      leaveInvalidWinner(s);
      return `撤回本图计胜，等待重新记录：${p.reason}`;
    }
    case 'set-series': {
      requireValue(SIDES.every(t => Number.isInteger(p[t]) && p[t] >= 0 && p[t] <= targetOf(s)), '系列比分须在 0 与赛制目标之间');
      requireValue(text(p.reason) && p.reason.trim(), '请填写系列比分校正原因');
      const old = seriesOf(s);
      s.seriesAdjustment = Object.fromEntries(SIDES.map(t => [t, p[t] - s.rounds.filter(r => r.status === 'recorded' && r.winner === t).length]));
      // Explicit operator scores take precedence over all previously received results.
      for (const round of s.rounds) if (['ranking', 'recorded'].includes(round.status)) round.autoProtected = true;
      leaveInvalidWinner(s);
      return `人工校正系列分 ${old.a}:${old.b} → ${p.a}:${p.b}：${p.reason}`;
    }
    case 'replay': {
      const round = currentRound(s);
      requireValue(round && ['prepared', 'playing', 'ranking'].includes(round.status) && text(p.reason) && p.reason.trim(), '请填写未记录本轮的重赛原因；已计胜请先撤回');
      s.incident = null;
      if (round.status === 'prepared') return `尚未开打，保留原选图继续准备（不新增重赛）：${p.reason}`;
      requireValue(round.bpReleaseHistory == null || (s.bpHistory || []).length <= round.bpReleaseHistory, '本图结束后已有新的 BP 记录；请先撤销后续 BP，再确认原图重赛');
      const next = { ...clone(round), id: randomUUID(), replayOf: round.id, status: 'prepared', winner: null, runId: null, finalScore: null };
      delete next.bpReleased; delete next.bpReleaseHistory;
      delete next.resultSource; delete next.startedBy;
      round.status = 'void';
      // Ranking may already have exposed the next Pick. Put it back until this
      // selection actually finishes, rather than consuming a second BP action.
      if (s.action) s.queue.unshift(s.action);
      s.rounds.push(next); s.currentRoundId = next.id; s.action = null;
      s.phase = 'bp'; s.scene = 'mappool'; s.ex.team = next.exTeam;
      return `作废并准备独立重赛：${p.reason}`;
    }
    case 'void-round': {
      const round = currentRound(s);
      requireValue(round && round.status !== 'recorded' && text(p.reason) && p.reason.trim(), '请填写未记录本轮的作废原因');
      if (s.bpFlow?.mode === 'roll' && round.bpAction) {
        requireValue(round.bpReleaseHistory == null || (s.bpHistory || []).length <= round.bpReleaseHistory, '已有后续 BP，请先撤销后续操作再作废本图');
        if (s.action) s.queue.unshift(s.action);
        s.action = clone(round.bpAction);
      }
      round.status = 'void'; s.currentRoundId = null; s.ex.team = null; s.phase = 'bp'; s.scene = 'mappool';
      s.incident = null;
      return `作废本轮：${p.reason}`;
    }
    case 'ex': {
      requireValue(p.team === null || side(p.team), 'EX 开启方无效');
      requireValue(SIDES.every(t => [0, 1, 2].includes(p.remaining?.[t])), 'EX 剩余次数无效');
      const round = currentRound(s);
      const changingActivation = p.team !== s.ex.team;
      requireValue(!p.team || !changingActivation || (round?.status === 'prepared' && entryOf(s, round.entryId)?.mod !== 'TB'), '仅普通图准备期可以设置 EX，TB 禁 EX');
      requireValue(!p.team || !changingActivation || p.remaining[p.team] > 0, '该队没有 EX 剩余次数');
      s.ex = { team: p.team, remaining: { a: p.remaining.a, b: p.remaining.b } };
      return `EX 剩余次数：${s.match.teams.a.name} ${p.remaining.a}，${s.match.teams.b.name} ${p.remaining.b}；${p.team ? `${s.match.teams[p.team].name} 本图已开启` : '本图未开启'}`;
    }
    case 'display':
      requireValue(SCENES.includes(p.scene) && p.scene !== 'pause', '显示画面无效');
      s.scene = p.scene; s.sceneOverride = { scene: p.scene, until: 'next-match-event' };
      return '手动覆盖播出画面，下一有效比赛事件自动接回；数据跟随继续';
    case 'pause':
      requireValue(['technical', 'tactical'].includes(p.kind), '暂停类型无效');
      if (!s.paused) s.returnScene = s.scene;
      s.paused = true; s.scene = 'pause'; s.pauseType = p.kind;
      return '暂停（保留原阶段和返回位置）';
    case 'resume':
      requireValue(s.returnScene, '没有暂停返回位置');
      s.scene = s.returnScene; s.returnScene = null; s.paused = false; s.sceneOverride = null;
      return '恢复暂停前画面';
    case 'auto':
      requireValue(typeof p.bp === 'boolean' && typeof p.scenes === 'boolean', '自动跟随开关无效');
      requireValue(p.results === undefined || typeof p.results === 'boolean', '自动计胜开关无效');
      // Accept old clients' saved fields for compatibility; every live frame
      // replaces them with tosu's actual sides. The console only sends toggles.
      if (p.profile !== undefined) {
        requireValue(['unverified', 'stable-tourney'].includes(p.profile) && text(p.left, 80) && text(p.right, 80), '房间资料格式无效');
        Object.assign(s.auto, { profile: p.profile, left: p.left, right: p.right });
      }
      s.auto = { ...s.auto, bp: p.bp, scenes: p.scenes, results: p.results ?? s.auto.results };
      requireValue(p.locked !== true, '已移除全局人工接管；人工修正直接生效，需要停住自动流程时请明确暂停');
      return '更新自动跟随设置；房间左右队名直接读取 tosu';
    case 'winner': {
      requireResolved(s);
      requireValue(side(p.team) && seriesOf(s)[p.team] >= targetOf(s), '该队尚未达到系列目标');
      s.winner = p.team; s.phase = 'winner'; s.scene = 'victory'; return '展示人工核对的 Winner';
    }
    case 'next-match': {
      requireValue(p.keepRoomBinding === undefined || typeof p.keepRoomBinding === 'boolean', '房间连接保留选项无效');
      const fresh = newSession();
      if (p.keepRoomBinding) {
        requireValue(s.auto.profile === 'stable-tourney' && s.auto.left && s.auto.right, '尚未收到 tosu 房间队名');
        fresh.auto = clone(s.auto);
      }
      Object.assign(s, domain(fresh));
      return p.keepRoomBinding ? '已清空比赛记录，保留房间连接与自动跟随设置；此前赛果不补记' : '准备下一场（上一场保留在操作记录 / 本机存档）';
    }
    default: throw new Error('未知会话命令');
  }
}

export function transition(state, command) {
  requireValue(command && text(command.id, 100) && command.id && Number.isSafeInteger(command.version), '命令 ID / 版本无效');
  if (state.commandIds.includes(command.id)) return state;
  requireValue(command.version === state.version, '会话已被其他操作更新，请核对最新状态后重试');
  const next = clone(state);
  let message;
  if (command.type === 'undo') {
    const previous = next.undo.pop();
    requireValue(previous, '没有可撤销记录');
    Object.assign(next, previous.state);
    message = `撤销：${previous.message}`;
  } else {
    message = applyCommand(next, command);
    next.undo.push({ state: domain(state), message });
    next.undo = next.undo.slice(-20);
  }
  next.version++;
  next.commandIds.push(command.id); next.commandIds = next.commandIds.slice(-1000);
  next.history.push({ id: command.id, at: new Date().toISOString(), version: next.version, message, source: 'manual',
    bp: (next.bpHistory || []).slice((state.bpHistory || []).length) });
  next.history = next.history.slice(-300);
  return next;
}

export function automaticTransition(state, mutate, message, eventId, { undo = true } = {}) {
  const next = clone(state);
  mutate(next);
  if (undo) { next.undo.push({ state: domain(state), message }); next.undo = next.undo.slice(-20); }
  next.version++;
  next.history.push({ id: eventId, at: new Date().toISOString(), version: next.version, message, source: 'tosu',
    bp: (next.bpHistory || []).slice((state.bpHistory || []).length) });
  next.history = next.history.slice(-300);
  return next;
}
