import type { BeatmapRange, BeatmapRanges } from './session';

export const testModForCategory = (mod: string | null) => mod === 'CA' ? null : ['NM', 'HD', 'HR', 'DT'].includes(mod || '') ? mod! : 'NM';
export interface TestMapMetadata {
  beatmapId: number;
  source: 'osu-file';
  title: string;
  titleUnicode: string;
  artist: string;
  artistUnicode: string;
  difficulty: string;
  mapper: string;
  length: number | null;
  objects: number;
  stats: { cs: number | null; hp: number | null; ar: number | null; od: number | null; bpm: { min: number | null; max: number | null } };
  calculation?: { mod: string; stars: number; cs: number; hp: number; ar: number; od: number; clockRate: number;
    bpm: { min: number | null; max: number | null } };
}
interface LiveMapParameters {
  id: number | null;
  stats?: null | { stars?: { total?: number | null }; cs?: { converted?: number | null }; hp?: { converted?: number | null };
    ar?: { converted?: number | null }; od?: { converted?: number | null }; bpm?: { common?: number | null }; ranges?: BeatmapRanges; clockRate?: number | null };
  time?: { lastObject?: number | null };
}
const numeric = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(Number(value.toFixed(2))) : '—';
const numericRange = (range: BeatmapRange | undefined) => {
  if (!range || range.max < range.min) return '—';
  const min = numeric(range.min); const max = numeric(range.max);
  return min === '—' || max === '—' ? '—' : min === max ? min : `${min}–${max}`;
};
const duration = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
  const seconds = Math.floor(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
const playbackDuration = (time: number | null | undefined, rate: number | null | undefined, range?: BeatmapRange) => {
  if (time === 0) return '0:00';
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) return '—';
  if (range) {
    if (!(range.min > 0) || range.max < range.min || !Number.isFinite(range.max)) return '—';
    const min = duration(time / range.max); const max = duration(time / range.min);
    return min === max ? min : `${min}–${max}`;
  }
  // Old snapshots without a rate field keep their existing NM timing contract.
  const speed = rate === undefined ? 1 : rate;
  return typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? duration(time / speed) : '—';
};

export function mapParameterDisplay(id: number | null, mode: 'tosu' | 'official-test', live: LiveMapParameters | null, metadata: TestMapMetadata | null, category: string | null) {
  const selected = Number.isSafeInteger(id) && id! > 0;
  const map = selected && mode === 'tosu' && live?.id === id ? live : null;
  const timing = selected && live?.id === id ? live.time?.lastObject : null;
  const clientRanges = category === 'FM' ? map?.stats?.ranges : null;
  const actual = (key: keyof BeatmapRanges, value: number | null | undefined) => clientRanges ? numericRange(clientRanges[key]) : numeric(value);
  const calculated = selected && mode === 'official-test' && metadata?.beatmapId === id && metadata.source === 'osu-file' && metadata.calculation?.mod === testModForCategory(category) ? metadata.calculation : null;
  const range = calculated?.bpm;
  const min = numeric(range?.min); const max = numeric(range?.max);
  // Formal output uses only the matched tosu frame. Simulation uses a complete
  // calculation for this map and mod, never NM values relabelled as HR/DT.
  return { source: map ? 'tosu' : calculated ? 'official-test' : 'none', mod: calculated?.mod, rangeMode: !!clientRanges, rows: [
    { label: '★', value: calculated ? numeric(calculated.stars) : actual('stars', map?.stats?.stars?.total) },
    { label: 'CS', value: calculated ? numeric(calculated.cs) : actual('cs', map?.stats?.cs?.converted) },
    { label: 'HP', value: calculated ? numeric(calculated.hp) : actual('hp', map?.stats?.hp?.converted) },
    { label: 'AR', value: calculated ? numeric(calculated.ar) : actual('ar', map?.stats?.ar?.converted) },
    { label: 'OD', value: calculated ? numeric(calculated.od) : actual('od', map?.stats?.od?.converted) },
    { label: 'BPM', value: calculated ? min === max ? min : min !== '—' && max !== '—' ? `${min}–${max}` : '—' : actual('bpm', map?.stats?.bpm?.common) },
    { label: 'TIME', value: calculated ? playbackDuration(timing, calculated.clockRate)
      : map ? playbackDuration(timing, map.stats?.clockRate, clientRanges?.clockRate) : '—' },
  ] };
}
