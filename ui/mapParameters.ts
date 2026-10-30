export const testModForCategory = (mod: string | null) => ['NM', 'HD', 'HR', 'DT'].includes(mod || '') ? mod! : 'NM';
export interface TestMapMetadata {
  beatmapId: number;
  source: 'osu-file';
  stats: { cs: number | null; hp: number | null; ar: number | null; od: number | null; bpm: { min: number | null; max: number | null } };
  calculation?: { mod: string; stars: number; cs: number; hp: number; ar: number; od: number; clockRate: number;
    bpm: { min: number | null; max: number | null } };
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

export function mapParameterDisplay(id: number | null, mode: 'tosu' | 'official-test', live: LiveMapParameters | null, metadata: TestMapMetadata | null, category: string | null) {
  const selected = Number.isSafeInteger(id) && id! > 0;
  const map = selected && mode === 'tosu' && live?.id === id ? live : null;
  const calculated = selected && mode === 'official-test' && metadata?.beatmapId === id && metadata.source === 'osu-file' && metadata.calculation?.mod === testModForCategory(category) ? metadata.calculation : null;
  const range = calculated?.bpm;
  const min = numeric(range?.min); const max = numeric(range?.max);
  // Formal output uses only the matched tosu frame. Simulation uses a complete
  // calculation for this map and mod, never NM values relabelled as HR/DT.
  return { source: map ? 'tosu' : calculated ? 'official-test' : 'none', mod: calculated?.mod, rows: [
    { label: '★', value: numeric(calculated ? calculated.stars : map?.stats?.stars?.total) },
    { label: 'CS', value: numeric(calculated ? calculated.cs : map?.stats?.cs?.converted) },
    { label: 'HP', value: numeric(calculated ? calculated.hp : map?.stats?.hp?.converted) },
    { label: 'AR', value: numeric(calculated ? calculated.ar : map?.stats?.ar?.converted) },
    { label: 'OD', value: numeric(calculated ? calculated.od : map?.stats?.od?.converted) },
    { label: 'BPM', value: calculated ? min === max ? min : min !== '—' && max !== '—' ? `${min}–${max}` : '—' : numeric(map?.stats?.bpm?.common) },
    { label: '时长', value: duration(map?.time?.lastObject) },
  ] };
}
