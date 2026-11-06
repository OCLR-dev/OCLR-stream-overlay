// Bounded scoring rates keep both cumulative totals increasing while the
// lead swings at two different cadences. Units are points per real second,
// independent of the simulator tick interval. This never chooses a result.
const baseRate = 67500;
const pressure = seconds => 85000 * Math.sin(seconds * 2 * Math.PI / 6.8) +
  27000 * Math.sin(seconds * 2 * Math.PI / 3.7);

export function advancePlayingScores(room, tickMs) {
  const time = room.time + tickMs;
  const common = baseRate * tickMs / 1000;
  // Ease an existing manual gap back into the contest through faster scoring
  // on the trailing side, never by reducing either cumulative total.
  const correction = room.left === null || room.right === null ? 0 :
    (pressure(time / 1000) - (room.left - room.right)) * (1 - Math.exp(-tickMs / 550)) / 2;
  const swing = Math.max(-common * .85, Math.min(common * .85, correction));
  return {
    time,
    left: room.left === null ? null : room.left + Math.round(common + swing),
    right: room.right === null ? null : room.right + Math.round(common - swing),
  };
}
