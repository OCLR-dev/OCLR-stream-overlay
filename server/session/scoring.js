const SIDES = ['left', 'right'];
const validScore = value => Number.isSafeInteger(value) && value >= 0;

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

// Keep source telemetry intact. This projection is shared by result recording
// and every published display snapshot; browsers never apply the multiplier.
export function competitionScore(state, frame) {
  const room = frame?.tourney;
  const rawTotalScore = Object.fromEntries(SIDES.map(side => [side, validScore(room?.totalScore?.[side]) ? room.totalScore[side] : null]));
  const entry = mapEntry(state, frame);
  if (!entry?.mod) return { rule: 'unknown', totalScore: rawTotalScore, rawTotalScore,
    reason: SIDES.some(side => rawTotalScore[side] !== null) ? '图池分组未确认，显示房间原始队分' : null };
  if (entry.mod !== 'FM') return { rule: 'client', totalScore: rawTotalScore, rawTotalScore, reason: null };

  const active = (room?.players || []).filter(player => player.osuId > 0);
  const ids = new Set();
  const players = active.map(player => {
    const ez = easyMod(player.mods);
    // Round each player's half point up before summing; avoid multiplying a
    // near-limit integer by 3 and silently losing precision.
    const adjusted = validScore(player.score) && ez !== null ? player.score + (ez ? Math.round(player.score / 2) : 0) : null;
    const duplicate = ids.has(player.osuId);
    ids.add(player.osuId);
    return { osuId: player.osuId, side: player.side, mods: player.mods ?? null, rawScore: player.score ?? null,
      score: !duplicate && validScore(adjusted) ? adjusted : null };
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

export function scoringLive(state, live) {
  const frame = live.tosu.data;
  if (!frame?.tourney) return live;
  const score = competitionScore(state, frame);
  return { ...live, tosu: { ...live.tosu, data: { ...frame, tourney: { ...frame.tourney, competitionScore: score } } },
    note: [3, 4].includes(frame.tourney.ipcState) && score.reason ? `${live.note}。${score.reason}` : live.note };
}
