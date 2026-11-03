import test from 'node:test';
import assert from 'node:assert/strict';
import { mapStarDisplay, mapStatColor, mapStatDisplay, starRatingColor } from '../ui/mapStats.ts';
import type { TestMapMetadata } from '../ui/mapParameters.ts';

const base: TestMapMetadata = {
  beatmapId: 1,
  source: 'osu-file',
  title: 'Map',
  titleUnicode: 'Map',
  artist: 'Artist',
  artistUnicode: 'Artist',
  difficulty: 'Insane',
  mapper: 'Mapper',
  length: 120000,
  objects: 500,
  stats: { cs: 4, hp: 5, ar: 8, od: 7, bpm: { min: 180, max: 180 } },
};
const calculation = (mod: string, cs: number, ar: number, od: number) => ({
  mod, stars: 5, cs, hp: 5, ar, od, clockRate: mod === 'DT' ? 1.5 : 1,
  bpm: { min: 180, max: 180 },
});

test('card stats round to one decimal and trim trailing zeros', () => {
  const stats = mapStatDisplay(base, 'NM');
  assert.deepEqual(stats.map(stat => [stat.label, stat.value]), [['CS', '4'], ['AR', '8'], ['OD', '7']]);
  assert.ok(stats.every(stat => typeof stat.color === 'string'));
});

test('HR and DT cards use the mod calculation rather than raw osu stats', () => {
  const hr = { ...base, calculation: calculation('HR', 6, 10, 9.8) };
  assert.deepEqual(mapStatDisplay(hr, 'HR').map(stat => stat.value), ['6', '10', '9.8']);
  const dt = { ...base, calculation: calculation('DT', 4, 9.67, 9.08) };
  assert.deepEqual(mapStatDisplay(dt, 'DT').map(stat => stat.value), ['4', '9.7', '9.1']);
});

test('a missing HR/DT calculation never relabels raw values as modded', () => {
  assert.deepEqual(mapStatDisplay(base, 'HR').map(stat => stat.value), ['—', '—', '—']);
  assert.deepEqual(mapStatDisplay({ ...base, calculation: calculation('NM', 4, 8, 7) }, 'DT').map(stat => stat.value), ['—', '—', '—']);
});

test('FM and TB use the NM baseline and cannot invent unknown values', () => {
  // MapColumns normalizes FM/TB through testModForCategory before this call.
  assert.deepEqual(mapStatDisplay(base, 'NM').map(stat => stat.value), ['4', '8', '7']);
  assert.deepEqual(mapStatDisplay(null, 'NM').map(stat => stat.value), ['—', '—', '—']);
});

test('stat colours hit each palette stop, interpolate in gamma space and clamp outside the range', () => {
  assert.equal(mapStatColor('CS', 2), '#4ffffd');
  assert.equal(mapStatColor('CS', 3), '#7cff4f');
  assert.equal(mapStatColor('CS', 4), '#f6f05c');
  assert.equal(mapStatColor('CS', 4.75), '#ff4e6f');
  assert.equal(mapStatColor('CS', 5.5), '#c645b8');
  assert.equal(mapStatColor('CS', 7), '#6563de');
  assert.equal(mapStatColor('CS', 2.5), '#68ffbf');
  assert.equal(mapStatColor('CS', 0), '#4ffffd');
  assert.equal(mapStatColor('CS', 10), '#6563de');
  assert.equal(mapStatColor('AR', 8.5), '#7cff4f');
  assert.equal(mapStatColor('AR', 11), '#6563de');
  assert.equal(mapStatColor('OD', 9), '#ff4e6f');
  assert.equal(mapStatColor('OD', 11), '#6563de');
  assert.equal(mapStatColor('OD', null), null);
});

test('star colours interpolate in gamma space and use rating-based ink', () => {
  assert.equal(starRatingColor(0.05), '#AAAAAA');
  assert.equal(starRatingColor(0.1), '#4290fb');
  assert.equal(starRatingColor(0.675), '#49aafd');
  assert.equal(starRatingColor(9), '#000000');
  const withStars = (stars: number): TestMapMetadata => ({
    ...base,
    calculation: { ...calculation('NM', 4, 8, 7), stars },
  });
  assert.equal(mapStarDisplay(withStars(3.99), 'NM').ink, '#08050f');
  assert.equal(mapStarDisplay(withStars(4), 'NM').ink, '#ffffff');
  assert.equal(mapStarDisplay(withStars(6.49), 'NM').ink, '#ffffff');
  assert.equal(mapStarDisplay(withStars(6.5), 'NM').ink, '#ffcc22');
  assert.deepEqual(mapStarDisplay(null, 'NM'), { value: '—', color: null, ink: '#ffffff' });
});
