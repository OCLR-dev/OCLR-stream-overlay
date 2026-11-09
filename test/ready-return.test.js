import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as model from '../server/session/model.js';
import { SessionStore } from '../server/session/store.js';

async function harness(custom = false, start = true) {
  let state = custom ? model.newCustomSession() : model.newSession();
  const apply = (type, payload = {}) => { state = model.transition(state, { id: randomUUID(), version: state.version, type, payload }); };
  if (custom) apply('setting', { field: 'bestOf', value: 9 });
  apply('setting', { field: 'pool', value: [1, 2].map(i => ({ id: `m${i}`, label: `NM${i}`, mod: 'NM', beatmapId: i })) });
  apply('bp'); apply('set-action', { action: { kind: 'pick', team: 'a' }, queue: [{ kind: 'pick', team: 'b' }] });
  apply('apply-bp', { entryId: 'm1' });
  let store = new SessionStore({ state }); let time = 1000;
  const h = { get store() { return store; }, restart() { store.close(); store = new SessionStore({ state: structuredClone(store.state) }); }, get s() { return store.state; },
    cmd(type, payload = {}) { return store.command({ id: randomUUID(), version: store.state.version, type, payload }); },
    frame(ipc, options = {}, ms = 500) {
      const { id = 1, left = 900, right = 800, teams = { left: 'L', right: 'R' },
        players = [{ side: 'left', osuId: 1, score: left }, { side: 'right', osuId: 2, score: right }] } = options;
      return store.frame({ beatmap: { id }, tourney: { ipcState: ipc, teams, players, totalScore: { left, right } } }, time += ms);
    },
  };
  await h.frame(1); if (start) await h.frame(3);
  return h;
}
const round = h => model.currentRound(h.s);
const facts = h => structuredClone({ pool: h.s.pool, marks: h.s.poolMarks, choice: h.s.poolChoice, bans: h.s.bans,
  bp: h.s.bpHistory, queue: h.s.queue, ex: h.s.ex, adjustment: h.s.seriesAdjustment, scene: h.s.scene, override: h.s.sceneOverride });

for (const custom of model.newCustomSession ? [false, true] : [false]) {
  for (const ipc of [1, 2]) test(`${custom ? 'custom' : 'main'} unfinished run returns to ready ${ipc}, preserves selection/display and resumes automatically`, async t => {
    const h = await harness(custom); t.after(() => h.store.close());
    await h.cmd('display', { scene: 'roll' });
    const old = structuredClone(round(h)); const before = facts(h);
    await h.frame(ipc); assert.equal(round(h).id, old.id); assert.ok(h.s.incident);
    await h.frame(ipc);
    assert.equal(round(h).status, 'prepared'); assert.equal(round(h).replayOf, old.id);
    assert.equal(round(h).runId, null); assert.equal(h.s.incident, null); assert.deepEqual(facts(h), before);
    assert.equal(h.s.rounds.find(r => r.id === old.id).status, 'void'); assert.deepEqual(model.seriesOf(h.s), { a: 0, b: 0 });
    const prepared = round(h).id; const version = h.s.version;
    await h.frame(ipc); assert.equal(round(h).id, prepared); assert.equal(h.s.version, version);
    await h.frame(4); await h.frame(4); assert.equal(round(h).status, 'prepared');
    await h.frame(1); await h.frame(3, { players: [], left: 0, right: 0 }); await h.frame(3);
    assert.equal(round(h).status, 'playing'); assert.notEqual(round(h).runId, old.runId);
    await h.frame(4); await h.frame(4); assert.deepEqual(model.seriesOf(h.s), { a: 1, b: 0 });
    await h.frame(1); await h.frame(1, { id: 2 }); await h.frame(1, { id: 2 });
    assert.equal(round(h).entryId, 'm2'); assert.equal(round(h).pickedBy, 'b');
  });
}

test('missing player alone stays held; a subsequent room return can restore preparation without repicking', async t => {
  const h = await harness(); t.after(() => h.store.close()); const old = round(h).id;
  const missing = { players: [{ side: 'left', osuId: 1, score: 900 }] };
  await h.frame(3, missing); await h.frame(3, missing); assert.equal(round(h).id, old); assert.ok(h.s.incident);
  await h.frame(1, { id: 0, players: [] }); await h.frame(1, { id: 0, players: [] });
  assert.equal(round(h).status, 'prepared'); assert.equal(round(h).replayOf, old);
  await h.frame(3, { id: 0, players: [] }); await h.frame(3); assert.equal(round(h).status, 'playing');
});

test('one transient ready frame does not void the run', async t => {
  const h = await harness(); t.after(() => h.store.close()); const old = round(h).id;
  await h.frame(1); await h.frame(3); await h.frame(3); assert.equal(round(h).id, old); assert.equal(h.s.rounds.length, 1);
});

for (const reason of ['ranking', 'initialising', 'map', 'room', 'gap', 'backwards', 'disconnect', 'pause', 'manual', 'disabled', 'restart']) {
  test(`room return does not reuse evidence after ${reason}`, async t => {
    let h = await harness(); t.after(() => h.store.close()); const old = round(h).id;
    if (reason === 'ranking') await h.frame(4);
    if (reason === 'initialising') await h.frame(0, { id: 0, players: [] });
    if (reason === 'map') await h.frame(1, { id: 2 });
    if (reason === 'room') await h.frame(1, { teams: { left: 'Other', right: 'R' } });
    if (reason === 'gap') await h.frame(1, {}, 5001);
    if (reason === 'backwards') await h.frame(1, {}, -100);
    if (reason === 'disconnect') await h.store.sourceStatus('disconnected');
    if (reason === 'pause') await h.cmd('pause', { kind: 'technical' });
    if (reason === 'manual') await h.cmd('incident', { kind: 'player-disconnect', reason: '直播员明确等待' });
    if (reason === 'disabled') await h.cmd('auto', { ...h.s.auto, bp: false, scenes: false, results: false });
    if (reason === 'restart') h.restart();
    await h.frame(1); await h.frame(1); assert.equal(round(h).id, old); assert.notEqual(round(h).status, 'prepared');
  });
}

test('undo does not replay the same room return and a persisted Playing run cannot invent an observed start', async t => {
  const h = await harness(); t.after(() => h.store.close()); const old = round(h).id;
  await h.frame(1); await h.frame(1); assert.equal(round(h).status, 'prepared');
  await h.cmd('undo'); await h.frame(1); await h.frame(1); assert.equal(round(h).id, old); assert.equal(round(h).status, 'playing');
});

test('room return while only prepared does not manufacture another attempt or a result', async t => {
  const h = await harness(false, false); t.after(() => h.store.close()); const old = round(h).id;
  await h.frame(2); await h.frame(1); await h.frame(1);
  assert.equal(round(h).id, old); assert.equal(h.s.rounds.length, 1); assert.deepEqual(model.seriesOf(h.s), { a: 0, b: 0 });
});


test('return preserves active EX, corrected series and a manually selected Mappool without arming a Pick timer', async t => {
  const h = await harness(false, false); t.after(() => h.store.close());
  await h.cmd('ex', { team: 'b', remaining: { a: 1, b: 2 } });
  await h.frame(3);
  await h.cmd('set-series', { a: 2, b: 1, reason: '已核对系列比分' });
  await h.cmd('display', { scene: 'mappool' });
  const before = facts(h);
  await h.frame(1); await h.frame(2);
  assert.equal(round(h).status, 'prepared'); assert.deepEqual(facts(h), before);
  assert.deepEqual(model.seriesOf(h.s), { a: 2, b: 1 }); assert.equal(h.store.pickScene.pending, null);
  assert.equal(round(h).exTeam, 'b');
});

test('EX belongs to one Pick across abort, result correction and explicit replay; old attempts stay inert', async t => {
  const h = await harness(false, false); t.after(() => h.store.close());
  await h.cmd('ex', { team: 'a', remaining: { a: 2, b: 2 } });
  const selection = round(h).selectionId;
  await h.frame(3); const first = round(h).id;
  assert.equal(h.s.ex.remaining.a, 2);
  await h.frame(1); await h.frame(1);
  assert.equal(round(h).selectionId, selection); assert.notEqual(round(h).id, first);
  await h.frame(4); await h.frame(4);
  assert.deepEqual(model.seriesOf(h.s), { a: 0, b: 0 }); assert.equal(h.s.ex.remaining.a, 2);
  await h.frame(1); await h.frame(3); await h.frame(4); await h.frame(4);
  assert.deepEqual(model.seriesOf(h.s), { a: 1, b: 0 }); assert.equal(h.s.ex.remaining.a, 1);
  const finished = round(h).id;
  await h.cmd('correct-result', { roundId: finished, winner: 'b', reason: '裁判修正胜方' });
  await h.frame(4); assert.deepEqual(model.seriesOf(h.s), { a: 0, b: 1 }); assert.equal(h.s.ex.remaining.a, 1);
  await h.cmd('ex', { team: 'a', remaining: { a: 1, b: 1 } });
  await h.cmd('referee-replay', { reason: '裁判确认同图重赛' });
  assert.equal(h.s.ex.remaining.b, 1);
  assert.equal(round(h).selectionId, selection); assert.equal(h.s.ex.remaining.a, 2);
  assert.deepEqual(model.seriesOf(h.s), { a: 0, b: 0 });
  await h.frame(4); assert.equal(round(h).status, 'prepared');
  await h.frame(1); await h.frame(3); await h.frame(4); await h.frame(4);
  assert.deepEqual(model.seriesOf(h.s), { a: 1, b: 0 }); assert.equal(h.s.ex.remaining.a, 1);
  assert.notEqual(round(h).id, finished);
});
