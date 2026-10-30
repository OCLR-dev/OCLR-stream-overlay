import test from 'node:test';
import assert from 'node:assert/strict';
import { mapParameterDisplay } from '../ui/mapParameters.ts';

const live = { id: 101, stats: { stars: { total: 6.2 }, cs: { converted: 5.2 }, hp: { converted: 7 },
  ar: { converted: 10.3 }, od: { converted: 9.7 }, bpm: { common: 210.5 } }, time: { lastObject: 245000 } };
const original = { beatmapId: 101, source: 'osu-file' as const, stats: { cs: 4, hp: 5, ar: 9, od: 8, bpm: { min: 180, max: 180 } } };
const values = (display: ReturnType<typeof mapParameterDisplay>) => Object.fromEntries(display.rows.map(row => [row.label, row.value]));

test('formal parameter display uses only matched tosu values, including HP and converted attributes', () => {
  const display = mapParameterDisplay(101, 'tosu', live, original);
  assert.equal(display.source, 'tosu');
  assert.deepEqual(values(display), { '★': '6.2', CS: '5.2', HP: '7', AR: '10.3', OD: '9.7', BPM: '210.5', 时长: '4:05' });
  assert.ok(mapParameterDisplay(101, 'tosu', null, original).rows.every(row => row.value === '—'), 'official files never become a formal fallback');
});

test('simulation reads verified original settings and never presents synthetic tosu values as actual map parameters', () => {
  const display = mapParameterDisplay(101, 'official-test', live, original);
  assert.equal(display.source, 'official-test');
  assert.deepEqual(values(display), { '★': '—', CS: '4', HP: '5', AR: '9', OD: '8', BPM: '180', 时长: '—' });
  assert.ok(mapParameterDisplay(101, 'official-test', live, null).rows.every(row => row.value === '—'));
});

test('old or wrong-map metadata cannot remain on the next map in either parameter mode', () => {
  for (const mode of ['tosu', 'official-test'] as const) {
    for (const id of [102, null, 0]) {
      const display = mapParameterDisplay(id, mode, live, original);
      assert.equal(display.source, 'none'); assert.ok(display.rows.every(row => row.value === '—'));
    }
  }
});

test('partial current tosu data preserves zero without filling missing converted values from original settings', () => {
  const display = mapParameterDisplay(101, 'tosu', { id: 101, stats: { cs: { converted: 0 }, hp: { converted: null }, ar: { converted: NaN } }, time: { lastObject: 0 } }, original);
  assert.deepEqual(values(display), { '★': '—', CS: '0', HP: '—', AR: '—', OD: '—', BPM: '—', 时长: '0:00' });
});

test('test-file BPM changes are shown as a range rather than an invented common BPM', () => {
  const display = mapParameterDisplay(101, 'official-test', null, { ...original, stats: { ...original.stats, bpm: { min: 120, max: 240 } } });
  assert.equal(values(display).BPM, '120–240');
});
