// Broadcast team scores group every four digits with a comma (e.g. 105,0000).
export function formatTeamScore(value: number | null | undefined) {
  if (value == null) return '—';
  return String(value).replace(/\B(?=(\d{4})+(?!\d))/g, ',');
}

// Interpolated score-counter frames use the same grouping as the final value.
export function formatCounterScore(value: number) {
  return formatTeamScore(Math.floor(value));
}
