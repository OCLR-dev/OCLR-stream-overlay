import type { TestMapMetadata } from './mapParameters';

export type MapStatLabel = 'CS' | 'AR' | 'OD';

export interface MapStat {
  label: MapStatLabel;
  value: string;
  color: string | null;
  ink: string;
}

// The first three anchors are the range minimum, middle and maximum; the
// midpoints between them use the green/orange palette stops. One extra maximum
// is appended so unusually high values still have a colour.
const anchors: Record<MapStatLabel, readonly [number, number, number]> = {
  CS: [2, 4, 5.5],
  AR: [8, 9, 10],
  OD: [6, 8, 10],
};
const palette = ['#4ffffd', '#7cff4f', '#f6f05c', '#ff4e6f', '#c645b8', '#6563de'] as const;
const fallback = '#d8d2e8';

type Rgb = readonly [number, number, number];
interface ColorInterpolatorOptions {
  values: readonly number[];
  colors: readonly string[];
  minBound?: number;
  maxBound?: number;
  minColor?: string;
  maxColor?: string;
  gamma?: number;
}
const hex2rgbArray = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];
const toHex = (rgb: Rgb) => `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`;

function createColorInterpolator(options: ColorInterpolatorOptions) {
  const { values, colors, minBound, maxBound, minColor = '#000000', maxColor = '#000000', gamma = 2.2 } = options;
  if (!values.length || values.length !== colors.length) throw new Error('values 和 colors 数组长度必须一致且不能为空。');
  const stops = values
    .map((value, index) => ({ value, rgb: hex2rgbArray(colors[index]!) }))
    .sort((a, b) => a.value - b.value);

  return (input: number) => {
    if (minBound !== undefined && input < minBound) return minColor;
    if (maxBound !== undefined && input >= maxBound) return maxColor;
    if (input <= stops[0]!.value) return toHex(stops[0]!.rgb);
    if (input >= stops[stops.length - 1]!.value) return toHex(stops[stops.length - 1]!.rgb);

    let index = stops.findIndex(stop => input < stop.value);
    if (index === -1) index = stops.length - 1;
    const bottom = stops[index - 1]!;
    const top = stops[index]!;
    const ratio = (input - bottom.value) / (top.value - bottom.value);
    const interpolate = (from: number, to: number) => Math.round(Math.pow(
      (1 - ratio) * Math.pow(from, gamma) + ratio * Math.pow(to, gamma),
      1 / gamma,
    )).toString(16).padStart(2, '0');
    const [r0, g0, b0] = bottom.rgb;
    const [r1, g1, b1] = top.rgb;
    return `#${interpolate(r0, r1)}${interpolate(g0, g1)}${interpolate(b0, b1)}`;
  };
}

const statColor = {
  CS: createColorInterpolator({ values: [2, 3, 4, 4.75, 5.5, 7], colors: palette, minBound: 2, maxBound: 7, minColor: palette[0], maxColor: palette[5] }),
  AR: createColorInterpolator({ values: [8, 8.5, 9, 9.5, 10, 11], colors: palette, minBound: 8, maxBound: 11, minColor: palette[0], maxColor: palette[5] }),
  OD: createColorInterpolator({ values: [6, 7, 8, 9, 10, 11], colors: palette, minBound: 6, maxBound: 11, minColor: palette[0], maxColor: palette[5] }),
};

export function mapStatColor(label: MapStatLabel, value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return statColor[label](value);
}

const fixed = (value: number | null | undefined, digits: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(Number(value.toFixed(digits))) : '—';

/**
 * Card stats follow the same rule as the Playing panel: use the server's
 * mod-specific calculation whenever the pool category has a uniform mod.
 * Falling back to raw values is only safe for NM/HD, whose CS/AR/OD do not move.
 */
export function mapStatDisplay(metadata: TestMapMetadata | null | undefined, mod: string | null): MapStat[] {
  const normalized = mod || 'NM';
  const calculated = metadata?.calculation?.mod === normalized ? metadata.calculation : null;
  const stats = calculated ?? (normalized === 'NM' || normalized === 'HD' ? metadata?.stats : null);
  return (['CS', 'AR', 'OD'] as const).map(label => {
    const key = label.toLowerCase() as 'cs' | 'ar' | 'od';
    const raw = stats?.[key];
    return {
      label,
      value: fixed(raw, 1),
      color: typeof raw === 'number' ? mapStatColor(label, raw) : fallback,
      ink: typeof raw === 'number' && raw <= anchors[label][1] ? '#08050f' : '#ffffff',
    };
  });
}

const starValues = [0.1, 1.25, 2, 2.5, 3.3, 4.2, 4.9, 5.8, 6.7, 7.7, 9] as const;
const starColors = [
  '#4290fb', '#4fc0ff', '#4ffffd', '#7cff4f', '#f6f05c', '#ff6868',
  '#ff4e6f', '#c645b8', '#6563de', '#18158e', '#000000',
] as const;
const starColor = createColorInterpolator({
  values: starValues,
  colors: starColors,
  minBound: 0.1,
  maxBound: 9,
  minColor: '#AAAAAA',
  maxColor: '#000000',
});

export interface MapStar {
  value: string;
  color: string | null;
  ink: string;
}

export function starRatingColor(stars: number | null | undefined): string | null {
  if (typeof stars !== 'number' || !Number.isFinite(stars)) return null;
  return starColor(stars);
}

const starInk = (stars: number) => stars < 4 ? '#08050f' : stars < 6.5 ? '#ffffff' : '#ffcc22';

// The Playing card and the pool cards share this conversion so the star block
// background and text colour always come from the same middleware stops.
export function starRatingDisplay(stars: number | null | undefined): MapStar {
  if (typeof stars !== 'number' || !Number.isFinite(stars) || stars < 0) {
    return { value: '—', color: null, ink: '#ffffff' };
  }
  return { value: fixed(stars, 2), color: starRatingColor(stars), ink: starInk(stars) };
}

export function mapStarDisplay(metadata: TestMapMetadata | null | undefined, mod: string | null): MapStar {
  const normalized = mod || 'NM';
  const calculated = metadata?.calculation?.mod === normalized ? metadata.calculation : null;
  return starRatingDisplay(calculated?.stars);
}
