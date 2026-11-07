import test from 'node:test';
import assert from 'node:assert/strict';
import { ScoreCounter, parseCounterScore, formatCounterScore } from '../ui/scoreCounter.ts';

test('scores interpolate through successive display frames and land exactly on the received target', () => {
  const c = new ScoreCounter(); c.update(1000,0,false); c.update(2200,100,true);
  const values: number[] = [];
  for (const now of [116,132,148,164,180,196,212,220]) { c.tick(now); values.push(c.value!); }
  assert.deepEqual(values, [1160,1320,1480,1640,1800,1960,2120,2200]);
  assert.equal(c.tick(300),false); assert.equal(c.value,2200);
});
test('new targets continue from the current display without a jump, old-target queue or reversal', () => {
  const c = new ScoreCounter(); c.update(0,0,false); c.update(1200,0,true); c.tick(60);
  assert.equal(c.value,600); c.update(2400,60,true); assert.equal(c.value,600);
  c.tick(120); assert.equal(c.value,1500); c.update(2400,120,true);
  c.tick(180); assert.equal(c.value,2400, 'duplicate snapshots do not restart the interpolation');
});
test('Ranking, reduced motion, new context, corrections, unknown and resets snap immediately', () => {
  for (const final of [0,500,2400,null]) {
    const c=new ScoreCounter();c.update(1000,0,false);c.update(2000,0,true);c.tick(16);
    c.update(final,20,false);c.tick(500);assert.equal(c.value,final);
  }
  const c=new ScoreCounter(); c.update(1000,0,false);c.update(2200,0,true);c.tick(20);
  c.update(1800,30,true); assert.equal(c.value,1800,'any downward target correction is exact, even if above the interpolated value');
  c.update(null,40,true);c.update(3000,50,true);assert.equal(c.value,3000,'rejoining unknown is a silent baseline');
});
test('preserves exact zero, unknown, safe integers and each branch grouping convention', () => {
  assert.equal(parseCounterScore('0'),0);assert.equal(parseCounterScore('105,0000'),1050000);
  for(const text of ['—','-1','NaN','1.5','9007199254740992'])assert.equal(parseCounterScore(text),null);
  assert.equal(formatCounterScore(1050123.8,'105,9999'),'105,0123');
  assert.equal(formatCounterScore(1050123.8,'1,059,999'),'1,050,123');
  assert.equal(formatCounterScore(9999,'1,0000'),'9999');
});
