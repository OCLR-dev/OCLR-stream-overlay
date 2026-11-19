// Broadcast team scores group every three digits with an apostrophe (e.g.
// 1'050'000), not a comma, so point totals do not read like decimal separators.
export function formatTeamScore(value: number | null | undefined) {
  if (value == null) return '—';
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

// Interpolated score-counter frames use the same grouping as the final value.
export function formatCounterScore(value: number) {
  return formatTeamScore(Math.floor(value));
}
