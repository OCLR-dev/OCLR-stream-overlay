import test from 'node:test';
import assert from 'node:assert/strict';
import { newSession, restoreAutomation, transition, SCENES } from '../server/session/model.js';
import { scenes, parseLocation, normalizeScene } from '../ui/model.ts';
test('Ranking has no separate public scene and old result links resolve to Playing', () => {
  assert.equal(SCENES.includes('map-result'), false); assert.equal((scenes as readonly string[]).includes('map-result'), false);
  for (const hash of ['#map-result', '#scene=map-result']) assert.equal(parseLocation('', hash).scene, 'playing');
  assert.equal(parseLocation('?scene=map-result').scene, 'playing'); assert.equal(normalizeScene('map-result'), 'playing');
});
test('saved result scenes, pause return targets and undo snapshots migrate without changing match records', () => {
  const state = newSession(); state.scene = 'map-result'; state.returnScene = 'map-result'; state.sceneOverride = { scene: 'map-result', until: 'next-match-event' };
  const prior = structuredClone(state); prior.undo = []; state.undo = [{ message: '旧场景', state: prior }];
  const original = structuredClone(state); const next = restoreAutomation(state);
  assert.equal(next.scene, 'playing'); assert.equal(next.returnScene, 'playing'); assert.equal(next.sceneOverride.scene, 'playing');
  assert.equal(next.undo[0].state.scene, 'playing'); assert.deepEqual(state, original);
  for (const field of ['id', 'match', 'pool', 'rounds', 'bpHistory', 'bans', 'seriesAdjustment', 'ex']) assert.deepEqual(next[field], state[field]);
});
test('old display commands still work through the Playing alias without recording a result', () => {
  const state = newSession();
  const next = transition(state, { id: crypto.randomUUID(), version: state.version, type: 'display', payload: { scene: 'map-result' } });
  assert.equal(next.scene, 'playing'); assert.equal(next.sceneOverride.scene, 'playing'); assert.deepEqual(next.rounds, []);
});
