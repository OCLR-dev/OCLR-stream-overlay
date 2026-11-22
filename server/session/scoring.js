import { exPlayerScores, fixedExRound, validScore } from './ex-scoring.js';

const SIDES = ['left', 'right'];

function mapEntry(state, frame) {
  const id = frame?.beatmap?.id;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const round = state.rounds.find(value => value.id === state.currentRoundId);
  const recorded = round?.status !== 'void' && state.pool.find(value => value.id === round?.entryId);
  if (recorded?.beatmapId === id) return recorded;
  const matches = state.pool.filter(value => value.beatmapId === id);
  return matches.length === 1 ? matches[0] : null;
}

function easyMod(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const mods = value.toUpperCase().replace(/[\s+]/g, '');
  if (mods === 'NONE') return false;
  if (!/^(?:NM|NF|EZ|HD|HR|DT|NC|HT|DC|SD|PF|FL|SO|V2|RX|AP|AT|TD)+$/.test(mods)) return null;
  return mods.includes('EZ');
}

function adjustedScore(player, fm) {
  const ez = fm ? easyMod(player.mods) : false;
  if (!validScore(player.score) || ez === null) return null;
  // Round each player's half point up before summing.
  const score = player.score + (ez ? Math.round(player.score / 2) : 0);
  return validScore(score) ? score : null;
}

// Keep source telemetry intact. This projection is shared by result recording
// and every published display snapshot; browsers never apply the multiplier.
export function competitionScore(state, frame, exEvidence) {
  const room = frame?.tourney;
  const rawTotalScore = Object.fromEntries(SIDES.map(side => [side, validScore(room?.totalScore?.[side]) ? room.totalScore[side] : null]));
  const ex = fixedExRound(state);
  if (ex) {
    const fm = ex.entry.mod === 'FM';
    const players = exPlayerScores(state, frame, ex, exEvidence).map(player => ({
      ipcId: player.ipcId, osuId: player.osuId, side: player.side, mods: player.mods ?? null,
      rawScore: player.score, score: adjustedScore(player, fm),
    }));
    const totalScore = Object.fromEntries(SIDES.map(side => {
      const members = players.filter(player => player.side === side);
      const sum = members.reduce((total, player) => total + player.score, 0);
      return [side, members.length === 3 && members.every(player => validScore(player.score)) && validScore(sum) ? sum : null];
    }));
    const missing = SIDES.some(side => totalScore[side] === null);
    const reason = missing ? room?.ipcState === 4
      ? 'EX 六路成绩尚未齐全，等待结算；仍缺失时请按裁判确认的结果记胜。'
      : '等待 EX 上场选手的本图分数，请核对红队 Client 0–2、蓝队 Client 4–6。' : null;
    return { rule: 'ex-slots', fm, entryId: ex.entry.id, totalScore, rawTotalScore, players, reason };
  }
  const entry = mapEntry(state, frame);
  if (!entry?.mod) return { rule: 'unknown', totalScore: rawTotalScore, rawTotalScore,
    reason: SIDES.some(side => rawTotalScore[side] !== null) ? '图池分组未确认，显示房间原始队分' : null };
  if (entry.mod !== 'FM') return { rule: 'client', totalScore: rawTotalScore, rawTotalScore, reason: null };

  const active = (room?.players || []).filter(player => player.osuId > 0);
  const ids = new Set();
  const players = active.map(player => {
    const duplicate = ids.has(player.osuId);
    ids.add(player.osuId);
    return { osuId: player.osuId, side: player.side, mods: player.mods ?? null, rawScore: player.score ?? null,
      score: duplicate ? null : adjustedScore(player, true) };
  }).sort((a, b) => a.osuId - b.osuId);
  const totalScore = Object.fromEntries(SIDES.map(side => {
    const members = players.filter(player => player.side === side);
    const rawSum = members.reduce((sum, player) => sum + player.rawScore, 0);
    const sum = members.reduce((total, player) => total + player.score, 0);
    const complete = members.length > 0 && players.every(player => SIDES.includes(player.side)) &&
      members.every(player => validScore(player.rawScore) && validScore(player.score)) &&
      validScore(rawSum) && rawSum === rawTotalScore[side] && validScore(sum);
    return [side, complete ? sum : null];
  }));
  return { rule: 'fm-ez-v1', entryId: entry.id, totalScore, rawTotalScore, players,
    reason: SIDES.every(side => totalScore[side] !== null) ? null : 'FM 选手分数或 Mods 不完整，暂无法计算 EZ 加成后的队分，请等待数据恢复或人工核对赛果' };
}

export function scoringLive(state, live, exEvidence) {
  const frame = live.tosu.data;
  if (!frame?.tourney) return live;
  const score = competitionScore(state, frame, exEvidence);
  return { ...live, tosu: { ...live.tosu, data: { ...frame, tourney: { ...frame.tourney, competitionScore: score } } },
    note: [3, 4].includes(frame.tourney.ipcState) && score.reason ? `${live.note}。${score.reason}` : live.note };
}
