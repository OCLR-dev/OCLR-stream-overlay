import test from 'node:test';
import assert from 'node:assert/strict';
import { mapParameterDisplay, testModForCategory } from '../ui/mapParameters.ts';

const live = { id: 101, stats: { stars: { total: 6.2 }, cs: { converted: 5.2 }, hp: { converted: 7 },
  ar: { converted: 10.3 }, od: { converted: 9.7 }, bpm: { common: 210.5 } }, time: { lastObject: 245000 } };
const original = { beatmapId: 101, source: 'osu-file' as const, stats: { cs: 4, hp: 5, ar: 9, od: 8, bpm: { min: 180, max: 180 } } };
const calculated = { ...original, calculation: { mod: 'HR', stars: 6.85, cs: 5.2, hp: 7, ar: 10, od: 10, clockRate: 1, bpm: { min: 180, max: 180 } } };
const values = (display: ReturnType<typeof mapParameterDisplay>) => Object.fromEntries(display.rows.map(row => [row.label, row.value]));

test('formal parameter display uses only matched tosu values, including HP and converted attributes', () => {
  const display = mapParameterDisplay(101, 'tosu', live, calculated, 'HR');
  assert.equal(display.source, 'tosu');
  assert.deepEqual(values(display), { '★': '6.2', CS: '5.2', HP: '7', AR: '10.3', OD: '9.7', BPM: '210.5', TIME: '4:05' });
  assert.ok(mapParameterDisplay(101, 'tosu', null, calculated, 'HR').rows.every(row => row.value === '—'), 'test calculations never become a formal fallback');
});

test('simulation shows calculated HR stars and parameters, not NM or synthetic tosu values', () => {
  const display = mapParameterDisplay(101, 'official-test', live, calculated, 'HR');
  assert.equal(display.source, 'official-test');
  assert.deepEqual(values(display), { '★': '6.85', CS: '5.2', HP: '7', AR: '10', OD: '10', BPM: '180', TIME: '4:05' });
  for (const metadata of [null, original]) assert.ok(mapParameterDisplay(101, 'official-test', live, metadata, 'HR').rows.every(row => row.value === '—'));
});

test('old or wrong-map metadata cannot remain on the next map in either parameter mode', () => {
  for (const mode of ['tosu', 'official-test'] as const) {
    for (const id of [102, null, 0]) {
      const display = mapParameterDisplay(id, mode, live, calculated, 'HR');
      assert.equal(display.source, 'none'); assert.ok(display.rows.every(row => row.value === '—'));
    }
  }
});

test('partial current tosu data preserves zero without filling missing converted values from original settings', () => {
  const display = mapParameterDisplay(101, 'tosu', { id: 101, stats: { cs: { converted: 0 }, hp: { converted: null }, ar: { converted: NaN } }, time: { lastObject: 0 } }, calculated, 'HR');
  assert.deepEqual(values(display), { '★': '—', CS: '0', HP: '—', AR: '—', OD: '—', BPM: '—', TIME: '0:00' });
});

test('calculated BPM range is displayed and a mod change cannot retain old HR values', () => {
  const display = mapParameterDisplay(101, 'official-test', null, { ...calculated, calculation: { ...calculated.calculation, mod: 'DT', bpm: { min: 180, max: 360 } } }, 'DT');
  assert.equal(values(display).BPM, '180–360');
  assert.ok(mapParameterDisplay(101, 'official-test', live, calculated, 'DT').rows.every(row => row.value === '—'));
});

test('free mod and tiebreaker test data explicitly use an NM baseline without guessing a free-mod combination', () => {
  for (const mod of ['FM', 'TB']) {
    assert.equal(testModForCategory(mod), 'NM');
    const display = mapParameterDisplay(101, 'official-test', null, { ...calculated, calculation: { ...calculated.calculation, mod: 'NM' } }, mod);
    assert.equal(display.mod, 'NM');
  }
});

test('ready-room fixed-mod preview replaces root NM stats and returns to actual client stats on play', async () => {
  const { mapParameterMode } = await import('../ui/mapParameters.ts');
  for (const ipc of [1, 2]) {
    const mode = mapParameterMode(false, ipc, 'HR');
    assert.equal(mode, 'official-preview');
    const display = mapParameterDisplay(101, mode, live, calculated, 'HR');
    assert.equal(display.source, 'official-preview');
    assert.equal(display.stars, 6.85);
    assert.equal(values(display).AR, '10');
    assert.ok(mapParameterDisplay(101, mode, live, null, 'HR').rows.every(row => row.value === '—'));
    assert.ok(mapParameterDisplay(102, mode, live, calculated, 'HR').rows.every(row => row.value === '—'));
    for (const category of ['FM', 'TB', '', null]) assert.equal(mapParameterMode(false, ipc, category), 'tosu');
  }
  for (const ipc of [3, 4, null]) {
    const mode = mapParameterMode(false, ipc, 'HR');
    assert.equal(mode, 'tosu');
    assert.equal(values(mapParameterDisplay(101, mode, live, calculated, 'HR')).AR, '10.3');
  }
  assert.equal(mapParameterMode(true, 1, 'FM'), 'official-test');
  const dt = { ...calculated, calculation: { ...calculated.calculation, mod: 'DT', clockRate: 1.5 } };
  assert.equal(values(mapParameterDisplay(101, 'official-preview', live, dt, 'DT')).TIME, '2:43');
  assert.ok(mapParameterDisplay(101, 'official-preview', live, calculated, 'DT').rows.every(row => row.value === '—'));
  assert.ok(mapParameterDisplay(101, 'official-preview', live, { ...calculated, calculation: { ...calculated.calculation, mod: 'NM' } }, 'FM').rows.every(row => row.value === '—'));
});
