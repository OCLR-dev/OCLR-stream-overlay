// Shared by the browser cutouts and the local OBS scene follower.
/** @param {string} mode @param {string | null} exTeam @param {boolean} tiebreaker
 * @returns {{count: number, ex: boolean, format: 'normal' | 'ex' | 'tb'}} */
export function playingLayout(mode, exTeam, tiebreaker) {
  const ex = !tiebreaker && (exTeam === 'a' || exTeam === 'b');
  return { count: Number.parseInt(mode, 10) - Number(ex), ex, format: tiebreaker ? 'tb' : ex ? 'ex' : 'normal' };
}

/** @param {{currentRoundId: string | null, rounds: {id: string, entryId: string}[], pool: {id: string, mod: string}[]}} session */
export function currentPoolEntry(session) {
  const round = session.rounds.find(item => item.id === session.currentRoundId);
  return round && session.pool.find(entry => entry.id === round.entryId);
}
