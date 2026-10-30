export interface OriginalMapMetadata {
  beatmapId: number;
  source: 'osu-file';
  stats: { cs: number | null; hp: number | null; ar: number | null; od: number | null; bpm: { min: number | null; max: number | null } };
}
interface LiveMapParameters {
  id: number | null;
  stats?: null | { stars?: { total?: number | null }; cs?: { converted?: number | null }; hp?: { converted?: number | null };
    ar?: { converted?: number | null }; od?: { converted?: number | null }; bpm?: { common?: number | null } };
  time?: { lastObject?: number | null };
}
const numeric = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(Number(value.toFixed(2))) : '—';
const duration = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
  const seconds = Math.floor(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export function mapParameterDisplay(id: number | null, mode: 'tosu' | 'official-test', live: LiveMapParameters | null, original: OriginalMapMetadata | null) {
  const selected = Number.isSafeInteger(id) && id! > 0;
  const map = selected && mode === 'tosu' && live?.id === id ? live : null;
  const base = selected && mode === 'official-test' && original?.beatmapId === id && original.source === 'osu-file' ? original : null;
  const range = base?.stats.bpm;
  const min = numeric(range?.min); const max = numeric(range?.max);
  // Test files provide original settings, never converted values, stars or a
  // guessed duration. Formal output uses only the matched tosu frame.
  return { source: map ? 'tosu' : base ? 'official-test' : 'none', rows: [
    { label: '★', value: numeric(map?.stats?.stars?.total) },
    { label: 'CS', value: numeric(base ? base.stats.cs : map?.stats?.cs?.converted) },
    { label: 'HP', value: numeric(base ? base.stats.hp : map?.stats?.hp?.converted) },
    { label: 'AR', value: numeric(base ? base.stats.ar : map?.stats?.ar?.converted) },
    { label: 'OD', value: numeric(base ? base.stats.od : map?.stats?.od?.converted) },
    { label: 'BPM', value: base ? min === max ? min : min !== '—' && max !== '—' ? `${min}–${max}` : '—' : numeric(map?.stats?.bpm?.common) },
    { label: '时长', value: duration(map?.time?.lastObject) },
  ] };
}
