import type { PoolEntry } from './session';

// Issue #57 preview. Timings are first-pass values for visual review; every
// duration scales with `slow` so the demo can inspect motion frame by frame.
export const COVER_BAND_COUNT = 8;
export const COVER_TIMING = {
  enterBand: 520,
  enterStagger: 22,
  contentInDelay: 500,
  contentIn: 300,
  leaveFade: 150,
  // Bands start while the content is still fading, so the exit has no
  // empty beat between the card disappearing and the curtain moving.
  leaveBandDelay: 60,
  leaveBand: 460,
  leaveStagger: 22,
  reduced: 200,
} as const;

export const coverEnterTotal = COVER_TIMING.enterBand + (COVER_BAND_COUNT - 1) * COVER_TIMING.enterStagger;
export const coverLeaveTotal = COVER_TIMING.leaveBandDelay + COVER_TIMING.leaveBand + (COVER_BAND_COUNT - 1) * COVER_TIMING.leaveStagger;

// Full-frame cover (OBS scene over the whole 1920×1080 canvas). Bands are
// sheared to the 115° stripe angle of the Winner / Showcase backdrop (25° from
// vertical, `/` shape): 1080px of height shifts each edge by 1080 × tan 25° ≈
// 504px. Eight 311px bands on a 303px pitch overlap by 8px and cover
// x ∈ [0, 1920] at every height; 2440px of travel starts them fully off-frame.
export const COVER_BAND_PITCH = 303;
export const COVER_BAND_WIDTH = 311;
export const COVER_BAND_FIRST = -256;
export const COVER_BAND_TRAVEL = 2440;

export type CoverStage = 'hidden' | 'entering' | 'holding' | 'leaving';
export type ProgressState = 'todo' | 'done' | 'next';

export interface ProgressGroup { mod: string; chips: { entry: PoolEntry; state: ProgressState }[] }

// Consecutive slots of one mod form a group; groups get a wider gap.
export function progressGroups(pool: PoolEntry[], shown: ReadonlySet<string>, nextId: string | null): ProgressGroup[] {
  const groups: ProgressGroup[] = [];
  for (const entry of pool) {
    const state: ProgressState = entry.id === nextId ? 'next' : shown.has(entry.id) ? 'done' : 'todo';
    const last = groups[groups.length - 1];
    if (last && last.mod === entry.mod) last.chips.push({ entry, state });
    else groups.push({ mod: entry.mod, chips: [{ entry, state }] });
  }
  return groups;
}

// Rough rendered width of a title: CJK / full-width glyphs count double.
// Above 40 units the 60px two-line title would clamp, so the card switches
// to a 46px three-line size instead of cutting the name off.
export function titleWeight(title: string) {
  let weight = 0;
  for (const char of title) weight += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(char) ? 2 : 1;
  return weight;
}
