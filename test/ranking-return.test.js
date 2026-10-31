import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionStore } from '../server/session/store.js';
import { newSession, currentRound, seriesOf, transition } from '../server/session/model.js';
import { seedCommands } from '../tools/tosu-simulator/fixture.js';
function harness(state) {
  if (!state) {
    state = newSession();
    for (const [type, payload] of seedCommands().filter(([type]) => type !== 'auto')) state = transition(state, { id: randomUUID(), version: state.version, type, payload });
  }
  const store = new SessionStore({ state }); let now = 1000;
  return { store, get s() { return store.state; },
    cmd(type, payload = {}) { return store.command({ id: randomUUID(), version: store.state.version, type, payload }); },
    frame(map = 710001, ipc = 1, left = 900, right = 800) { return store.frame({ beatmap: { id: map }, tourney: {
      ipcState: ipc, teams: { left: 'L', right: 'R' }, totalScore: { left, right }, players: [{ side: 'left', osuId: 1, score: left }, { side: 'right', osuId: 2, score: right }],
    } }, now += 500); },
    async change(map) { await this.frame(map); await this.frame(map); },
    async ranking(left = 900, right = 800) { await this.frame(799999); await this.change(720001); await this.change(730001); await this.change(710001); await this.frame(710001, 3); await this.frame(710001, 4, left, right); await this.frame(710001, 4, left, right); },
  };
}
for (const ipc of [1, 2]) test(`Ranking exit to room IPC ${ipc} returns without a map change and next map automatically Picks`, async () => {
  const h = harness(); await h.ranking(); assert.equal(h.s.scene, 'playing');
  const round = structuredClone(currentRound(h.s)), action = structuredClone(h.s.action), series = seriesOf(h.s);
  const depth = h.s.undo.length;
  await h.frame(710001, ipc); assert.equal(h.s.scene, 'mappool'); assert.equal(h.s.phase, 'bp');
  assert.deepEqual(currentRound(h.s), round); assert.deepEqual(h.s.action, action); assert.deepEqual(seriesOf(h.s), series); assert.equal(h.s.undo.length, depth);
  const version = h.s.version; await h.frame(710001, ipc); assert.equal(h.s.version, version);
  await h.change(710002); assert.equal(currentRound(h.s).entryId, 'sim-nm2'); assert.equal(currentRound(h.s).source, 'room-map');
});
test('missing final scores stay pending while the room return and next automatic Pick remain available', async () => {
  const h = harness(); await h.ranking(null, null); assert.equal(currentRound(h.s).status, 'ranking');
  const round = structuredClone(currentRound(h.s)); await h.frame();
  assert.equal(h.s.scene, 'mappool'); assert.deepEqual(currentRound(h.s), round); assert.deepEqual(seriesOf(h.s), { a: 0, b: 0 });
  await h.change(710002); assert.equal(currentRound(h.s).entryId, 'sim-nm2'); assert.deepEqual(h.s.rounds[0], round);
});
test('return can end a prior display override, but repeated room frames preserve a new manual display', async () => {
  const h = harness(); await h.ranking(); await h.cmd('display', { scene: 'roll' });
  await h.frame(); assert.equal(h.s.scene, 'mappool'); assert.equal(h.s.sceneOverride, null);
  await h.cmd('display', { scene: 'waiting' }); await h.frame(); assert.equal(h.s.scene, 'waiting'); assert.ok(h.s.sceneOverride);
});
test('score-change review remains intact when returning to the room; no automatic result or BP is fabricated', async () => {
  const h = harness(); await h.ranking(); await h.frame(710001, 4, 800, 900); assert.ok(h.s.incident);
  const before = structuredClone(h.s), count = h.s.bpHistory.length; await h.frame();
  assert.equal(h.s.scene, 'mappool'); assert.deepEqual(h.s.incident, before.incident); assert.deepEqual(h.s.rounds, before.rounds); assert.deepEqual(h.s.action, before.action);
  assert.equal(h.s.bpHistory.length, count); assert.deepEqual(seriesOf(h.s), seriesOf(before));
});
test('scene opt out, explicit pause and series end retain their display on Ranking exit', async () => {
  for (const mode of ['off', 'pause', 'ended']) {
    const h = harness(); await h.ranking();
    if (mode === 'off') await h.cmd('auto', { bp: true, scenes: false, results: true });
    if (mode === 'pause') await h.cmd('pause', { kind: 'technical' });
    if (mode === 'ended') h.s.seriesAdjustment.a = 5;
    const scene = h.s.scene; await h.frame(); assert.equal(h.s.scene, scene, mode);
  }
});
test('a reconnect at Idle cannot replay a Ranking exit; live display without a round can return without creating history', async () => {
  const h = harness(); await h.ranking(); const restored = harness(structuredClone(h.s));
  await restored.frame(); assert.equal(restored.s.scene, 'playing');
  const noRound = harness(newSession()); await noRound.frame(710001, 3); await noRound.frame(710001, 4); await noRound.frame();
  assert.equal(noRound.s.scene, 'mappool'); assert.deepEqual(noRound.s.rounds, []); assert.deepEqual(seriesOf(noRound.s), { a: 0, b: 0 });
});

test('room map changes with temporarily zero player IDs still apply automatic BP; Playing validation stays strict', async () => {
  const h = harness(); await h.ranking(); await h.frame();
  const raw = (map, ipc, players) => ({ beatmap: { id: map }, tourney: { ipcState: ipc, teams: { left: 'L', right: 'R' }, totalScore: { left: 0, right: 0 }, players } });
  const cleared = [{ side: 'left', osuId: 0, score: 0 }, { side: 'right', osuId: 0, score: 0 }];
  await h.store.frame(raw(710002, 1, cleared), 10000); await h.store.frame(raw(710002, 1, cleared), 10500);
  assert.equal(currentRound(h.s).entryId, 'sim-nm2'); assert.equal(currentRound(h.s).source, 'room-map');
  await h.store.frame(raw(710002, 3, cleared), 11000); assert.equal(currentRound(h.s).status, 'prepared');
});
test('hidden zero aggregate scores with unchanged client finals do not retract a valid result or suspend BP', async () => {
  const h = harness(); await h.ranking(); const before = structuredClone(currentRound(h.s)), series = seriesOf(h.s);
  const raw = { beatmap: { id: 710001 }, tourney: { ipcState: 4, scoreVisible: false, teams: { left: 'L', right: 'R' }, totalScore: { left: 0, right: 0 }, players: [{ side: 'left', osuId: 1, score: 900 }, { side: 'right', osuId: 2, score: 800 }] } };
  await h.store.frame(raw, 10000); assert.equal(h.s.incident, null); assert.deepEqual(currentRound(h.s), before); assert.deepEqual(seriesOf(h.s), series);
  await h.store.frame({ ...raw, tourney: { ...raw.tourney, scoreVisible: true, totalScore: { left: 1000, right: 800 }, players: [{ side: 'left', osuId: 1, score: 1000 }, { side: 'right', osuId: 2, score: 800 }] } }, 10500);
  assert.ok(h.s.incident); assert.deepEqual(seriesOf(h.s), { a: 0, b: 0 }, 'a real changed result still requires review');
});
test('normal finish needs no manual confirmation and hidden/reset clients cannot revoke it before the next Pick', async () => {
  const h = harness(); await h.ranking();
  assert.equal(currentRound(h.s).resultSource, 'tosu'); assert.equal(currentRound(h.s).winner, 'a');
  const saved = structuredClone(currentRound(h.s));
  for (const players of [
    [{ side: 'left', osuId: 1, score: 900 }, { side: 'right', osuId: 2, score: 800 }],
    [{ side: 'left', osuId: 1, score: 0 }, { side: 'right', osuId: 2, score: 0 }],
    [{ side: 'left', osuId: 0, score: 0 }, { side: 'right', osuId: 0, score: 0 }],
  ]) {
    await h.store.frame({ beatmap: { id: 710001 }, tourney: { ipcState: 4, scoreVisible: false, teams: { left: 'L', right: 'R' }, totalScore: { left: 0, right: 0 }, players } }, 10000);
    assert.equal(h.s.incident, null); assert.deepEqual(currentRound(h.s), saved); assert.deepEqual(seriesOf(h.s), { a: 1, b: 0 });
  }
  await h.frame(); await h.change(710002); assert.equal(currentRound(h.s).entryId, 'sim-nm2'); assert.equal(currentRound(h.s).source, 'room-map');
  assert.deepEqual(h.s.rounds[0], saved);
});
