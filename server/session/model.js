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
    pool: [], arrived: { a: false, b: false }, ready: { a: false, b: false },
    roll: { a: null, b: null, winner: null, pickFirst: null, banFirst: null },
    phase: 'arrival', scene: 'waiting', returnScene: null, locked: false,
    auto: { bp: false, scenes: false, profile: 'unverified', left: '', right: '', mapDebounceMs: 400, rankingDebounceMs: 250 },
    action: null, queue: [], bans: { a: [null, null], b: [null, null] }, bpHistory: [],
    rounds: [], currentRoundId: null, winner: null, seriesAdjustment: { a: 0, b: 0 },
    ex: { team: null, remaining: { a: 2, b: 2 } }, pauseType: 'technical',
    history: [], undo: [], commandIds: [],
  };
}

export const targetOf = s => s.match.stage === 'final' ? 7 : 6;
export const currentRound = s => s.rounds.find(r => r.id === s.currentRoundId) || null;
export const seriesOf = s => Object.fromEntries(SIDES.map(team => [team,
  s.rounds.filter(r => r.status === 'recorded' && r.winner === team).length + (s.seriesAdjustment?.[team] || 0)]));
export const seriesComplete = s => SIDES.some(team => seriesOf(s)[team] >= targetOf(s));
export const entryOf = (s, id) => s.pool.find(e => e.id === id);
const domain = s => Object.fromEntries(Object.entries(s).filter(([key]) => !['version', 'history', 'undo', 'commandIds'].includes(key)));

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
      title: entry.title || '', artist: entry.artist || '', difficulty: entry.difficulty || '' };
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
  requireValue(s.phase === 'bp' && s.scene !== 'pause', '请先进入 BP');
  const round = currentRound(s);
  const replace = !s.action && round?.status === 'prepared';
  requireValue(replace || (s.action && s.action.id === actionId), 'BP 动作已改变，请刷新当前动作');
  if (replace) {
    available(s, entryId, round.id);
    round.entryId = entryId;
    round.source = source;
    round.eventId = eventId;
    recordBp(s, { id: round.actionId, team: round.pickedBy, kind: 'pick' }, entryId, source, eventId, 'replace-pick');
    if (entryOf(s, entryId).mod === 'TB') s.ex.team = null;
    return '替换本轮准备图';
  }
  const action = s.action;
  requireValue(round?.status !== 'prepared', '当前图已准备，请开打或作废本轮后再执行新动作');
  const entry = available(s, entryId);
  if (action.kind === 'ban') {
    requireValue(entry.mod !== 'TB', 'TB 不可 Ban');
    requireValue(s.bans[action.team][action.slot] === null, '该 Ban 槽已有记录，请先修正或撤销');
    requireValue(!['HD', 'HR', 'DT'].includes(entry.mod) || !s.bans[action.team].some(id => entryOf(s, id)?.mod === entry.mod), '同队不能重复 Ban 此 mod（NM/FM 例外）');
    s.bans[action.team][action.slot] = entryId;
  } else {
    const next = { id: randomUUID(), entryId, pickedBy: action.team, status: 'prepared', winner: null,
      source, actionId: action.id, eventId, runId: null, finalScore: null, exTeam: null };
    s.rounds.push(next);
    s.currentRoundId = next.id;
    s.ex.team = null;
  }
  recordBp(s, action, entryId, source, eventId);
  s.action = action.kind === 'ban' ? s.queue.shift() || null : null;
  return `${s.match.teams[action.team].name} ${action.kind === 'ban' ? `Ban ${action.slot + 1}` : 'Pick'} ${entry.label}`;
}

export function startRound(s, source = 'manual') {
  const round = currentRound(s);
  requireValue(round?.status === 'prepared', '尚未准备本轮谱面');
  requireValue(!s.action, '当前还有 BP 动作，完成后再开打');
  requireValue(!seriesComplete(s), '系列已达到目标，请核对 Winner 或人工修正比分');
  round.status = 'playing'; round.runId = randomUUID(); round.startedBy = source; round.exTeam = s.ex.team;
  s.phase = 'playing'; s.scene = 'playing';
}

// Ranking changes the display; this separately awards the round from validated
// totals. Calling it twice cannot award again. Winner display remains an operator action.
export function awardTosuResult(s, roundId, scores) {
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
    case 'setup': {
      requireValue(s.rounds.length === 0 && !SIDES.some(t => s.bans[t].some(Boolean)), '已有 BP/赛果，请先准备下一场，避免覆盖比赛记录');
      requireValue(text(p.title) && ['group', 'elimination', 'final'].includes(p.stage) && ['3v3', '4v4'].includes(p.mode) && ['4x3', '16x9'].includes(p.source), '本场设置无效');
      s.match = { title: p.title, edition: p.edition || null, fixtureId: p.fixtureId || null, poolId: p.poolId || null,
        provenance: ['oclr', 'oclr-archive'].includes(p.provenance) ? p.provenance : 'manual', stage: p.stage, mode: p.mode, source: p.source, teams: normalizeTeams(p.teams) };
      s.pool = normalizePool(p.pool);
      s.action = null; s.queue = []; s.auto.bp = false; s.auto.scenes = false; s.auto.profile = 'unverified';
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
      s.phase = p.enterBp === false ? 'roll' : 'bp'; s.scene = p.enterBp === false ? 'roll' : 'mappool';
      return p.enterBp === false ? '展示真实 Roll 与独立先手' : '记录真实 Roll 与独立先手，进入 BP';
    }
    case 'bp': s.phase = 'bp'; s.scene = 'mappool'; return '进入 BP（保留比赛记录）';
    case 'set-action':
      s.action = p.action === null ? null : normalizeAction(p.action);
      requireValue(Array.isArray(p.queue || []) && (p.queue || []).length <= 40, 'BP 序列过长');
      s.queue = (p.queue || []).map(normalizeAction);
      return '设置明确 BP 动作与后续序列';
    case 'apply-bp': return applyBp(s, p.entryId, 'manual', p.actionId);
    case 'clear-ban':
      requireValue(side(p.team) && [0, 1].includes(p.slot), 'Ban 槽无效');
      requireValue(text(p.reason) && p.reason.trim(), '请填写修正原因');
      s.bans[p.team][p.slot] = null;
      return `修正 Ban：${p.reason}`;
    case 'start': startRound(s); return '手动进入 Playing';
    case 'ranking': {
      const round = currentRound(s);
      requireValue(round && ['playing', 'ranking'].includes(round.status), '没有进行中的轮次');
      round.status = 'ranking'; s.scene = 'map-result';
      if (!s.action) s.action = s.queue.shift() || null;
      return '展示单图结算（不计胜）';
    }
    case 'record-result': {
      const round = s.rounds.find(r => r.id === p.roundId);
      requireValue(round && ['playing', 'ranking'].includes(round.status), '该局未开打、已记录或已作废');
      requireValue(side(p.winner), '请指定本图胜方');
      requireValue(seriesOf(s)[p.winner] < targetOf(s), '该队已达到系列目标，请核对比赛记录');
      round.status = 'recorded'; round.winner = p.winner; round.resultSource = 'manual';
      if (seriesOf(s)[p.winner] >= targetOf(s)) {
        s.winner = p.winner; s.phase = 'winner'; s.scene = 'victory';
      } else if (round.id === s.currentRoundId) {
        s.phase = 'bp'; s.scene = 'mappool';
        if (!s.action) s.action = s.queue.shift() || null;
      }
      return round.id === s.currentRoundId ? '记录本图结果并更新播出画面' : '补记上一局结果，保留当前轮次与画面';
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
      leaveInvalidWinner(s);
      return `人工校正系列分 ${old.a}:${old.b} → ${p.a}:${p.b}：${p.reason}`;
    }
    case 'replay': {
      const round = currentRound(s);
      requireValue(round && !['recorded', 'void'].includes(round.status) && text(p.reason) && p.reason.trim(), '请填写未记录本轮的重赛原因');
      const next = { ...clone(round), id: randomUUID(), status: 'prepared', winner: null, runId: null, finalScore: null };
      round.status = 'void';
      s.rounds.push(next); s.currentRoundId = next.id; s.action = null;
      s.phase = 'bp'; s.scene = 'mappool'; s.ex.team = next.exTeam;
      return `作废并准备独立重赛：${p.reason}`;
    }
    case 'void-round': {
      const round = currentRound(s);
      requireValue(round && round.status !== 'recorded' && text(p.reason) && p.reason.trim(), '请填写未记录本轮的作废原因');
      round.status = 'void'; s.currentRoundId = null; s.ex.team = null; s.phase = 'bp'; s.scene = 'mappool';
      return `作废本轮：${p.reason}`;
    }
    case 'ex': {
      requireValue(p.team === null || side(p.team), 'EX 开启方无效');
      requireValue(SIDES.every(t => [0, 1, 2].includes(p.remaining?.[t])), 'EX 剩余次数无效');
      const round = currentRound(s);
      requireValue(!p.team || (round?.status === 'prepared' && entryOf(s, round.entryId)?.mod !== 'TB'), '仅普通图准备期可以设置 EX，TB 禁 EX');
      requireValue(!p.team || p.remaining[p.team] > 0, '该队没有 EX 剩余次数');
      s.ex = { team: p.team, remaining: { a: p.remaining.a, b: p.remaining.b } };
      return '人工校正 EX 标记与剩余次数（切画面不扣次数）';
    }
    case 'display':
      requireValue(SCENES.includes(p.scene) && p.scene !== 'pause', '显示画面无效');
      s.scene = p.scene; s.locked = true; s.returnScene = null;
      return '手动切画面并锁定自动跟随';
    case 'pause':
      requireValue(['technical', 'tactical'].includes(p.kind), '暂停类型无效');
      if (s.scene !== 'pause') s.returnScene = s.scene;
      s.scene = 'pause'; s.pauseType = p.kind;
      return '暂停（保留原阶段和返回位置）';
    case 'resume':
      requireValue(s.returnScene, '没有暂停返回位置');
      s.scene = s.returnScene; s.returnScene = null;
      return '恢复暂停前画面';
    case 'auto':
      requireValue(typeof p.bp === 'boolean' && typeof p.scenes === 'boolean' && typeof p.locked === 'boolean', '自动跟随开关无效');
      requireValue(['unverified', 'stable-tourney'].includes(p.profile) && text(p.left, 80) && text(p.right, 80), '房间绑定格式无效');
      requireValue(!(p.bp || p.scenes) || (p.profile === 'stable-tourney' && p.left.trim() && p.right.trim() && p.left !== p.right), '启用前请明确 stable/osu!tourney 并填写实际房间双方名称');
      s.auto = { ...s.auto, bp: p.bp, scenes: p.scenes, profile: p.profile, left: p.left.trim(), right: p.right.trim() };
      s.locked = p.locked;
      return '更新自动跟随与房间绑定（重新建立基线）';
    case 'winner': {
      requireValue(side(p.team) && seriesOf(s)[p.team] >= targetOf(s), '该队尚未达到系列目标');
      s.winner = p.team; s.phase = 'winner'; s.scene = 'victory'; return '展示人工核对的 Winner';
    }
    case 'next-match': {
      const fresh = newSession();
      Object.assign(s, domain(fresh));
      return '准备下一场（上一场保留在操作记录 / 本机存档）';
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

export function automaticTransition(state, mutate, message, eventId) {
  const next = clone(state);
  mutate(next);
  next.undo.push({ state: domain(state), message }); next.undo = next.undo.slice(-20);
  next.version++;
  next.history.push({ id: eventId, at: new Date().toISOString(), version: next.version, message, source: 'tosu',
    bp: (next.bpHistory || []).slice((state.bpHistory || []).length) });
  next.history = next.history.slice(-300);
  return next;
}
