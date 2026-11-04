import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { currentRound, newSession, transition } from '../server/session/model.js';
import { SessionStore } from '../server/session/store.js';

const command = (s, type, payload = {}) => transition(s, { id: randomUUID(), version: s.version, type, payload });
const apply = (s, index) => command(s, 'apply-bp', { entryId: `m${index}`, actionId: s.action.id });
const finish = s => command(command(s, 'start'), 'ranking');
const choose = (s, team, kind) => command(s, 'select-bp-action', { team, kind });
const order = s => [s.action, ...s.queue].filter(Boolean).map(a => [a.kind, a.team, a.slot, a.ordinal]);
const correct = (s, entryId, extra = {}) => command(s, 'correct-ban', { team: 'a', slot: 0, entryId, empty: false, ...extra });
function setup() {
  const pool = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, beatmapId: 810000 + i, label: `NM${i}`, mod: 'NM' }));
  pool.push(...['HD', 'HD', 'TB'].map((mod, i) => ({ id: `extra${i}`, beatmapId: 820000 + i, label: `${mod}${i}`, mod })));
  const s = command(newSession(), 'setup', { title: '隔离 BP 修正验证', stage: 'group', mode: '4v4', source: '4x3',
    teams: { a: { name: 'A', roster: [] }, b: { name: 'B', roster: [] } }, pool });
  return command(s, 'set-roll', { winner: 'b', banFirst: 'a', pickFirst: 'b' });
}
function afterSecondBans() {
  let s = apply(apply(setup(), 0), 1);
  s = finish(apply(s, 2)); s = finish(apply(s, 3));
  return apply(apply(s, 4), 5);
}

test('promoting the other first Pick retains the displaced Pick, both second Bans and the later alternating pairs', () => {
  let s = apply(apply(setup(), 0), 1);
  const before = structuredClone(s);
  s = choose(s, 'a', 'pick');
  assert.deepEqual(order(s), [['pick', 'a', null, 1], ['pick', 'b', null, 1], ['ban', 'a', 1, undefined], ['ban', 'b', 1, undefined]]);
  const selected = structuredClone(order(s));
  s = choose(s, 'a', 'pick'); assert.deepEqual(order(s), selected);
  s = command(s, 'undo'); s = command(s, 'undo'); assert.deepEqual(order(s), order(before));
  s = choose(s, 'a', 'pick'); s = finish(apply(s, 2));
  assert.equal(s.action.team, 'b'); assert.equal(s.action.kind, 'pick');
  s = finish(apply(s, 3)); s = apply(apply(s, 4), 5);
  assert.deepEqual(order(s).slice(0, 2), [['pick', 'b', null, 2], ['pick', 'a', null, 2]]);
});

test('promoting a Pick before a pending Ban returns that exact Ban to the queue head', () => {
  let s = apply(setup(), 0); const displaced = structuredClone(s.action);
  s = choose(s, 'b', 'pick'); assert.deepEqual(s.queue[0], displaced);
  s = finish(apply(s, 1)); assert.deepEqual(s.action, displaced);
  s = apply(s, 2); assert.equal(s.action.kind, 'pick'); assert.equal(s.action.team, 'a');
});

test('legacy preparation promotes the selected Pick without clearing the known order', () => {
  let s = apply(apply(setup(), 0), 1);
  s = command(s, 'prepare-round', { entryId: 'm2', pickedBy: 'a' });
  assert.equal(s.bpFlow.mode, 'roll'); assert.equal(currentRound(s).bpAction.ordinal, 1);
  s = finish(s); assert.equal(s.action.kind, 'pick'); assert.equal(s.action.team, 'b');
});

test('promoting an action in an explicit manual queue preserves the displaced action and its manual order', () => {
  let s = command(setup(), 'set-action', { action: { kind: 'pick', team: 'b' }, queue: [{ kind: 'pick', team: 'a' }, { kind: 'ban', team: 'b', slot: 1 }] });
  const before = s.action; s = choose(s, 'a', 'pick');
  assert.deepEqual(s.queue[0], before); assert.equal(s.queue[1].kind, 'ban'); assert.equal(s.bpFlow.mode, 'manual');
});

test('editing Ban 1 after Ban 2 preserves the live run, cursor, scores, other slots and undo', () => {
  let s = afterSecondBans(); s = command(apply(s, 6), 'start');
  s = command(s, 'map-mark', { entryId: 'm0', status: 'banned', team: 'a' });
  const before = structuredClone(s);
  const changed = correct(s, 'm7');
  assert.deepEqual(changed.bans, { a: ['m7', 'm4'], b: ['m1', 'm5'] });
  for (const key of ['rounds', 'currentRoundId', 'action', 'queue', 'bpFlow', 'bpHistory', 'phase', 'scene', 'auto', 'seriesAdjustment', 'ex']) {
    assert.deepEqual(changed[key], before[key], key);
  }
  assert.ok(!changed.poolMarks.some(mark => mark.entryId === 'm0'));
  assert.deepEqual(changed.poolMarks.find(mark => mark.entryId === 'm7'), { entryId: 'm7', status: 'banned', team: 'a' });
  const undone = command(changed, 'undo');
  for (const key of ['bans', 'emptyBans', 'poolMarks', 'rounds', 'action', 'queue']) assert.deepEqual(undone[key], before[key], key);
});

test('Ban slots distinguish empty Ban and unknown without rewinding or recreating old Bans', () => {
  const s = afterSecondBans(); const cursor = structuredClone(s.action);
  let changed = correct(s, null, { empty: true }); assert.equal(changed.emptyBans.a[0], true);
  changed = correct(changed, null); assert.equal(changed.emptyBans.a[0], false);
  changed = finish(apply(changed, 6));
  assert.equal(changed.action.kind, 'pick'); assert.equal(changed.action.team, 'a');
  assert.equal(cursor.team, 'b');
});

test('Ban corrections reject occupied maps, TB, duplicate limited mods and malformed slots atomically', () => {
  const s = afterSecondBans(); const before = structuredClone(s);
  for (const [id, extra, expected] of [
    ['m1', {}, /其他 Ban/], ['m2', {}, /已选用或已打/], ['extra2', {}, /TB/],
    ['missing', {}, /本场图池/], ['m7', { slot: 2 }, /Ban 1/], ['m7', { empty: true }, /内容无效/],
  ]) assert.throws(() => correct(s, id, extra), expected);
  assert.deepEqual(s, before);
  const hd = correct(s, 'extra0');
  assert.throws(() => correct(hd, 'extra1', { slot: 1 }), /重复 Ban/);
});

test('correcting a historic Ban does not prevent replaying the latest finished map', () => {
  let s = afterSecondBans(); s = finish(apply(s, 6)); s = correct(s, 'm7');
  s = command(s, 'referee-replay', { reason: '裁判确认重赛' });
  assert.equal(currentRound(s).status, 'prepared'); assert.equal(currentRound(s).entryId, 'm6');
  assert.equal(s.bans.a[0], 'm7');
});

test('a marker-only Ban selection never consumes a pending Pick with the recent room map', async () => {
  let s = afterSecondBans(); s = command(s, 'auto', { ...s.auto, profile: 'stable-tourney', left: 'L', right: 'R' });
  const store = new SessionStore({ state: s });
  const frame = id => store.frame({ beatmap: { id }, tourney: { ipcState: 1, teams: { left: 'L', right: 'R' },
    totalScore: { left: 0, right: 0 }, players: [{ side: 'left', osuId: 1 }, { side: 'right', osuId: 2 }] } });
  try {
    await frame(899999); await frame(810006);
    const before = structuredClone(store.state);
    assert.equal(store.currentRoomMap(store.state).id, 'm6');
    await store.command({ id: randomUUID(), version: store.state.version, type: 'select-bp-action', payload: { team: 'a', kind: 'ban', applyRoomMap: true } });
    assert.deepEqual(store.state.action, before.action); assert.deepEqual(store.state.rounds, before.rounds);
    assert.equal(store.state.poolChoice.kind, 'ban');
  } finally { store.close(); }
});
