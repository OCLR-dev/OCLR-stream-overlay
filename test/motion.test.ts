import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldEmphasize, vEmphasize } from '../ui/motion.ts';

const scope = 'match:connected:1';
test('presentation compares semantic values, retaining unknown and real zero', () => {
  assert.equal(shouldEmphasize({ value: [0, null], scope }, { value: [0, null], scope }), false);
  assert.equal(shouldEmphasize({ value: 0, scope }, { value: null, scope }), true);
  assert.equal(shouldEmphasize({ value: ['banned', 'A Ban'], scope }, { value: ['open', '未选'], scope }), true);
  assert.equal(shouldEmphasize({ value: 1, scope }, { value: 2, scope }), true); // Retraction/correction is also a change.
});

test('load/reconnect/new match baselines and hidden scenes never replay history', () => {
  assert.equal(shouldEmphasize({ value: 6, scope: 'match:connected:2' }, { value: 0, scope }), false);
  assert.equal(shouldEmphasize({ value: 6, scope: 'new-match:connected:1' }, { value: 0, scope }), false);
  assert.equal(shouldEmphasize({ value: 6, scope, enabled: false }, { value: 0, scope }), false);
  assert.equal(shouldEmphasize({ value: 6, scope }, { value: 0, scope, enabled: false }), false);
});

test('rapid emphasis replaces the old animation; live totals/no-op values do not restart it', () => {
  const preference = { matches: false, addEventListener(_, handler) { this.change = handler; } };
  globalThis.matchMedia = () => preference;
  const animations = [];
  const element = { animate(frames, options) {
    const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; this.oncancel?.(); } };
    animations.push(animation); return animation;
  } };
  const update = (value, oldValue) => vEmphasize.updated(element, { value, oldValue });
  update({ value: 1, scope }, { value: 0, scope });
  update({ value: 2, scope }, { value: 1, scope });
  assert.equal(animations.length, 2);
  assert.equal(animations[0].cancelled, true);
  update({ value: 2, scope }, { value: 2, scope });
  assert.equal(animations.length, 2);
  // Switching preference mid-emphasis immediately cancels native animations.
  preference.matches = true; preference.change({ matches: true });
  assert.equal(animations[1].cancelled, true);
  update({ value: 3, scope }, { value: 2, scope });
  assert.equal(animations.length, 2);
  preference.matches = false;
  update({ value: 4, scope }, { value: 3, scope });
  update({ value: 6, scope: 'reconnected' }, { value: 4, scope });
  assert.equal(animations[2].cancelled, true);
  assert.equal(animations.length, 3);
  vEmphasize.beforeUnmount(element);
  delete globalThis.matchMedia;
});
