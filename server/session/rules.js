const SIDES = ['a', 'b'];
const side = value => SIDES.includes(value);
export const seriesOf = s => Object.fromEntries(SIDES.map(team => [team,
  s.rounds.filter(r => r.status === 'recorded' && r.winner === team).length + s.seriesAdjustment[team]]));
export const exhibitionOf = s => s.match.stage === 'exhibition' ? s.match.exhibition : null;
export const fixedSeries = s => {
  const series = exhibitionOf(s)?.series;
  return series?.type === 'fixed_maps' ? series : null;
};
export const targetOf = s => {
  const exhibition = exhibitionOf(s);
  if (!exhibition) return s.match.stage === 'final' ? 7 : 6;
  return exhibition.series?.wins ?? exhibition.series?.count ?? 99;
};
const drawnMaps = s => s.rounds.filter(r => r.status === 'recorded' && r.winner === null).length;
const mapsPlayed = (s, score) => score.a + score.b + drawnMaps(s);
export function validSeries(s, score = seriesOf(s)) {
  const fixed = fixedSeries(s);
  const firstTo = exhibitionOf(s)?.series?.type === 'first_to';
  return SIDES.every(team => Number.isSafeInteger(score[team]) && score[team] >= 0 && score[team] <= targetOf(s)) &&
    (!fixed || mapsPlayed(s, score) <= fixed.count) &&
    (!firstTo || !SIDES.every(team => score[team] === targetOf(s)));
}
export function seriesComplete(s) {
  const score = seriesOf(s);
  const fixed = fixedSeries(s);
  if (fixed) return mapsPlayed(s, score) >= fixed.count;
  if (exhibitionOf(s) && !exhibitionOf(s).series) return false;
  return SIDES.some(team => score[team] >= targetOf(s));
}
export function canShowWinner(s, team) {
  if (!side(team) || !seriesComplete(s)) return false;
  const score = seriesOf(s);
  return fixedSeries(s) ? score[team] > score[team === 'a' ? 'b' : 'a'] : score[team] >= targetOf(s);
}
export const canShowDraw = s => fixedSeries(s)?.allowDraw && seriesComplete(s) && seriesOf(s).a === seriesOf(s).b;
export function exhibitionProgress(s) {
  if (!exhibitionOf(s)) return null;
  return { limit: targetOf(s), played: mapsPlayed(s, seriesOf(s)), complete: seriesComplete(s),
    winner: SIDES.find(team => canShowWinner(s, team)) ?? null, draw: !!canShowDraw(s) };
}

const other = team => team === 'a' ? 'b' : 'a';
const pair = (first, ordinal) => [{ kind: 'pick', team: first, ordinal }, { kind: 'pick', team: other(first), ordinal }];
const regular = {
  type: 'oclr', version: 1, ex: true,
  resultEligible: (s, facts) => facts.complete && facts.counts.left > 0 && facts.counts.right > 0,
  rollReady: roll => side(roll.banFirst) && side(roll.pickFirst),
  opening: ({ banFirst, pickFirst }) => [
    { kind: 'ban', team: banFirst, slot: 0 }, { kind: 'ban', team: other(banFirst), slot: 0 },
    { kind: 'pick', team: pickFirst, ordinal: 1 }, { kind: 'pick', team: other(pickFirst), ordinal: 1 },
    { kind: 'ban', team: banFirst, slot: 1 }, { kind: 'ban', team: other(banFirst), slot: 1 },
  ],
  phases: ['ban1', 'pick1', 'ban2', 'pick2'],
  fromChoice({ team, kind }) {
    return kind === 'ban' ? this.opening({ banFirst: team, pickFirst: other(team) }) : pair(team, 1);
  },
  phasePlan({ phase, banFirst, pickFirst, pairFirst }) {
    const opening = this.opening({ banFirst, pickFirst });
    return phase === 'ban1' ? opening : phase === 'pick1' ? opening.slice(2)
      : phase === 'ban2' ? opening.slice(4) : pair(pairFirst, 2);
  },
  replenish: pair,
  tbEligible: s => SIDES.every(team => seriesOf(s)[team] === targetOf(s) - 1),
};
const exhibition = {
  type: 'oclr-exhibition', version: 1, ex: false,
  resultEligible: (s, facts) => s.match.exhibition.autoResults && facts.complete &&
    ['left', 'right'].every(side => facts.counts[side] === Number.parseInt(s.match.mode, 10)),
  rollReady: roll => side(roll.pickFirst),
  opening: ({ pickFirst }) => [{ kind: 'pick', team: pickFirst, ordinal: 1 }, { kind: 'pick', team: other(pickFirst), ordinal: 1 }],
  phases: ['pick1', 'pick2'],
  fromChoice({ team, kind, pickFirst }) {
    return kind === 'ban' ? [{ kind: 'ban', team, slot: 0 }, ...pair(pickFirst || other(team), 1)] : pair(team, 1);
  },
  phasePlan: ({ phase, pickFirst, pairFirst }) => pair(phase === 'pick1' ? pickFirst : pairFirst, phase === 'pick1' ? 1 : 2),
  replenish: pair,
  tbEligible: s => !seriesComplete(s) && s.pool.some(entry => entry.mod === 'TB'),
};
// Static assembly: no runtime plugins or tournament rules in transport/storage.
export const rulesOf = s => s.match.stage === 'exhibition' ? exhibition : regular;

export const automaticResultEligible = (state, facts) => rulesOf(state).resultEligible(state, facts);
