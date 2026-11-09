import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newSession, transition, currentRound, seriesOf, bpProgress } from '../server/session/model.js';
import { SessionStore } from '../server/session/store.js';
import { attachBroadcast } from '../server/session/data.js';
import { followScene } from '../server/session/presentation.js';

const send = (state, type, payload = {}) => transition(state, { id: randomUUID(), version: state.version, type, payload });
function setup(exhibition = false) {
  return send(newSession(), exhibition ? 'import-streaming' : 'setup', {
    title: 'Review regression', stage: exhibition ? 'exhibition' : 'group', mode: '3v3', source: '4x3',
    teams: { a: { name: 'L', roster: [] }, b: { name: 'R', roster: [] } },
    pool: [1, 2, 3, 4].map(i => ({ id: `m${i}`, beatmapId: i, mod: 'NM', label: `NM${i}` })),
    ...(exhibition ? { exhibition: { roundName: 'Review', series: { type: 'first_to', wins: 3 }, autoResults: true, tiedMapPolicy: 'require_replay' } } : {}),
  });
}
const prepared = () => send(send(setup(), 'bp'), 'prepare-round', { entryId: 'm1', pickedBy: 'a' });
const command = (store, type, payload = {}) => store.command({ id: randomUUID(), version: store.state.version, type, payload });
const frame = ipc => ({ beatmap: { id: 1 }, tourney: { ipcState: ipc, teams: { left: 'L', right: 'R' },
  totalScore: { left: 900, right: 800 }, players: [{ side: 'left', osuId: 1, score: 900 }, { side: 'right', osuId: 2, score: 800 }] } });

test('same-team EX correction before a late result is authoritative through correction and replay', () => {
  let state = send(prepared(), 'ex', { team: 'a', remaining: { a: 2, b: 2 } });
  state = send(send(state, 'start'), 'finish-round', { roundId: currentRound(state).id });
  const id = currentRound(state).id;
  state = send(state, 'ex', { team: 'a', remaining: { a: 1, b: 2 } });
  state = send(state, 'record-result', { roundId: id, winner: 'a' });
  assert.equal(state.ex.remaining.a, 1); assert.deepEqual(seriesOf(state), { a: 1, b: 0 });
  state = send(state, 'correct-result', { roundId: id, winner: 'b', reason: '核对' });
  assert.equal(state.ex.remaining.a, 1);
  state = send(state, 'referee-replay', { reason: '裁判重赛' });
  assert.equal(state.ex.remaining.a, 1);
  state = send(send(state, 'start'), 'ranking');
  state = send(state, 'record-result', { roundId: currentRound(state).id, winner: 'a' });
  assert.equal(state.ex.remaining.a, 0);
});

test('exhibition manual openings and phase jumps never generate implicit bans', () => {
  let state = send(setup(true), 'select-bp-action', { team: 'a', kind: 'ban' });
  assert.equal(state.action.kind, 'ban'); assert.ok(state.queue.every(action => action.kind === 'pick'));
  state = send(state, 'apply-bp', { entryId: 'm1' });
  assert.equal(state.action.kind, 'pick');
  for (const phase of ['ban1', 'ban2']) assert.throws(() => send(setup(true), 'jump-bp-phase', { phase }), /表演赛/);
  state = send(setup(true), 'select-bp-action', { team: 'b', kind: 'pick' });
  assert.equal(state.action.team, 'b'); assert.deepEqual(state.queue.map(action => [action.kind, action.team]), [['pick', 'a']]);
  state = send(setup(true), 'jump-bp-phase', { phase: 'pick1' });
  assert.ok([state.action, ...state.queue].every(action => action.kind === 'pick'));
  state = send(setup(true), 'set-action', { action: { kind: 'ban', team: 'a', slot: 0 } });
  state = send(state, 'apply-bp', { entryId: 'm1' });
  assert.equal(state.action, null); assert.deepEqual(state.queue, []);
});

test('replacing map and Pick owner stays retractable as one selection, later real BP stays protected', () => {
  let state = prepared(); const selectionId = currentRound(state).selectionId;
  state = send(state, 'prepare-round', { entryId: 'm2', pickedBy: 'b' });
  const retract = bpProgress(state).retract;
  assert.equal(retract.canRetract, true); assert.equal(retract.selectionId, selectionId);
  assert.throws(() => send(state, 'retract-bp', { actionId: 'stale-action', selectionId }), /目标已变化/);
  state = send(state, 'retract-bp', { actionId: retract.actionId, selectionId });
  assert.equal(currentRound(state), null); assert.equal(state.action.team, 'b');
  assert.ok(state.bpHistory.every(event => event.retracted));
  state = send(state, 'apply-bp', { entryId: 'm3' });
  state = send(send(state, 'start'), 'ranking');
  state = send(state, 'set-action', { action: { kind: 'ban', team: 'a', slot: 0 } });
  state = send(state, 'apply-bp', { entryId: 'm4' });
  assert.throws(() => send(state, 'retract-bp', { actionId: retract.actionId, selectionId }), /后续|开始|撤回/);
  assert.equal(state.bans.a[0], 'm4');
});

for (const kind of ['pick', 'resume', 'winner']) test(`${kind} deadline retries a failed save without losing or retargeting its intent`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const store = new SessionStore({ state: setup() }); t.after(() => store.close());
  if (kind === 'pick') { await command(store, 'bp'); await command(store, 'prepare-round', { entryId: 'm1', pickedBy: 'a' }); }
  if (kind === 'resume') { await command(store, 'pause'); await command(store, 'resume-soon'); }
  if (kind === 'winner') { await command(store, 'set-series', { a: 6, b: 0, reason: '终局' }); await command(store, 'winner-soon', { team: 'a' }); }
  const before = structuredClone(store.state); const save = store.save.bind(store);
  store.save = async () => { throw new Error('test save failure'); };
  t.mock.timers.tick(kind === 'resume' ? 10000 : 5000); await store.tail; await Promise.resolve();
  assert.deepEqual(store.state, before);
  store.save = save;
  t.mock.timers.tick(1000); await store.tail; await Promise.resolve();
  if (kind === 'pick') assert.equal(store.state.scene, 'playing');
  if (kind === 'resume') assert.equal(store.state.paused, false);
  if (kind === 'winner') assert.equal(store.state.winner, 'a');
  const version = store.state.version;
  t.mock.timers.tick(10000); await store.tail; assert.equal(store.state.version, version);
});

test('failed source-loss save preserves evidence; adapter handles rejection and a later retry commits once', async t => {
  const store = new SessionStore({ state: prepared() }); t.after(() => store.close());
  await store.frame(frame(1), 1000); await store.frame(frame(3), 1500);
  const observers = [store.automation, store.readyReturn, store.spectatorRecovery, store.seriesCorrection];
  const before = observers.map(observer => observer.checkpoint()); const state = structuredClone(store.state);
  const save = store.save.bind(store); store.save = async () => { throw new Error('test save failure'); };
  await assert.rejects(store.sourceStatus('disconnected'), /test save failure/);
  assert.deepEqual(store.state, state); assert.deepEqual(observers.map(observer => observer.checkpoint()), before);
  let listener;
  const detach = attachBroadcast(store, { subscribe(fn) { listener = fn; return () => {}; }, start() {}, stop() {} }); t.after(detach);
  const snapshot = { tosu: { status: 'disconnected' }, oclr: { status: 'idle', updatedAt: null, error: null }, selection: { edition: null } };
  listener(snapshot); await store.tail; await Promise.resolve();
  assert.match(store.live.note, /未保存/);
  store.save = save; listener({ ...snapshot, tosu: { status: 'live', frameSeq: 1, data: frame(4) } }); await store.tail;
  assert.equal(store.state.incident?.source, 'tosu');
  assert.equal(store.automation.observedRun, null);
  assert.deepEqual(seriesOf(store.state), { a: 0, b: 0 });
});

test('v2 reload validates current references, replay graph, result/selection projections and undo without repairing', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-review-')); t.after(() => rm(dir, { recursive: true }));
  const file = join(dir, 'session.json'); const state = prepared();
  await writeFile(file, JSON.stringify(state)); const store = await SessionStore.open(file); store.close();
  assert.deepEqual(store.state, state);
  const mutations = [
    s => { s.currentRoundId = 'missing'; },
    s => { s.rounds.push(structuredClone(s.rounds[0])); },
    s => { s.rounds[0].replayOf = 'missing'; },
    s => { s.rounds[0].replayOf = s.rounds[0].id; },
    s => { s.currentSelectionId = 'wrong'; },
    s => {
      const parent = s.rounds[0]; const child = { ...parent, id: 'other-attempt', attemptId: 'other-attempt', resultId: 'result:other-attempt', replayOf: parent.id };
      s.rounds.push(child); s.results[child.resultId] = { ...s.results[parent.resultId], id: child.resultId, attemptId: child.id };
    },
    s => { s.results[s.rounds[0].resultId].attemptId = 'wrong'; },
    s => { s.rounds[0].selectionId = 'wrong'; },
    s => { s.pendingResults = [s.rounds[0].id]; },
    s => { s.undo.at(-1).state.currentRoundId = 'missing'; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(state); mutate(invalid); const text = JSON.stringify(invalid); await writeFile(file, text);
    await assert.rejects(SessionStore.open(file), /INVALID|RESTORE/);
    const { readFile } = await import('node:fs/promises'); assert.equal(await readFile(file, 'utf8'), text);
  }
});

test('presentation changes scene only, never competition phase', () => {
  const state = prepared(); state.phase = 'playing';
  followScene(state, 'mappool', { returnToBp: true });
  assert.equal(state.phase, 'playing'); assert.equal(state.scene, 'mappool');
});
