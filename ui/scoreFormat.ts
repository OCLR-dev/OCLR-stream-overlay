// Broadcast scores read more compactly in four-digit groups (e.g. 105,0000)
// instead of the usual three-digit thousands separators.
export function formatTeamScore(value: number | null | undefined) {
  if (value == null) return '—';
  return String(value).replace(/\B(?=(\d{4})+(?!\d))/g, ',');
}
