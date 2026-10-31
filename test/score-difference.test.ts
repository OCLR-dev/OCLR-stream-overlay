import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreDifference } from '../ui/scoreDifference.ts';

test('lead fill grows with the actual difference and mirrors sides without moving its centre', () => {
  const small = scoreDifference('1,050,000', '1,000,000');
  const larger = scoreDifference('1,100,000', '1,000,000');
  const reversed = scoreDifference('1,000,000', '1,100,000');
  assert.equal(small.delta, 50000);
  assert.ok(small.scale < 0 && larger.scale < small.scale);
  assert.equal(reversed.scale, -larger.scale);
  assert.equal(reversed.delta, -larger.delta!);
  assert.deepEqual(scoreDifference('0', '0'), { delta: 0, scale: 0 });
  assert.equal(scoreDifference('10,000,000', '1').scale, -1);
  assert.equal(scoreDifference('0', '10,000,000').scale, 1);
});

test('absolute score differences use equal pixel increments even as both team totals grow', () => {
  const early = scoreDifference('43,000', '40,000');
  const later = scoreDifference('430,000', '400,000');
  assert.ok(Math.abs(later.scale - early.scale * 10) < 1e-12, 'same relative lead must still grow with the point difference');
  assert.equal(scoreDifference('1,021,500', '1,000,000').scale, scoreDifference('21,500', '0').scale);
  const steps = [21500, 22000, 22500].map(delta => scoreDifference(String(1_000_000 + delta), '1,000,000').scale);
  assert.ok(Math.abs((steps[1]! - steps[0]!) - (steps[2]! - steps[1]!)) < 1e-12);
  assert.equal(scoreDifference('1,250,000', '1,000,000').scale, -1);
  assert.equal(scoreDifference('1,000,000', '1,250,000').scale, 1);
});

test('unknown totals clear the fill and stay distinct from a real zero', () => {
  for (const value of ['—', '', ' ', '-1', 'NaN', 'Infinity']) {
    assert.deepEqual(scoreDifference(value, '100'), { delta: null, scale: 0 });
    assert.deepEqual(scoreDifference('100', value), { delta: null, scale: 0 });
  }
  const zero = scoreDifference('0', '100');
  assert.equal(zero.delta, -100);
  assert.ok(zero.scale > 0 && zero.scale < 1);
});
