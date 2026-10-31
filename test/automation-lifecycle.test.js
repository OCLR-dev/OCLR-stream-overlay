import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newSession, transition, currentRound, seriesOf, restoreAutomation } from '../server/session/model.js';
import { SessionStore } from '../server/session/store.js';
import { seedCommands } from '../tools/tosu-simulator/fixture.js';

function fixture() {
  let s = newSession();
  // Declared synthetic BP sequence and binding; use the production defaults.
  for (const [type, payload] of seedCommands().filter(([type]) => type !== 'auto')) {
    s = transition(s, { id: randomUUID(), version: s.version, type, payload });
  }
  return transition(s, { id: randomUUID(), version: s.version, type: 'auto', payload: {
    ...s.auto, locked: false, profile: 'stable-tourney', left: '模拟红队', right: '模拟蓝队',
  } });
}
const raw = (mapId = 799999, ipcState = 1, left = 900, right = 800) => ({ beatmap: { id: mapId }, tourney: {
  ipcState, teams: { left: '模拟红队', right: '模拟蓝队' }, totalScore: { left, right },
  players: [{ side: 'left', osuId: 1, score: left }, { side: 'right', osuId: 2, score: right }],
} });
function harness(state = fixture()) {
  const store = new SessionStore({ state }); let now = 1000;
  return { store, get s() { return store.state; },
    cmd(type, payload = {}) { return store.command({ id: randomUUID(), version: store.state.version, type, payload }); },
    frame(map, ipc = 1, left = 900, right = 800) { now += 500; return store.frame(raw(map, ipc, left, right), now); },
    async change(map, ipc = 1) { await this.frame(map, ipc); await this.frame(map, ipc); },
    async prepared() { await this.frame(799999); await this.change(720001); await this.change(730001); await this.change(710001); },
    async finish(map = 710001) { await this.frame(map, 4); await this.frame(map, 4); },
  };
}

test('default automation reads room names without manual configuration and preserves explicit opt outs', async () => {
  const h = harness(newSession());
  h.s.auto.results = false;
  await h.frame(799999);
  assert.equal(h.s.auto.profile, 'stable-tourney');
  assert.equal(h.s.auto.left, '模拟红队'); assert.equal(h.s.auto.right, '模拟蓝队');
  assert.equal(h.s.auto.results, false); assert.equal(h.s.incident, null);
  const version = h.s.version;
  await h.frame(799999); assert.equal(h.s.version, version, 'unchanged telemetry does not write repeatedly');
  await h.cmd('next-match'); await h.frame(799999);
  assert.equal(h.s.auto.left, '模拟红队'); assert.equal(h.s.auto.right, '模拟蓝队');
});

test('manual display before/during Playing yields only to the next valid event and preserves a pending Ranking', async () => {
  const h = harness(); await h.prepared();
  await h.cmd('display', { scene: 'roll' }); await h.frame(710001);
  assert.equal(h.s.scene, 'roll'); assert.equal(h.s.paused, false);
  await h.frame(710001, 3); assert.equal(h.s.scene, 'playing');
  const run = currentRound(h.s).runId;
  await h.cmd('display', { scene: 'mappool' }); await h.frame(710001, 3);
  assert.equal(h.s.scene, 'mappool'); assert.equal(currentRound(h.s).runId, run);
  await h.frame(710001, 4);
  await h.cmd('display', { scene: 'roll' });
  await h.cmd('set-roll', { a: 50, b: 20, winner: 'a', pickFirst: 'a', banFirst: 'b' });
  await h.cmd('map-mark', { entryId: 'sim-nm7', status: 'picked', team: 'b' });
  await h.cmd('ex', { team: null, remaining: { a: 1, b: 2 } });
  await h.cmd('set-plan', { queue: [{ kind: 'pick', team: 'b' }], verifiedBy: 'Synthetic test sequence' });
  await h.frame(710001, 4); assert.equal(h.s.scene, 'playing');
  assert.deepEqual(seriesOf(h.s), { a: 1, b: 0 }); assert.equal(h.s.sceneOverride, null);
  await h.cmd('display', { scene: 'roll' }); await h.frame(710001, 4);
  assert.equal(h.s.scene, 'roll');
  await h.change(710002); assert.equal(currentRound(h.s).entryId, 'sim-nm2'); assert.equal(h.s.scene, 'mappool');
});

test('automatic match progress and wins are independent of automatic scene selection', async () => {
  const h = harness(); await h.cmd('auto', { ...h.s.auto, scenes: false, locked: false });
  await h.prepared(); await h.cmd('display', { scene: 'roll' });
  await h.frame(710001, 3); assert.equal(currentRound(h.s).status, 'playing'); assert.equal(h.s.scene, 'roll');
  await h.finish(); assert.deepEqual(seriesOf(h.s), { a: 1, b: 0 }); assert.equal(h.s.scene, 'roll');
  await h.change(710002); assert.equal(currentRound(h.s).entryId, 'sim-nm2');
  await h.frame(710002, 3); await h.finish(710002); assert.equal(seriesOf(h.s).a, 2);
});

test('automatic result opt out preserves automatic display and BP', async () => {
  const h = harness(); await h.cmd('auto', { ...h.s.auto, results: false, locked: false });
  await h.prepared(); await h.frame(710001, 3); await h.finish();
  assert.equal(h.s.scene, 'playing'); assert.deepEqual(seriesOf(h.s), { a: 0, b: 0 });
});

test('retraction, manual winner and absolute score correction survive old snapshots while the next round runs', async () => {
  const h = harness(); await h.prepared(); await h.frame(710001, 3); await h.finish();
  const old = currentRound(h.s).id;
  await h.cmd('retract-result', { roundId: old, reason: 'Synthetic review' });
  await h.finish(); assert.equal(seriesOf(h.s).a, 0);
  await h.cmd('record-result', { roundId: old, winner: 'b', keepDisplay: true });
  await h.cmd('correct-result', { roundId: old, winner: 'a', reason: 'Synthetic correction' });
  await h.frame(710001, 4, 0, 9000); assert.deepEqual(seriesOf(h.s), { a: 1, b: 0 });
  await h.cmd('set-series', { a: 2, b: 2, reason: 'Synthetic correction' });
  await h.change(710002); await h.frame(710002, 3); await h.finish(710002);
  assert.deepEqual(seriesOf(h.s), { a: 3, b: 2 }); assert.equal(h.s.paused, false);
});

test('correcting a series during pending Ranking consumes that old finish without disabling future wins', async () => {
  const h = harness(); await h.prepared(); await h.frame(710001, 3);
  await h.frame(710001, 4, null, null); await h.frame(710001, 4, null, null);
  await h.cmd('set-series', { a: 2, b: 1, reason: 'Synthetic pending correction' });
  await h.finish(); assert.deepEqual(seriesOf(h.s), { a: 2, b: 1 });
  await h.change(710002); await h.frame(710002, 3); await h.finish(710002);
  assert.deepEqual(seriesOf(h.s), { a: 3, b: 1 });
});

test('supplementing an old result does not reset observation of the newer running map', async () => {
  const h = harness(); await h.prepared(); await h.frame(710001, 3);
  await h.frame(710001, 4, null, null); await h.frame(710001, 4, null, null);
  const old = currentRound(h.s).id;
  await h.change(710002); await h.frame(710002, 3); await h.frame(710002, 4);
  await h.cmd('record-result', { roundId: old, winner: 'b', keepDisplay: true });
  await h.frame(710002, 4); assert.deepEqual(seriesOf(h.s), { a: 1, b: 1 });
});

for (const status of ['disconnected', 'stale', 'invalid-data']) test(`${status} while prepared automatically rebaselines; active play still requires incident verification`, async () => {
  const h = harness(); await h.prepared();
  await h.store.sourceStatus(status); assert.equal(h.s.incident, null); assert.equal(h.s.auto.results, true);
  await h.frame(710001, 4); await h.frame(710001, 4); assert.equal(seriesOf(h.s).a, 0);
  await h.frame(710001, 1); await h.frame(710001, 3);
  const run = currentRound(h.s).runId;
  await h.store.sourceStatus(status); assert.ok(h.s.incident);
  await h.frame(710001, 3);
  await h.cmd('resolve-incident', { reason: 'Synthetic live verification' });
  await h.frame(710001, 3); await h.frame(710001, 3); await h.finish();
  assert.equal(currentRound(h.s).runId, run); assert.deepEqual(seriesOf(h.s), { a: 1, b: 0 });
});

test('room mismatch rebaselines without consuming the map seen during the mismatch', async () => {
  const h = harness(); await h.frame(799999);
  const bad = raw(720001); bad.tourney.teams.left = 'Other room'; await h.store.frame(bad, 1600);
  await h.frame(720001); await h.frame(720001); assert.equal(h.s.bans.a[0], null);
  await h.change(710007); assert.equal(h.s.bans.a[0], 'sim-nm7');
});

test('prestart continue, abort replay and manual incident result each recover with one handling action', async () => {
  const h = harness(); await h.prepared();
  await h.cmd('incident', { kind: 'abort', reason: 'Synthetic prestart abort' });
  await h.cmd('resolve-incident', { reason: 'Synthetic continue' });
  await h.frame(710001, 1); await h.frame(710001, 3);
  const original = currentRound(h.s);
  await h.frame(710001, 1); assert.ok(h.s.incident);
  await h.cmd('referee-replay', { reason: 'Synthetic referee decision' });
  assert.equal(currentRound(h.s).replayOf, original.id);
  await h.frame(710001, 4); await h.frame(710001, 4); assert.equal(seriesOf(h.s).a, 0);
  await h.frame(710001, 1); await h.frame(710001, 3);
  assert.notEqual(currentRound(h.s).runId, original.runId);
  await h.cmd('incident', { kind: 'spectator', reason: 'Synthetic lost finish' });
  await h.frame(710001, 4);
  await h.cmd('record-result', { roundId: currentRound(h.s).id, winner: 'b', reviewReason: 'Synthetic referee result', keepDisplay: true });
  await h.finish(); assert.deepEqual(seriesOf(h.s), { a: 0, b: 1 });
  await h.change(710002); await h.frame(710002, 3); await h.finish(710002);
  assert.deepEqual(seriesOf(h.s), { a: 1, b: 1 });
});

test('explicit pause survives display changes and ends with a safe baseline without a manual mode', async () => {
  const h = harness(); await h.prepared(); await h.frame(710001, 3);
  await h.cmd('pause', { kind: 'technical' }); await h.cmd('display', { scene: 'roll' });
  await h.finish(); assert.equal(h.s.paused, true); assert.equal(currentRound(h.s).status, 'playing');
  await h.cmd('resume'); await h.finish(); assert.equal(seriesOf(h.s).a, 0);
  await h.frame(710001, 3); await h.finish(); assert.equal(seriesOf(h.s).a, 1);
  await h.cmd('pause', { kind: 'technical' }); await h.change(710002);
  assert.equal(currentRound(h.s).entryId, 'sim-nm1');
  await h.cmd('resume'); await h.change(710002);
  assert.equal(currentRound(h.s).entryId, 'sim-nm1');
  await h.change(710003); assert.equal(currentRound(h.s).entryId, 'sim-nm3');
});

test('restoring persisted intent starts from a baseline; Ranking snapshots and readers cannot award or replay', async t => {
  const h = harness(); await h.prepared(); await h.frame(710001, 3);
  const dir = await mkdtemp(join(tmpdir(), 'oclr-lifecycle-')); t.after(() => rm(dir, { recursive: true }));
  const file = join(dir, 'session.json'); await writeFile(file, JSON.stringify(h.s));
  const restored = await SessionStore.open(file);
  const listeners = [restored.subscribe(() => {}), restored.subscribe(() => {})];
  await restored.frame(raw(710001, 4), 10000); await restored.frame(raw(710001, 4), 10500);
  assert.equal(seriesOf(restored.state).a, 0); assert.equal(restored.state.auto.results, true);
  listeners.forEach(stop => stop());
});

test('legacy incidental locks migrate to scene overrides, explicit/unknown holds become pauses and opt outs remain', () => {
  const old = fixture(); delete old.automationVersion; delete old.auto.results;
  old.locked = true; old.undo = [{ message: '手动切画面并锁定自动跟随', state: { ...structuredClone(old), locked: false, undo: [] } }];
  const upgraded = restoreAutomation(old);
  assert.equal('locked' in upgraded, false); assert.equal(upgraded.paused, false); assert.ok(upgraded.sceneOverride); assert.equal(upgraded.undo[0].state.auto.results, true);
  old.undo[0].message = '更新自动跟随与房间绑定（重新建立基线）';
  assert.equal(restoreAutomation(old).paused, true);
  old.undo = []; assert.equal(restoreAutomation(old).paused, true);
  old.auto.scenes = false; assert.equal(restoreAutomation(old).auto.scenes, false);
  const freshLegacy = newSession(); delete freshLegacy.automationVersion; freshLegacy.auto.bp = false; freshLegacy.auto.scenes = false;
  assert.equal(restoreAutomation(freshLegacy).auto.bp, true);
});

test('changing only scene automation during Ranking preserves automatic result continuity', async () => {
  const h = harness(); await h.prepared(); await h.frame(710001, 3); await h.frame(710001, 4);
  await h.cmd('auto', { ...h.s.auto, scenes: false, locked: false });
  await h.frame(710001, 4); assert.equal(seriesOf(h.s).a, 1); assert.equal(h.s.scene, 'playing');
});

test('a new automatic finish after series correction during Playing still detects late changing totals', async () => {
  const h = harness(); await h.prepared(); await h.frame(710001, 3);
  await h.cmd('set-series', { a: 1, b: 1, reason: 'Synthetic correction during Playing' });
  await h.finish(); assert.deepEqual(seriesOf(h.s), { a: 2, b: 1 });
  await h.frame(710001, 4, 900, 1000); assert.ok(h.s.incident); assert.deepEqual(seriesOf(h.s), { a: 1, b: 1 });
});

test('an actual live room change interrupts the old run while reading the new names automatically', async () => {
  const h = harness(); await h.prepared(); await h.frame(710001, 3);
  const changed = raw(710001, 3); changed.tourney.teams.left = 'Other room';
  await h.store.frame(changed, 10000);
  assert.equal(h.s.auto.left, 'Other room');
  assert.ok(h.s.incident); assert.equal(h.s.paused, false); await h.finish(); assert.equal(seriesOf(h.s).a, 0);
});

test('manual incident result consumes the known old snapshot so an immediate next map event is not lost as a baseline', async () => {
  const h = harness(); await h.prepared(); await h.frame(710001, 3);
  await h.cmd('incident', { kind: 'spectator', reason: 'Synthetic finish lost' });
  await h.frame(710001, 4);
  await h.cmd('record-result', { roundId: currentRound(h.s).id, winner: 'b', reviewReason: 'Synthetic verified result', keepDisplay: true });
  await h.change(710002); assert.equal(currentRound(h.s).entryId, 'sim-nm2');
  await h.frame(710002, 3); await h.finish(710002); assert.deepEqual(seriesOf(h.s), { a: 1, b: 1 });
});

test('there is no global manual mode; old explicit holds migrate to a normal pause that one resume ends', async () => {
  const old = fixture(); old.automationVersion = 2; old.locked = true; old.auto.results = false;
  const h = harness(old);
  assert.equal('locked' in h.s, false); assert.equal(h.s.paused, true); assert.equal(h.s.auto.results, false);
  await h.cmd('resume'); assert.equal(h.s.paused, false);
  await assert.rejects(h.cmd('auto', { ...h.s.auto, locked: true }), /已移除全局人工接管/);
  assert.equal(h.s.paused, false);
});

test('manual map and Pick corrections are immediately effective and do not introduce a new incident or pause', async () => {
  const h = harness(); await h.prepared(); await h.frame(710001, 3);
  const run = currentRound(h.s).runId;
  await h.cmd('adjust-round', { entryId: 'sim-nm2', pickedBy: 'b', ifCurrentRoundId: currentRound(h.s).id });
  assert.equal(h.s.incident, null); assert.equal(h.s.paused, false); assert.equal(currentRound(h.s).runId, run);
  await h.change(710002, 3); await h.frame(710002, 3); await h.finish(710002);
  assert.deepEqual(seriesOf(h.s), { a: 1, b: 0 });
});

test('autosaved map edits cannot target a newer round when the previous selection changes during synchronization', async () => {
  const h = harness(); await h.prepared(); const old = currentRound(h.s).id;
  await h.frame(710001, 3); await h.finish(); await h.change(710002);
  await assert.rejects(h.cmd('adjust-round', { entryId: 'sim-nm3', pickedBy: 'a', ifCurrentRoundId: old }), /本局已切换/);
  await assert.rejects(h.cmd('prepare-round', { entryId: 'sim-nm3', pickedBy: 'a', ifCurrentRoundId: old }), /本局已切换/);
  assert.equal(currentRound(h.s).entryId, 'sim-nm2');
});
