import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { SessionStore } from '../server/session/store.js';
import { currentRound, newCustomSession, transition, seriesOf } from '../server/session/model.js';
import { sessionFromTemplate } from '../server/custom-template.js';
import { startCustomMatch } from '../server/custom-match.js';
const cmd = (s, type, payload = {}) => transition(s, { id: randomUUID(), version: s.version, type, payload });
const preset = s => cmd(s, 'set-bp-preset', { value: 'single-ban-alternate' });
const pool = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, label: `NM${i}`, mod: 'NM', beatmapId: 810000 + i }));
function oldSession() {
  let s = newCustomSession();
  for (const [field, value] of [['bestOf', 9], ['pool', pool]]) s = cmd(s, 'setting', { field, value });
  return cmd(s, 'set-roll', { a: 99, b: 11, winner: 'a', banFirst: 'b', pickFirst: 'a' });
}
const choose = (s, team, kind, i) => cmd(cmd(s, 'select-bp-action', { team, kind }), 'apply-bp', { entryId: `m${i}` });

test('loading an old ruleless session never overwrites it with the bundled template; explicit enrolment resumes it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bp-upgrade-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'session.json'); const old = oldSession();
  await writeFile(file, JSON.stringify(old));
  const template = JSON.parse(await readFile(new URL('../configs/mp5-xronicle-swiss-2.json', import.meta.url), 'utf8'));
  const store = await SessionStore.open(file, { initialState: () => sessionFromTemplate(template) }); t.after(() => store.close());
  assert.deepEqual(store.state, old); assert.equal(store.state.action, null);
  await store.command({ id: randomUUID(), version: old.version, type: 'set-bp-preset', payload: { value: 'single-ban-alternate' } });
  assert.deepEqual([store.state.action.kind, store.state.action.team], ['ban', 'b']);
  assert.equal(store.state.bpHistory.length, 0); assert.equal(store.state.rounds.length, 0);
  assert.deepEqual(cmd(store.state, 'undo').match, old.match);
});

for (const status of ['prepared', 'playing', 'ranking', 'recorded']) test(`enrolling an existing ${status} Pick preserves records and resumes the Blue successor once`, () => {
  let s = choose(choose(choose(oldSession(), 'b', 'ban', 0), 'a', 'ban', 1), 'a', 'pick', 2);
  if (status !== 'prepared') s = cmd(s, 'start');
  if (['ranking', 'recorded'].includes(status)) s = cmd(s, 'ranking');
  if (status === 'recorded') s = cmd(s, 'record-result', { winner: 'a', roundId: s.currentRoundId, keepDisplay: true });
  const before = structuredClone(s); s = preset(s);
  for (const key of ['rounds', 'bpHistory', 'bans', 'seriesAdjustment', 'currentRoundId', 'scene', 'phase']) assert.deepEqual(s[key], before[key], key);
  assert.deepEqual(seriesOf(s), seriesOf(before));
  if (['prepared', 'playing'].includes(status)) {
    assert.equal(s.action, null); assert.equal(s.queue[0].team, 'b');
    if (status === 'prepared') s = cmd(s, 'start'); s = cmd(s, 'ranking');
  }
  assert.equal(s.action.team, 'b'); assert.equal(s.action.kind, 'pick');
  const action = structuredClone(s.action); const queue = structuredClone(s.queue);
  s = preset(s); assert.deepEqual(s.action, action); assert.deepEqual(s.queue, queue);
  assert.deepEqual(cmd(preset(before), 'undo').rounds, before.rounds);
});

test('late enrolment keeps unknown opening Bans unknown and alternates from the actual current picker', () => {
  let s = oldSession(); s.roll.banFirst = null; s.roll.pickFirst = null;
  s = choose(s, 'b', 'pick', 2); s = preset(s);
  assert.deepEqual(s.bans, { a: [null, null], b: [null, null] });
  assert.equal(s.action, null); assert.equal(s.queue[0].kind, 'pick'); assert.equal(s.queue[0].team, 'a');
  s = cmd(cmd(s, 'start'), 'ranking'); assert.equal(s.action.team, 'a'); assert.equal(s.bpHistory.length, 1);
});

test('the simple preset follows real WebSocket room changes through both Bans, Red finish and Blue Pick', { timeout: 15000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bp-websocket-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const app = await startCustomMatch({ port: 0, simulatorPort: 0, guard: false, sessionFile: join(dir, 'session.json'), initialState: () => preset(oldSession()) });
  t.after(() => app.stop());
  const until = async predicate => {
    const end = Date.now() + 4000;
    while (!predicate() && Date.now() < end) await delay(20);
    assert.ok(predicate());
  };
  await app.store.command({ id: randomUUID(), version: app.store.state.version, type: 'auto', payload: { ...app.store.state.auto, wsUrl: app.simulator.wsUrl } });
  await until(() => app.store.live.tosu.status === 'live'); await delay(120);
  for (let i = 0; i < 3; i++) {
    app.simulator.set({ mapId: 810000 + i, ipcState: 1 });
    await until(() => app.store.state.bpHistory.length === i + 1);
  }
  assert.equal(app.store.state.bans.b[0], 'm0'); assert.equal(app.store.state.bans.a[0], 'm1');
  assert.equal(currentRound(app.store.state).pickedBy, 'a');
  app.simulator.set({ ipcState: 3 }); await until(() => currentRound(app.store.state).status === 'playing');
  app.simulator.set({ ipcState: 4, left: 100, right: 90 }); await until(() => currentRound(app.store.state).status === 'recorded');
  assert.equal(app.store.state.action.team, 'b');
  app.simulator.set({ ipcState: 1 }); await delay(150); app.simulator.set({ mapId: 810003 });
  await until(() => currentRound(app.store.state).entryId === 'm3'); assert.equal(currentRound(app.store.state).pickedBy, 'b');
  assert.ok(app.store.state.bpHistory.every(h => h.source === 'room-map'));
});

test('new room maps execute Roll → first Ban → second Ban → Red Pick → finish → Blue Pick without manual apply-bp', async t => {
  const store = new SessionStore({ state: preset(oldSession()) }); t.after(() => store.close()); let now = 1000;
  const frame = (mapId, ipcState = 1) => store.frame({ beatmap: { id: mapId }, tourney: { ipcState, teams: { left: 'L', right: 'R' },
    totalScore: { left: 100, right: 90 }, players: [{ side: 'left', osuId: 1, score: 100 }, { side: 'right', osuId: 2, score: 90 }] } }, now += 500);
  const change = async mapId => { await frame(mapId); await frame(mapId); };
  await frame(899999); await change(810000); assert.equal(store.state.bans.b[0], 'm0');
  await change(810001); assert.equal(store.state.bans.a[0], 'm1');
  await change(810002); assert.equal(currentRound(store.state).pickedBy, 'a');
  assert.equal(store.state.bpHistory.every(h => h.source === 'room-map'), true);
  await frame(810002, 3); await frame(810002, 4); await frame(810002, 4);
  assert.deepEqual(seriesOf(store.state), { a: 1, b: 0 }); assert.equal(store.state.action.team, 'b');
  const count = store.state.bpHistory.length; await frame(810002, 4); assert.equal(store.state.bpHistory.length, count);
  await frame(810002); await change(810003); assert.equal(currentRound(store.state).pickedBy, 'b');
  assert.equal(currentRound(store.state).source, 'room-map');
});

test('enrolling a rule cannot transfer a pending old map event to a new action', async t => {
  let s = oldSession(); s = cmd(s, 'select-bp-action', { team: 'a', kind: 'ban' });
  const store = new SessionStore({ state: s }); t.after(() => store.close()); let now = 0;
  const frame = mapId => store.frame({ beatmap: { id: mapId }, tourney: { ipcState: 1, teams: { left: 'L', right: 'R' }, players: [{ side: 'left', osuId: 1 }, { side: 'right', osuId: 2 }] } }, now += 500);
  await frame(899999); await frame(810000);
  await store.command({ id: randomUUID(), version: store.state.version, type: 'set-bp-preset', payload: { value: 'single-ban-alternate' } });
  await frame(810000); assert.equal(store.state.bpHistory.length, 0);
  await frame(810001); await frame(810001); assert.equal(store.state.bans.b[0], 'm1');
});
