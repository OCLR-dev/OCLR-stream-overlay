import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionStore } from '../server/session/store.js';
import { currentRound, seriesOf } from '../server/session/model.js';

async function harness(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = new SessionStore();
  const cmd = (type, payload = {}) => store.command({ id: randomUUID(), version: store.state.version, type, payload });
  await cmd('setup', { title: 'Pick 场景计时 · 合成测试', stage: 'group', mode: '3v3', source: '4x3',
    teams: { a: { name: 'L', roster: [] }, b: { name: 'R', roster: [] } },
    pool: [1, 2, 3].map(i => ({ id: `m${i}`, label: `NM${i}`, mod: 'NM', beatmapId: i })) });
  await cmd('bp');
  const tick = async ms => { t.mock.timers.tick(ms); await store.tail; };
  return { store, cmd, tick, pick: (id = 'm1') => cmd('prepare-round', { entryId: id, pickedBy: 'a' }) };
}

test('a new manual Pick stays in Mappool for exactly 2500ms, then changes display only once', async t => {
  const h = await harness(t); await h.pick();
  const before = structuredClone(h.store.state);
  await h.tick(2499); assert.equal(h.store.state.scene, 'mappool');
  await h.tick(1); assert.equal(h.store.state.scene, 'playing');
  assert.deepEqual(h.store.state.rounds, before.rounds); assert.equal(currentRound(h.store.state).status, 'prepared');
  assert.equal(currentRound(h.store.state).runId, null); assert.deepEqual(seriesOf(h.store.state), { a: 0, b: 0 });
  assert.deepEqual(h.store.state.bpHistory, before.bpHistory); assert.deepEqual(h.store.state.undo, before.undo);
  const version = h.store.state.version; await h.tick(10000); assert.equal(h.store.state.version, version);
});

test('a replacement Pick restarts the delay; unrelated EX and score updates do not', async t => {
  const h = await harness(t); await h.pick(); await h.tick(2000); await h.pick('m2');
  await h.tick(500); assert.equal(h.store.state.scene, 'mappool');
  await h.cmd('ex', { team: 'a', remaining: { a: 2, b: 2 } });
  await h.cmd('set-series', { a: 1, b: 0, reason: '核对系列分' });
  await h.tick(1999); assert.equal(h.store.state.scene, 'mappool');
  await h.tick(1); assert.equal(h.store.state.scene, 'playing'); assert.equal(currentRound(h.store.state).entryId, 'm2');
});

for (const kind of ['display', 'same-display', 'undo', 'pause', 'incident', 'scenes-off', 'next-match', 'disconnect', 'series-end', 'close']) {
  test(`${kind} cancels the pending Pick transition and cannot be replayed by later snapshots`, async t => {
    const h = await harness(t); await h.pick(); await h.tick(1000);
    if (kind === 'display') await h.cmd('display', { scene: 'roll' });
    if (kind === 'same-display') await h.cmd('display', { scene: 'mappool' });
    if (kind === 'undo') await h.cmd('undo');
    if (kind === 'pause') await h.cmd('pause', { kind: 'technical' });
    if (kind === 'incident') await h.cmd('incident', { kind: 'abort', reason: '核对原图' });
    if (kind === 'scenes-off') await h.cmd('auto', { bp: true, scenes: false, results: true });
    if (kind === 'next-match') await h.cmd('next-match');
    if (kind === 'disconnect') await h.store.sourceStatus('disconnected');
    if (kind === 'series-end') await h.cmd('set-series', { a: 6, b: 0, reason: '终局' });
    if (kind === 'close') h.store.close();
    const before = structuredClone(h.store.state);
    const stop = h.store.subscribe(() => {}); h.store.snapshot(); stop();
    await h.tick(5000); assert.deepEqual(h.store.state, before);
  });
}

test('loading an existing prepared Pick and correcting broadcast marks never arm a new delay', async t => {
  const h = await harness(t); await h.pick();
  const restored = new SessionStore({ state: structuredClone(h.store.state) });
  await h.cmd('map-mark', { entryId: 'm3', status: 'picked', team: 'b' });
  const restoredBefore = structuredClone(restored.state);
  await h.tick(2500); assert.equal(h.store.state.scene, 'playing'); assert.deepEqual(restored.state, restoredBefore);
  await h.cmd('display', { scene: 'mappool' });
  await h.cmd('map-mark', { entryId: 'm3', status: 'picked', team: 'a' });
  await h.tick(2500); assert.equal(h.store.state.scene, 'mappool');
});

test('a server-observed room Pick uses the same delay, and actual Playing cancels the old timer', async t => {
  const h = await harness(t);
  const frame = (mapId, ipcState, now) => h.store.frame({ beatmap: { id: mapId }, tourney: { ipcState, teams: { left: 'L', right: 'R' },
    totalScore: { left: 0, right: 0 }, players: [{ side: 'left', osuId: 1, score: 0 }, { side: 'right', osuId: 2, score: 0 }] } }, now);
  await h.cmd('set-action', { action: { kind: 'pick', team: 'b' } });
  await frame(99, 1, 1000); await frame(1, 1, 1100); await frame(1, 1, 1600);
  assert.equal(currentRound(h.store.state).source, 'room-map');
  await h.tick(2499); assert.equal(h.store.state.scene, 'mappool');
  await h.tick(1); assert.equal(h.store.state.scene, 'playing'); assert.equal(currentRound(h.store.state).status, 'prepared');
  await frame(1, 3, 1700); assert.equal(currentRound(h.store.state).status, 'playing');
  await h.cmd('display', { scene: 'roll' }); await h.tick(5000); assert.equal(h.store.state.scene, 'roll');
});

test('early actual Playing switches immediately and a later manual scene cannot be stolen by the old timer', async t => {
  const h = await harness(t); await h.pick();
  const frame = ipcState => h.store.frame({ beatmap: { id: 1 }, tourney: { ipcState, teams: { left: 'L', right: 'R' },
    totalScore: { left: 0, right: 0 }, players: [{ side: 'left', osuId: 1, score: 0 }, { side: 'right', osuId: 2, score: 0 }] } });
  await frame(1); await h.tick(100); await frame(3);
  assert.equal(h.store.state.scene, 'playing'); assert.equal(currentRound(h.store.state).status, 'playing');
  await h.cmd('display', { scene: 'roll' }); await h.tick(2500); assert.equal(h.store.state.scene, 'roll');
});

test('resume and reenabling scene automation do not revive a canceled Pick timer', async t => {
  const h = await harness(t); await h.pick(); await h.cmd('pause', { kind: 'technical' }); await h.cmd('resume');
  await h.tick(2500); assert.equal(h.store.state.scene, 'mappool');
  await h.pick('m2'); await h.cmd('auto', { bp: true, scenes: false }); await h.cmd('auto', { bp: true, scenes: true });
  await h.tick(2500); assert.equal(h.store.state.scene, 'mappool');
});

test('Bans and replaying an old selection never count as a fresh Pick presentation', async t => {
  const h = await harness(t);
  await h.cmd('set-action', { action: { kind: 'ban', team: 'b', slot: 0 } }); await h.cmd('apply-bp', { entryId: 'm3' });
  await h.tick(2500); assert.equal(h.store.state.scene, 'mappool'); assert.equal(currentRound(h.store.state), null);
  await h.pick(); await h.cmd('start'); await h.cmd('replay', { reason: '裁判确认重赛' });
  await h.tick(2500); assert.equal(h.store.state.scene, 'mappool'); assert.equal(currentRound(h.store.state).status, 'prepared');
});
