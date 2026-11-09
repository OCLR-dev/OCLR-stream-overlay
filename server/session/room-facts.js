// Adapt normalized tosu scores without applying tournament policy. Agreement
// is source consistency, not proof that all real players have finished.
export function resultFacts(room) {
  const counts = {};
  const complete = ['left', 'right'].every(side => {
    const players = room.players.filter(player => player.side === side && player.osuId > 0);
    counts[side] = players.length;
    return players.every(player => Number.isSafeInteger(player.score) && player.score >= 0) &&
      players.reduce((sum, player) => sum + player.score, 0) === room.totalScore[side];
  });
  return { complete, counts };
}
