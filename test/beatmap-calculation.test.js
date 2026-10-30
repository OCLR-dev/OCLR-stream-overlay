import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBeatmap } from '../server/beatmap-calculation.js';
import { createBeatmapMetadataResolver } from '../server/beatmap-metadata.js';
import { calculationFixture } from './calculation-fixture.js';

test('stable HR calculation includes stars and actual adjusted CS/HP/AR/OD', async () => {
  const body = calculationFixture();
  const nm = await calculateBeatmap(body, 'NM');
  const hr = await calculateBeatmap(body, 'HR');
  assert.ok(nm.stars > 0); assert.ok(hr.stars > nm.stars);
  assert.ok(Math.abs(hr.cs - 5.2) < .001); assert.equal(hr.hp, 7);
  assert.equal(hr.ar, 10); assert.equal(hr.od, 10); assert.equal(hr.clockRate, 1);
  assert.equal(hr.engine, 'rosu-pp-js@4.0.1'); assert.equal(hr.ruleset, 'stable');
});

test('DT calculation changes stars and clock-adjusted AR/OD while preserving CS/HP', async () => {
  const body = calculationFixture();
  const nm = await calculateBeatmap(body, 'NM'); const dt = await calculateBeatmap(body, 'DT');
  assert.ok(dt.stars > nm.stars); assert.equal(dt.clockRate, 1.5);
  assert.ok(Math.abs(dt.ar - 10.33333333) < .001); assert.ok(dt.od > 10);
  assert.equal(dt.cs, 4); assert.equal(dt.hp, 5);
});

test('calculation cache distinguishes mods, reuses the official file and invalidates when file contents change', async () => {
  let calls = 0; let time = Date.now(); let body = calculationFixture();
  const resolve = createBeatmapMetadataResolver(async () => { calls++; return new Response(body); }, { gapMs: 0, now: () => time });
  const [one, two] = await Promise.all([resolve(101, 'HR'), resolve(101, 'HR')]);
  assert.deepEqual(one.calculation, two.calculation); assert.equal(calls, 1);
  const dt = await resolve(101, 'DT'); assert.equal(calls, 1); assert.equal(dt.calculation.bpm.min, 180);
  assert.notEqual(dt.calculation.stars, one.calculation.stars);
  body = body.replace('CircleSize:4', 'CircleSize:5'); time += 86400001;
  const updated = await resolve(101, 'HR'); assert.equal(calls, 2); assert.ok(Math.abs(updated.calculation.cs - 6.5) < .001);
});

test('invalid/empty maps fail safely and a subsequent valid calculation still works', async () => {
  await assert.rejects(calculateBeatmap('invalid', 'HR'));
  await assert.rejects(calculateBeatmap(calculationFixture(), 'HRDT'), /INVALID_CALCULATION_MOD/);
  const result = await calculateBeatmap(calculationFixture(), 'HD'); assert.ok(result.stars > 0);
});
