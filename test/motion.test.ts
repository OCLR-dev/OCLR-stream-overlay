import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldEmphasize, vEmphasize, vSceneReveal } from '../ui/motion.ts';

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
  update({ value: ['banned', 'a'], scope, kind: 'confirm' }, { value: ['open', null], scope });
  assert.equal(animations[3].options.duration, 1600);
  assert.equal(animations[3].frames[2].offset, .78);
  assert.equal(animations[3].frames[2].opacity, 1);
  assert.equal(Math.round(animations[3].frames[1].offset * 1600), 220); // Same reveal speed.
  assert.equal(Math.round((1 - animations[3].frames[2].offset) * 1600), 352); // Same fade speed.
  assert.equal(Math.round((animations[3].frames[2].offset - animations[3].frames[1].offset) * 1600), 1028); // Hold +500ms.

  vEmphasize.beforeUnmount(element);
  delete globalThis.matchMedia;
});


test('confirmation ignores used/open states, display-name edits and unchanged diamond fill', () => {
  assert.equal(shouldEmphasize({ value: ['used', 'a'], scope, when: false }, { value: ['picked', 'a'], scope }), false);
  assert.equal(shouldEmphasize({ value: ['banned', 'a'], scope }, { value: ['banned', 'a'], scope }), false);
  assert.equal(shouldEmphasize({ value: true, scope }, { value: true, scope }), false);
  assert.equal(shouldEmphasize({ value: false, scope }, { value: true, scope }), true);
});

test('scene entry targets safe surfaces, cancels on rapid switch and stays silent on reconnect', () => {
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  const animations = [];
  const surface = capture => ({
    classList: { contains: () => false },
    matches: () => false,
    querySelector: () => capture ? {} : null,
    animate(frames, options) {
      const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; this.oncancel?.(); } };
      animations.push(animation); return animation;
    }
  });
  const footer = surface(false), captureAncestor = surface(true);
  const stack = { contains: e => e === footer, querySelector: () => ({ querySelectorAll: () => [footer, captureAncestor] }) };
  const update = (value, oldValue) => vSceneReveal.updated(stack, { value, oldValue });
  update({ value: 'playing', scope }, { value: 'mappool', scope });
  assert.equal(animations.length, 1);
  assert.equal(animations[0].options.duration, 720);
  assert.equal(animations[0].frames[0].opacity, 0);
  update({ value: 'playing', scope }, { value: 'playing', scope }); // Duplicate SSE / score ticks.
  assert.equal(animations.length, 1);
  update({ value: 'waiting', scope }, { value: 'playing', scope });
  assert.equal(animations[0].cancelled, true);
  assert.equal(animations.length, 2);
  update({ value: 'victory', scope: 'reconnected' }, { value: 'waiting', scope });
  assert.equal(animations[1].cancelled, true);
  assert.equal(animations.length, 2);
  update({ value: 'playing', scope, enabled: true }, { value: 'waiting', scope, enabled: false });
  assert.equal(animations.length, 2);
  vSceneReveal.beforeUnmount(stack);
  delete globalThis.matchMedia;
});
