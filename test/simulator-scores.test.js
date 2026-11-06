import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePlayingScores } from '../tools/tosu-simulator/scores.js';

test('both team totals increase as the lead reverses repeatedly, including the eight-second demo', () => {
  for (const tickMs of [100, 250, 1000]) {
    let room = { time: 0, left: 0, right: 0 };
    let previousLead = 0, reversals = 0, demoReversals = 0;
    for (let elapsed = 0; elapsed < 60000; elapsed += tickMs) {
      const next = advancePlayingScores(room, tickMs);
      assert.ok(Number.isSafeInteger(next.left) && next.left > room.left);
      assert.ok(Number.isSafeInteger(next.right) && next.right > room.right);
      const lead = Math.sign(next.left - next.right);
      if (lead && previousLead && lead !== previousLead) {
        reversals++;
        if (next.time <= 8000) demoReversals++;
      }
      if (lead) previousLead = lead;
      room = next;
    }
    assert.ok(reversals >= 12, `${tickMs}ms ticks: lead must alternate throughout a minute`);
    assert.ok(demoReversals >= 2, `${tickMs}ms ticks: both teams must take the lead in a short demo`);
    assert.ok(Math.abs(room.left - room.right) < 113000);
    assert.ok(Math.abs(room.left + room.right - 8100000) < 1200);
  }
});

test('an existing one-sided gap is caught through increasing totals; missing sides remain missing', () => {
  let room = { time: 0, left: 1234567, right: 1100000 };
  let leftLed = false, rightLed = false;
  for (let tick = 0; tick < 200; tick++) {
    const next = advancePlayingScores(room, 100);
    assert.ok(next.left > room.left && next.right > room.right);
    leftLed ||= next.left > next.right;
    rightLed ||= next.right > next.left;
    room = next;
  }
  assert.ok(leftLed && rightLed);
  assert.equal(advancePlayingScores({ time: 1200, left: null, right: 0 }, 100).left, null);
  assert.equal(advancePlayingScores({ time: 1200, left: 0, right: null }, 100).right, null);
});
