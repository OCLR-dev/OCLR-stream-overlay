import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../server/session/store.js';
import { newCustomSession, seriesOf } from '../server/session/model.js';

function harness() {
  const state = newCustomSession();
  Object.assign(state.auto, { profile: 'stable-tourney', left: '测试红', right: '测试蓝' });
  const store = new SessionStore({ state }); let now = 1000;
  const frame = (ipc = 3, patch = {}) => store.frame({ beatmap: { id: 2635981 }, tourney: {
    ipcState: ipc, teams: { left: '测试红', right: '测试蓝' }, totalScore: { left: 100, right: 90 }, players: [], ...patch,
  } }, now += 500);
  const cmd = (type, payload) => store.command({ id: crypto.randomUUID(), version: store.state.version, type, payload });
  return { store, frame, cmd };
}

test('default automation joins Playing with no pool, BP rule, BO, roster or round; Ranking never backfills a win', async () => {
  const { store, frame } = harness();
  await frame();
  assert.equal(store.state.scene, 'playing'); assert.equal(store.state.phase, 'arrival');
  assert.deepEqual(store.state.pool, []); assert.deepEqual(store.state.rounds, []);
  assert.equal(store.state.currentRoundId, null); assert.equal(store.state.action, null);
  for (let i = 0; i < 4; i++) await frame(4);
  assert.deepEqual(seriesOf(store.state), { a: 0, b: 0 }); assert.deepEqual(store.state.rounds, []);
  assert.equal(store.state.auto.results, true);
});

test('manual scene stays during repeated Playing, then yields to a fresh Playing event', async () => {
  const { store, frame, cmd } = harness(); await frame();
  await cmd('display', { scene: 'mappool' }); await frame(); await frame();
  assert.equal(store.state.scene, 'mappool');
  await frame(1); await frame(3);
  assert.equal(store.state.scene, 'playing'); assert.equal(store.state.sceneOverride, null);
  assert.deepEqual(store.state.rounds, []);
});

test('scene opt out, explicit pause, wrong room and series end remain respected', async () => {
  const off = harness(); off.store.state.auto.scenes = false; await off.frame(); assert.equal(off.store.state.scene, 'waiting');
  off.store.state.auto.scenes = true; await off.frame(); assert.equal(off.store.state.scene, 'playing');
  const paused = harness(); await paused.cmd('pause', { kind: 'technical' }); await paused.frame(); assert.equal(paused.store.state.scene, 'pause');
  const wrong = harness(); await wrong.frame(3, { teams: { left: '其他房间', right: '测试蓝' } }); assert.equal(wrong.store.state.scene, 'waiting');
  const ended = harness(); ended.store.state.match.bestOf = 9; ended.store.state.seriesAdjustment.a = 5; await ended.frame(); assert.equal(ended.store.state.scene, 'waiting');
});

test('manual current map joins the single-ban match without inventing earlier Bans and continues alternate Picks', async () => {
  const { store, cmd } = harness();
  store.state.match.bestOf = 9;
  store.state.pool = [1, 2].map(n => ({ id: `nm${n}`, beatmapId: n, mod: 'NM', label: `NM${n}`, title: '', artist: '', difficulty: '' }));
  await cmd('set-bp-preset', { value: 'single-ban-alternate' });
  await cmd('set-roll', { banFirst: 'a', pickFirst: 'a', winner: 'a', a: 80, b: 10 });
  assert.equal(store.state.action.kind, 'ban');
  await cmd('set-series', { a: 2, b: 1, reason: '测试：中途加入时核对比分' });
  await cmd('prepare-round', { entryId: 'nm1', pickedBy: 'b' });
  assert.equal(store.state.rounds.length, 1); assert.equal(store.state.action, null);
  assert.equal(store.state.rounds[0].pickedBy, 'b');
  assert.deepEqual(store.state.bans, { a: [null, null], b: [null, null] });
  await cmd('start'); await cmd('ranking');
  assert.equal(store.state.action.kind, 'pick'); assert.equal(store.state.action.team, 'a');
  assert.deepEqual(seriesOf(store.state), { a: 2, b: 1 });
  assert.equal(store.state.bpHistory.some(h => h.kind === 'ban'), false);
});

test('free map mode can be selected first, records the chosen current Pick and preserves a playing run when correcting marks', async () => {
  const { store, cmd } = harness(); store.state.match.bestOf = 9;
  store.state.pool = [1, 2].map(n => ({ id: `nm${n}`, beatmapId: n, mod: 'NM', label: `NM${n}`, title: '', artist: '', difficulty: '' }));
  await cmd('set-bp-preset', { value: 'single-ban-alternate' });
  await cmd('select-bp-action', { team: 'b', kind: 'pick' });
  assert.deepEqual(store.state.poolChoice, { team: 'b', kind: 'pick' }); assert.deepEqual(store.state.rounds, []);
  await cmd('choose-pool-map', { entryId: 'nm1' });
  assert.equal(store.state.rounds[0].pickedBy, 'b'); assert.deepEqual(store.state.bans, { a: [null, null], b: [null, null] });
  await cmd('start'); const round = structuredClone(store.state.rounds[0]);
  await cmd('select-bp-action', { team: 'a', kind: 'ban' });
  await cmd('choose-pool-map', { entryId: 'nm2' });
  assert.deepEqual(store.state.rounds[0], round); assert.equal(store.state.rounds.length, 1);
  assert.equal(store.state.poolMarks.find(m => m.entryId === 'nm2').status, 'banned');
  assert.equal(store.state.bans.a[0], null); assert.deepEqual(seriesOf(store.state), { a: 0, b: 0 });
});


test('mid-match initialization can retain explicit room settings, archive the match, resume Playing and undo once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-mid-initialize-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { store, frame, cmd } = harness(); store.state.match.bestOf = 9; store.state.auto.wsUrl = 'ws://127.0.0.1:24050/websocket/v2'; store.file = join(dir, 'session.json');
  await cmd('set-series', { a: 2, b: 1, reason: '测试初始化前比分' });
  await frame(); const before = structuredClone(store.state);
  await cmd('next-match', { keepRoomBinding: true });
  assert.notEqual(store.state.id, before.id); assert.deepEqual(store.state.auto, before.auto);
  assert.deepEqual(store.state.pool, []); assert.deepEqual(store.state.rounds, []);
  const archived = JSON.parse(await readFile(join(dir, 'archive', `${before.id}-${before.version}.json`), 'utf8'));
  assert.deepEqual(archived, before);
  await frame(); assert.equal(store.state.scene, 'playing'); assert.equal(store.state.currentRoundId, null);
  await frame(4); await frame(4); assert.deepEqual(seriesOf(store.state), { a: 0, b: 0 });
  await cmd('undo'); assert.equal(store.state.id, before.id); assert.deepEqual(seriesOf(store.state), { a: 2, b: 1 });
  const restored = await SessionStore.open(store.file); assert.equal(restored.state.id, before.id);
});

test('full initialization still clears room binding by default; unverified names cannot be retained', async () => {
  const h = harness(); await h.cmd('next-match'); assert.equal(h.store.state.auto.profile, 'unverified');
  assert.equal(h.store.state.auto.left, ''); assert.equal(h.store.state.auto.right, '');
  await assert.rejects(h.cmd('next-match', { keepRoomBinding: true }), /明确核实/);
});

test('declaring a current map cannot turn a repeated Playing frame into a new presentation event', async () => {
  const { store, frame, cmd } = harness(); store.state.match.bestOf = 9; await frame();
  await cmd('display', { scene: 'mappool' });
  await cmd('setting', { field: 'pool', value: [{ id: 'nm1', beatmapId: 2635981, mod: 'NM', label: 'NM1', title: '', artist: '', difficulty: '' }] });
  await cmd('prepare-round', { entryId: 'nm1', pickedBy: 'b' });
  await frame(); await frame();
  assert.equal(store.state.scene, 'mappool'); assert.equal(store.state.rounds[0].status, 'prepared');
  assert.equal(store.state.rounds[0].runId, null);
});
