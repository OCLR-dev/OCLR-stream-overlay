import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newSession, transition, currentRound, seriesOf } from '../server/session/model.js';
import { SessionStore } from '../server/session/store.js';
import { RoomAutomation } from '../server/session/automation.js';
import { catalogue, attachBroadcast } from '../server/session/data.js';
import { BroadcastData } from '../src/index.js';

let counter = 0;
const command = (state, type, payload = {}, id = `cmd-${++counter}`) => transition(state, { id, version: state.version, type, payload });
const pool = [
  { id: 'hd1', label: 'HD1', mod: 'HD', beatmapId: 101 }, { id: 'hd2', label: 'HD2', mod: 'HD', beatmapId: 102 },
  { id: 'nm1', label: 'NM1', mod: 'NM', beatmapId: 103 }, { id: 'nm2', label: 'NM2', mod: 'NM', beatmapId: 104 },
  { id: 'dt1', label: 'DT1', mod: 'DT', beatmapId: 105 }, { id: 'tb', label: 'TB', mod: 'TB', beatmapId: 106 },
  ...Array.from({ length: 10 }, (_, i) => ({ id: `fm${i}`, label: `FM${i}`, mod: 'FM', beatmapId: 200 + i })),
];
const setup = () => command(newSession(), 'setup', { title: 'Test match', stage: 'group', mode: '4v4', source: '4x3', teams: { a: { name: 'Red', roster: [] }, b: { name: 'Blue', roster: [] } }, pool });
const ready = () => command(command(setup(), 'bp'), 'auto', { bp: true, scenes: true, locked: false, profile: 'stable-tourney', left: 'Red room', right: 'Blue room' });
const action = (s, kind, team = 'a', slot = 0, queue = []) => command(s, 'set-action', { action: { kind, team, slot }, queue });
const pick = (s, id = 'nm1') => { const next = action(s, 'pick'); return command(next, 'apply-bp', { entryId: id, actionId: next.action.id }); };
const frame = (mapId = 999, ipc = 1, extra = {}) => {
  const totalScore = extra.totalScore || { left: 0, right: null };
  return { beatmap: { id: mapId }, tourney: { ipcState: ipc, teams: { left: 'Red room', right: 'Blue room' },
    players: [{ side: 'left', osuId: 1, score: totalScore.left }, { side: 'right', osuId: 2, score: totalScore.right }], totalScore, ...extra } };
};
function simulate(state) {
  const observer = new RoomAutomation();
  let s = state;
  let time = 0;
  return { get state() { return s; }, observer,
    feed(map, ipc = 1, ms = 500, extra) { time += ms; const result = observer.ingest(s, frame(map, ipc, extra), time); s = result.state; return result; },
    manual(type, payload) { s = command(s, type, payload); observer.reset(); },
    change(map, ipc = 1) { this.feed(map, ipc); return this.feed(map, ipc); },
  };
}

test('manual full match retains Roll/Bans, records each round once, reaches Winner only by result command', () => {
  let s = setup();
  s = command(s, 'arrival', { team: 'a', arrived: true, ready: true });
  s = command(s, 'begin-roll');
  s = command(s, 'roll', { a: 90, b: 45, winner: 'a', pickFirst: 'b', banFirst: 'a', enterBp: false });
  assert.equal(s.scene, 'roll');
  s = command(s, 'bp');
  s = action(s, 'ban'); s = command(s, 'apply-bp', { entryId: 'hd1', actionId: s.action.id });
  for (let i = 0; i < 6; i++) {
    s = pick(s, `fm${i}`); s = command(s, 'start');
    const id = currentRound(s).id;
    s = command(s, 'ranking');
    assert.equal(seriesOf(s).a, i);
    const result = { id: `result-${i}`, version: s.version, type: 'record-result', payload: { roundId: id, winner: 'a' } };
    s = transition(s, result);
    assert.equal(transition(s, result), s);
    assert.throws(() => command(s, 'record-result', result.payload), /已记录/);
  }
  assert.deepEqual(seriesOf(s), { a: 6, b: 0 });
  assert.equal(s.scene, 'victory'); assert.equal(s.winner, 'a');
  assert.equal(s.roll.pickFirst, 'b'); assert.equal(s.roll.banFirst, 'a'); assert.equal(s.bans.a[0], 'hd1');
});

test('stage changes preserve live BP, match provenance, scores and undo independently', () => {
  let s = action(ready(), 'ban');
  s = command(s, 'apply-bp', { entryId: 'hd1' });
  s = pick(s);
  s = command(s, 'set-series', { a: 2, b: 1, reason: 'test score' });
  const before = structuredClone(s);
  s = command(s, 'set-stage', { stage: 'final' });
  assert.equal(s.match.stage, 'final');
  assert.deepEqual({ ...s.match, stage: before.match.stage }, before.match);
  for (const key of ['pool', 'bans', 'rounds', 'roll', 'action', 'queue', 'auto', 'locked', 'scene', 'phase']) assert.deepEqual(s[key], before[key]);
  assert.deepEqual(seriesOf(s), { a: 2, b: 1 });
  assert.equal(command(s, 'undo').match.stage, 'group');
  assert.throws(() => command(s, 'set-stage', { stage: 'unknown' }), /比赛阶段无效/);
});

test('stage target changes invalidate an early Winner and reject scores beyond the new target', () => {
  let s = command(ready(), 'set-series', { a: 6, b: 0, reason: 'test score' });
  s = command(s, 'winner', { team: 'a' });
  s = command(s, 'set-stage', { stage: 'final' });
  assert.equal(s.winner, null); assert.equal(s.phase, 'bp'); assert.equal(s.scene, 'mappool');
  assert.throws(() => command(s, 'winner', { team: 'a' }), /尚未达到/);
  s = command(s, 'set-series', { a: 7, b: 0, reason: 'test final score' });
  assert.throws(() => command(s, 'set-stage', { stage: 'group' }), /超出该阶段目标/);
  assert.equal(s.match.stage, 'final'); assert.equal(seriesOf(s).a, 7);
});

test('stage update between final Ranking frames preserves automatic result continuity', async () => {
  const store = new SessionStore({ state: pick(ready()) });
  await store.frame(frame(103, 1), 1000);
  await store.frame(frame(103, 3), 1500);
  const final = frame(103, 4, { totalScore: { left: 900, right: 800 } });
  await store.frame(final, 2000);
  await store.command({ id: 'stage-during-ranking', version: store.state.version, type: 'set-stage', payload: { stage: 'final' } });
  await store.frame(final, 2500);
  assert.equal(store.state.match.stage, 'final'); assert.equal(store.state.scene, 'map-result');
  assert.deepEqual(seriesOf(store.state), { a: 1, b: 0 });
  await store.frame(final, 3000);
  assert.deepEqual(seriesOf(store.state), { a: 1, b: 0 });
});

test('BP validates concrete entries, TB, duplicate mod, occupied slots and prepared replacement', () => {
  let s = command(setup(), 'bp');
  s = action(s, 'ban');
  assert.throws(() => command(s, 'apply-bp', { entryId: 'tb' }), /TB/);
  s = command(s, 'apply-bp', { entryId: 'hd1' }); s = action(s, 'ban', 'a', 1);
  assert.throws(() => command(s, 'apply-bp', { entryId: 'hd2' }), /重复 Ban/);
  s = command(s, 'apply-bp', { entryId: 'nm1' }); s = action(s, 'ban', 'b', 0);
  assert.throws(() => command(s, 'apply-bp', { entryId: 'hd1' }), /已经 Ban/);
  s = pick(s, 'nm2'); const id = currentRound(s).id;
  s = command(s, 'apply-bp', { entryId: 'dt1' });
  assert.equal(currentRound(s).id, id); assert.equal(s.rounds.length, 1); assert.equal(currentRound(s).entryId, 'dt1');
});

test('commands enforce revision, reject reused result semantics and undo leaves a revision trail', () => {
  const s = action(ready(), 'ban');
  const c = { id: 'unique', version: s.version, type: 'apply-bp', payload: { entryId: 'hd1' } };
  const next = transition(s, c);
  assert.equal(transition(next, c), next);
  assert.throws(() => transition(next, { ...c, id: 'other' }), /会话已被/);
  const undone = command(next, 'undo');
  assert.equal(undone.bans.a[0], null); assert.equal(undone.version, next.version + 1); assert.equal(undone.history.at(-1).message.startsWith('撤销'), true);
  assert.equal(transition(undone, c), undone);
});

test('Ban → Ban → Pick consumes each stable room map once and explicit queue belongs to the right team', () => {
  const sim = simulate(action(ready(), 'ban', 'a', 0, [{ kind: 'ban', team: 'b', slot: 0 }, { kind: 'pick', team: 'a' }]));
  sim.feed(999); sim.change(101);
  assert.equal(sim.state.bans.a[0], 'hd1');
  sim.feed(101); sim.feed(101);
  assert.equal(sim.state.bans.b[0], null);
  sim.change(103); assert.equal(sim.state.bans.b[0], 'nm1');
  sim.change(105); assert.equal(currentRound(sim.state).pickedBy, 'a');
  assert.equal(sim.state.phase, 'bp'); assert.equal(sim.state.scene, 'mappool');
  const id = currentRound(sim.state).id;
  sim.change(104); assert.equal(currentRound(sim.state).entryId, 'nm2'); assert.equal(currentRound(sim.state).id, id); assert.equal(sim.state.rounds.length, 1);
});

test('same map in multiple slots, warmups, occupied maps and wrong room never advance BP', () => {
  let s = action(ready(), 'ban'); s = structuredClone(s); s.pool.push({ ...s.pool[0], id: 'other-hd', label: 'HD3' });
  const sim = simulate(s);
  sim.feed(999); assert.match(sim.change(101).note, /多个槽位/);
  assert.equal(sim.state.bans.a[0], null); assert.match(sim.feed(101).note, /多个槽位/);
  assert.match(sim.change(9999).note, /不在本场/);
  sim.change(103); assert.equal(sim.state.bans.a[0], 'nm1');
  sim.manual('set-action', { action: { kind: 'ban', team: 'b', slot: 0 } });
  sim.feed(104, 1, 500, { teams: { left: 'wrong', right: 'Blue room' } });
  sim.feed(104); assert.equal(sim.state.bans.b[0], null);
  assert.match(sim.change(103).note, /已 Ban/);
});

test('first connection, reconnect, invalid frames, pause establish baselines without replay', () => {
  const sim = simulate(action(ready(), 'ban'));
  sim.feed(101); sim.feed(101); assert.equal(sim.state.bans.a[0], null);
  sim.change(103); assert.equal(sim.state.bans.a[0], 'nm1');
  sim.manual('undo'); sim.feed(103); sim.feed(103); assert.equal(sim.state.bans.a[0], null);
  sim.manual('pause', { kind: 'technical' }); sim.change(104); assert.equal(sim.state.scene, 'pause');
  sim.manual('resume'); sim.feed(104); sim.feed(104); assert.equal(sim.state.bans.a[0], null);
  sim.manual('pause', { kind: 'technical' }); sim.change(105); assert.equal(sim.state.bans.a[0], null);
  sim.manual('resume'); sim.feed(105); sim.feed(105); assert.equal(sim.state.bans.a[0], null);
  sim.observer.reset(); sim.feed(101); sim.feed(101); assert.equal(sim.state.bans.a[0], null);
  sim.feed(0); sim.feed(104); sim.feed(104); assert.equal(sim.state.bans.a[0], null);
});

test('pending map bound to old BP action cannot be consumed by a new manual action', () => {
  let s = action(ready(), 'ban'); const o = new RoomAutomation();
  o.ingest(s, frame(999), 0); o.ingest(s, frame(101), 100);
  s = action(s, 'ban', 'b');
  const result = o.ingest(s, frame(101), 700);
  assert.match(result.note, /动作已结束/); assert.deepEqual(result.state.bans, { a: [null, null], b: [null, null] });
});

test('Playing edge starts prepared round; continuous 3→4 shows Ranking while missing final scores keep wins unknown', () => {
  const sim = simulate(pick(ready()));
  sim.feed(103); sim.feed(103, 3); assert.equal(sim.state.scene, 'playing');
  sim.feed(103, 4, 10); assert.equal(sim.state.scene, 'playing');
  sim.feed(103, 4, 300); assert.equal(sim.state.scene, 'map-result');
  assert.deepEqual(seriesOf(sim.state), { a: 0, b: 0 }); assert.deepEqual(currentRound(sim.state).finalScore, { a: 0, b: null });
  const version = sim.state.version; sim.feed(103, 4); assert.equal(sim.state.version, version);
  sim.change(105); assert.equal(sim.state.scene, 'mappool'); assert.equal(currentRound(sim.state).status, 'ranking');
});

test('Ranking first frame, interrupted play, stale gaps and same-map replays do not reuse prior end events', () => {
  const sim = simulate(pick(ready()));
  sim.feed(103, 4); sim.feed(103, 4); assert.equal(sim.state.scene, 'mappool');
  sim.feed(103, 1); sim.feed(103, 3); const runId = currentRound(sim.state).runId;
  sim.feed(103, 2); sim.feed(103, 4); sim.feed(103, 4); assert.equal(sim.state.scene, 'playing');
  sim.manual('replay', { reason: 'disconnect' });
  assert.equal(sim.state.rounds[0].status, 'void'); assert.notEqual(currentRound(sim.state).id, sim.state.rounds[0].id);
  sim.feed(103, 1); sim.feed(103, 3); assert.notEqual(currentRound(sim.state).runId, runId);
  sim.feed(103, 4, 6000); sim.feed(103, 4); assert.equal(sim.state.scene, 'playing');
});

test('map stabilizing while Playing begins preserves new edge; initial Playing baseline cannot start an unobserved run', () => {
  const sim = simulate(action(ready(), 'pick'));
  sim.feed(999); sim.feed(103, 1); sim.feed(103, 3, 10); sim.feed(103, 3, 500);
  assert.equal(sim.state.scene, 'playing');
  const reconnect = simulate(pick(ready())); reconnect.feed(103, 3); reconnect.feed(103, 3);
  assert.equal(reconnect.state.scene, 'playing');
  assert.equal(currentRound(reconnect.state).status, 'prepared');
  assert.equal(currentRound(reconnect.state).runId, null);
  reconnect.feed(103, 4); reconnect.feed(103, 4);
  assert.deepEqual(seriesOf(reconnect.state), { a: 0, b: 0 });
});

test('prestart abort preserves one Pick, EX and queue without creating a replay attempt', () => {
  let s = action(ready(), 'pick', 'a', 0, [{ kind: 'pick', team: 'b' }]);
  s = command(s, 'apply-bp', { entryId: 'nm1' });
  s = command(s, 'ex', { team: 'a', remaining: { a: 1, b: 2 } });
  const before = structuredClone(s);
  s = command(s, 'incident', { kind: 'abort', reason: '选完图客户端卡住，尚未开打' });
  assert.equal(s.incident.kind, 'prestart-abort');
  assert.throws(() => command(s, 'start'), /异常尚未处理/);
  s = command(s, 'replay', { reason: '取消启动后重新准备' });
  assert.equal(s.incident, null); assert.equal(s.rounds.length, 1);
  assert.deepEqual(currentRound(s), currentRound(before));
  for (const key of ['bans', 'bpHistory', 'queue', 'ex']) assert.deepEqual(s[key], before[key]);
  const sim = simulate(s); sim.feed(103, 2); sim.feed(103, 1); sim.feed(103, 4); sim.feed(103, 4);
  assert.equal(currentRound(sim.state).status, 'prepared'); assert.equal(currentRound(sim.state).runId, null);
  assert.deepEqual(seriesOf(sim.state), { a: 0, b: 0 });
});

test('unexpected exit or missing spectator holds the current run without guessing an abort or a win', () => {
  for (const ipc of [0, 1, 2]) {
    const sim = simulate(pick(ready())); sim.feed(103, 1); sim.feed(103, 3);
    const runId = currentRound(sim.state).runId;
    sim.feed(103, ipc);
    assert.equal(sim.state.incident.kind, 'unverified');
    sim.feed(103, 3); sim.feed(103, 4, 500, { totalScore: { left: 900, right: 800 } }); sim.feed(103, 4);
    assert.equal(currentRound(sim.state).runId, runId); assert.equal(sim.state.rounds.length, 1);
    assert.deepEqual(seriesOf(sim.state), { a: 0, b: 0 });
    assert.throws(() => command(sim.state, 'record-result', { roundId: currentRound(sim.state).id, winner: 'a' }), /填写核对说明/);
  }
  const sim = simulate(pick(ready()));
  const players = [{ side: 'left', osuId: 1 }, { side: 'left', osuId: 3 }, { side: 'right', osuId: 2 }];
  sim.feed(103, 1, 500, { players }); sim.feed(103, 3, 500, { players });
  sim.feed(103, 3);
  assert.equal(sim.state.incident.kind, 'unverified'); assert.match(sim.state.incident.reason, /窗口缺失/);
});

test('Panic or transport recovery continues the same run only after live operator verification', async () => {
  const store = new SessionStore({ state: pick(ready()) });
  const submit = (type, payload) => store.command({ id: `incident-${++counter}`, version: store.state.version, type, payload });
  await store.frame(frame(103, 1), 1000); await store.frame(frame(103, 3), 1500);
  const original = structuredClone(currentRound(store.state));
  await store.sourceStatus('disconnected'); assert.equal(store.state.incident.kind, 'unverified');
  await assert.rejects(submit('resolve-incident', { reason: '尚未恢复不能放行' }), /尚未恢复/);
  await submit('incident', { kind: 'spectator', reason: '仅直播观战端 Panic，比赛未中止' });
  await store.frame(frame(103, 3), 2000);
  await submit('resolve-incident', { reason: '观战恢复并核实原比赛继续' });
  await store.frame(frame(103, 3), 2500); await store.frame(frame(103, 3), 3000);
  await store.frame(frame(103, 4, { totalScore: { left: 900, right: 800 } }), 3500);
  await store.frame(frame(103, 4, { totalScore: { left: 900, right: 800 } }), 4000);
  assert.equal(store.state.incident, null); assert.equal(store.state.rounds.length, 1);
  assert.equal(currentRound(store.state).runId, original.runId); assert.equal(currentRound(store.state).id, original.id);
  assert.deepEqual(seriesOf(store.state), { a: 1, b: 0 });
});

test('referee replay after Ranking restores the next Pick and EX, then counts only the new run', () => {
  let s = action(ready(), 'pick', 'a', 0, [{ kind: 'pick', team: 'b' }]);
  s = command(s, 'apply-bp', { entryId: 'nm1' });
  s = command(s, 'ex', { team: 'a', remaining: { a: 1, b: 2 } });
  const sim = simulate(s); sim.feed(103, 1); sim.feed(103, 3); const old = currentRound(sim.state);
  sim.feed(103, 4); sim.feed(103, 4); assert.equal(sim.state.action.team, 'b');
  const bpHistory = structuredClone(sim.state.bpHistory);
  sim.manual('incident', { kind: 'player-disconnect', reason: '裁判核实选手掉线，待判重赛' });
  sim.manual('replay', { reason: '裁判确认本图重赛' });
  const next = currentRound(sim.state);
  assert.equal(next.replayOf, old.id); assert.equal(next.pickedBy, 'a'); assert.equal(next.entryId, old.entryId);
  assert.equal(sim.state.action, null); assert.equal(sim.state.queue[0].team, 'b');
  assert.deepEqual(sim.state.bpHistory, bpHistory); assert.equal(sim.state.ex.team, 'a'); assert.equal(sim.state.ex.remaining.a, 1);
  sim.feed(103, 4); sim.feed(103, 4); assert.equal(currentRound(sim.state).status, 'prepared');
  sim.feed(103, 1); sim.feed(103, 3); assert.notEqual(currentRound(sim.state).runId, old.runId);
  sim.feed(103, 4, 500, { totalScore: { left: 900, right: 800 } });
  sim.feed(103, 4, 500, { totalScore: { left: 900, right: 800 } });
  assert.deepEqual(seriesOf(sim.state), { a: 1, b: 0 }); assert.equal(sim.state.action.team, 'b');
});

test('an incident that ends during observation loss requires a reasoned manual result and survives persistence', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-incident-')); t.after(() => rm(dir, { recursive: true }));
  const file = join(dir, 'session.json'); const store = new SessionStore({ file, state: pick(ready()) });
  await store.command({ id: 'incident-start', version: store.state.version, type: 'start' });
  await store.sourceStatus('stale');
  const restored = await SessionStore.open(file);
  assert.equal(restored.state.incident.kind, 'unverified');
  const roundId = currentRound(restored.state).id;
  const next = command(restored.state, 'record-result', { roundId, winner: 'b', reviewReason: '裁判核对 MP 成绩，本局有效' });
  assert.equal(next.incident, null); assert.deepEqual(seriesOf(next), { a: 0, b: 1 });
  assert.match(next.history.at(-1).message, /裁判核对/);
});

test('EX/TB and display/pause preserve counters and stable round identity', () => {
  let s = pick(ready()); const id = currentRound(s).id;
  s = command(s, 'ex', { team: 'a', remaining: { a: 1, b: 2 } });
  s = command(s, 'start'); s = command(s, 'pause', { kind: 'technical' });
  assert.equal(s.phase, 'playing'); s = command(s, 'resume'); assert.equal(s.scene, 'playing');
  assert.equal(currentRound(s).id, id); assert.equal(s.ex.remaining.a, 1);
  s = command(s, 'replay', { reason: 'manual rematch' }); s = command(s, 'apply-bp', { entryId: 'tb' });
  assert.equal(s.ex.team, null); assert.throws(() => command(s, 'ex', { team: 'a', remaining: { a: 1, b: 2 } }), /TB/);
});

test('atomic persistence restores progress but never telemetry/observer continuity, snapshots isolate writes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-session-')); t.after(() => rm(dir, { recursive: true }));
  const file = join(dir, 'session.json'); const store = new SessionStore({ file, state: pick(ready()) });
  await store.command({ id: 'start', version: store.state.version, type: 'start' });
  await store.frame(frame(103, 3), 1000);
  const snapshot = store.snapshot(); snapshot.session.scene = 'victory'; assert.equal(store.state.scene, 'playing');
  const restored = await SessionStore.open(file);
  assert.equal(restored.state.scene, 'playing'); assert.equal(restored.live.tosu.data, null);
  await restored.frame(frame(103, 4), 1500); await restored.frame(frame(103, 4), 2000);
  assert.equal(restored.state.scene, 'playing');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).rounds.length, 1);
  await restored.command({ id: 'next-match', version: restored.state.version, type: 'next-match' });
  assert.equal(restored.state.rounds.length, 0);
  const archived = JSON.parse(await readFile(join(dir, 'archive', `${store.state.id}-${restored.state.version - 1}.json`), 'utf8'));
  assert.equal(archived.rounds.length, 1);
});

test('failed persistence does not apply a command', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-write-fail-')); t.after(() => rm(dir, { recursive: true }));
  const store = new SessionStore({ file: dir, state: setup() });
  await assert.rejects(store.command({ id: 'bad-write', version: store.state.version, type: 'bp' }), /保存失败/);
  assert.equal(store.state.phase, 'arrival'); assert.equal(store.persistence, 'error');
});

test('published catalogue maps actual API fields and empty publication stays empty', () => {
  assert.deepEqual(catalogue({ status: 'ready', data: { teams: [], mappools: [], competition: { fixtures: [] } } }), { kind: 'published', capturedOn: null, warnings: [], teams: [], pools: [], fixtures: [] });
  const actual = catalogue({ status: 'ready', data: { teams: [{ id: 'red', name: 'Red', members: [{ osuId: 1, username: 'Player' }] }], mappools: [{ id: 'p', name: 'Pool', entries: [{ id: 'e', beatmapId: 123, category: 'HD', position: 2, metadata: { title: 'Title', difficulty: 'Diff' } }] }] } });
  assert.equal(actual.pools[0].entries[0].label, 'HD2'); assert.equal(actual.pools[0].entries[0].difficulty, 'Diff');
  assert.equal(actual.teams[0].roster[0].name, 'Player');
});

test('single data adapter advances one server session despite multiple subscribers and clears telemetry on source loss', async () => {
  class Socket {
    static last;
    constructor() { Socket.last = this; }
    close() {}
  }
  const store = new SessionStore({ state: action(ready(), 'ban') });
  const data = new BroadcastData({ WebSocketImpl: Socket, tosuWsUrl: 'ws://local-test', staleMs: 60000 });
  const stop = attachBroadcast(store, data);
  const received = [[], []];
  const unsubs = received.map(list => store.subscribe(snapshot => list.push(snapshot.session.version)));
  try {
    const raw = id => ({ state: { number: 2 }, beatmap: { id }, tourney: { ipcState: 1, team: { left: 'Red room', right: 'Blue room' }, clients: [{ team: 'left', user: { id: 1 } }, { team: 'right', user: { id: 2 } }] } });
    Socket.last.onmessage({ data: JSON.stringify(raw(999)) }); await store.tail;
    Socket.last.onmessage({ data: JSON.stringify(raw(101)) }); await store.tail;
    // Advance deterministic debounce clock, retaining the actual adapter's normalized frame.
    store.automation.pending.at -= 500;
    Socket.last.onmessage({ data: JSON.stringify(raw(101)) }); await store.tail;
    assert.equal(store.state.bans.a[0], 'hd1'); assert.equal(store.state.history.at(-1).source, 'tosu');
    assert.deepEqual(received[0], received[1]);
    data.tosu.onStatus('disconnected'); await store.tail;
    assert.equal(store.snapshot().live.tosu.data, null);
  } finally { unsubs.forEach(fn => fn()); stop(); await store.tail; }
});

test('explicit next Pick is ready at Ranking; next map can prepare/play before the previous result is entered', () => {
  let s = action(ready(), 'pick', 'a', 0, [{ kind: 'pick', team: 'b' }]);
  s = command(s, 'apply-bp', { entryId: 'nm1' });
  const sim = simulate(s);
  sim.feed(103); sim.feed(103, 3); sim.feed(103, 4); sim.feed(103, 4);
  const previous = currentRound(sim.state).id;
  assert.equal(sim.state.action.team, 'b');
  sim.change(105); assert.equal(currentRound(sim.state).entryId, 'dt1'); assert.equal(sim.state.scene, 'mappool');
  sim.feed(105, 3); const nextId = currentRound(sim.state).id;
  assert.equal(sim.state.scene, 'playing');
  sim.manual('record-result', { roundId: previous, winner: 'a' });
  assert.equal(sim.state.scene, 'playing'); assert.equal(sim.state.phase, 'playing');
  assert.equal(currentRound(sim.state).id, nextId); assert.equal(currentRound(sim.state).status, 'playing');
  assert.deepEqual(seriesOf(sim.state), { a: 1, b: 0 });
});

test('normal Ranking automatically awards the winner exactly once, shows the result, and waits for operator Winner display', () => {
  const sim = simulate(pick(ready()));
  const scores = { totalScore: { left: 1234567, right: 1234000 } };
  sim.feed(103, 1); sim.feed(103, 3);
  sim.feed(103, 4, 500, scores); sim.feed(103, 4, 500, scores);
  assert.deepEqual(seriesOf(sim.state), { a: 1, b: 0 });
  assert.equal(currentRound(sim.state).resultSource, 'tosu');
  assert.equal(sim.state.scene, 'map-result'); assert.equal(sim.state.winner, null);
  const version = sim.state.version;
  sim.feed(103, 4, 500, scores); sim.feed(103, 4, 500, scores);
  assert.equal(sim.state.version, version); assert.deepEqual(seriesOf(sim.state), { a: 1, b: 0 });
  sim.observer.reset(); sim.feed(103, 4, 500, scores); sim.feed(103, 4, 500, scores);
  assert.deepEqual(seriesOf(sim.state), { a: 1, b: 0 });
});

test('late or changing Ranking totals wait for stable values; ties and missing scores never guess the winner', () => {
  const sim = simulate(pick(ready()));
  sim.feed(103); sim.feed(103, 3);
  sim.feed(103, 4); sim.feed(103, 4); assert.equal(currentRound(sim.state).status, 'ranking');
  sim.feed(103, 4, 500, { totalScore: { left: 100, right: 100 } });
  sim.feed(103, 4, 500, { totalScore: { left: 100, right: 100 } }); assert.deepEqual(seriesOf(sim.state), { a: 0, b: 0 });
  sim.feed(103, 4, 500, { totalScore: { left: 100, right: 200 } });
  sim.feed(103, 4, 100, { totalScore: { left: 100, right: 300 } }); assert.equal(currentRound(sim.state).status, 'ranking');
  sim.feed(103, 4, 500, { totalScore: { left: 100, right: 300 } });
  assert.deepEqual(seriesOf(sim.state), { a: 0, b: 1 });
});

test('operator can retract an automatic win, old Ranking cannot reapply it, and a corrected manual result counts once', () => {
  const sim = simulate(pick(ready())); const totals = { totalScore: { left: 200, right: 100 } };
  sim.feed(103); sim.feed(103, 3); sim.feed(103, 4, 500, totals); sim.feed(103, 4, 500, totals);
  const roundId = currentRound(sim.state).id;
  sim.manual('retract-result', { roundId, reason: '裁判判定该局结算异常' });
  assert.deepEqual(seriesOf(sim.state), { a: 0, b: 0 });
  sim.feed(103, 4, 500, totals); sim.feed(103, 4, 500, totals);
  assert.deepEqual(seriesOf(sim.state), { a: 0, b: 0 });
  sim.manual('record-result', { roundId, winner: 'b' });
  assert.deepEqual(seriesOf(sim.state), { a: 0, b: 1 });
  assert.equal(currentRound(sim.state).resultSource, 'manual');
  assert.equal(sim.state.history.some(item => item.message.includes('撤回本图计胜')), true);
});

test('manual absolute series correction survives old frames and future wins accumulate from the corrected score', () => {
  const sim = simulate(pick(ready())); const totals = { totalScore: { left: 200, right: 100 } };
  sim.feed(103); sim.feed(103, 3); sim.feed(103, 4, 500, totals); sim.feed(103, 4, 500, totals);
  sim.manual('set-series', { a: 0, b: 1, reason: '以裁判核对的系列比分为准' });
  assert.deepEqual(seriesOf(sim.state), { a: 0, b: 1 });
  sim.feed(103, 4, 500, totals); sim.feed(103, 4, 500, totals);
  assert.deepEqual(seriesOf(sim.state), { a: 0, b: 1 });
  sim.manual('bp'); sim.manual('set-action', { action: { kind: 'pick', team: 'a' } });
  sim.manual('apply-bp', { entryId: 'nm2' });
  sim.feed(104); sim.feed(104, 3); sim.feed(104, 4, 500, totals); sim.feed(104, 4, 500, totals);
  assert.deepEqual(seriesOf(sim.state), { a: 1, b: 1 });
  assert.throws(() => command(sim.state, 'set-series', { a: 9, b: 0, reason: 'bad' }), /系列比分/);
  assert.throws(() => command(sim.state, 'set-series', { a: 0, b: 0, reason: '' }), /原因/);
});

test('a sixth automatic win stays on Ranking, Winner is explicit, and correction/retraction can reverse Winner', () => {
  const sim = simulate(ready());
  const totals = { totalScore: { left: 200, right: 0 } };
  for (let i = 0; i < 6; i++) {
    sim.manual('bp'); sim.manual('set-action', { action: { kind: 'pick', team: 'a' } }); sim.manual('apply-bp', { entryId: `fm${i}` });
    sim.feed(200 + i); sim.feed(200 + i, 3); sim.feed(200 + i, 4, 500, totals); sim.feed(200 + i, 4, 500, totals);
  }
  assert.deepEqual(seriesOf(sim.state), { a: 6, b: 0 }); assert.equal(sim.state.scene, 'map-result'); assert.equal(sim.state.winner, null);
  sim.change(209); assert.equal(sim.state.scene, 'map-result');
  sim.manual('winner', { team: 'a' }); assert.equal(sim.state.scene, 'victory');
  sim.manual('correct-result', { roundId: currentRound(sim.state).id, winner: 'b', reason: '裁判纠正胜方' });
  assert.deepEqual(seriesOf(sim.state), { a: 5, b: 1 }); assert.equal(sim.state.winner, null); assert.equal(sim.state.scene, 'map-result');
  sim.manual('undo'); assert.deepEqual(seriesOf(sim.state), { a: 6, b: 0 }); assert.equal(sim.state.winner, 'a');
  sim.manual('retract-result', { roundId: currentRound(sim.state).id, reason: '重开核对' });
  assert.deepEqual(seriesOf(sim.state), { a: 5, b: 0 }); assert.equal(sim.state.winner, null);
});

test('archive catalogue uses only the selected published archive, keeps source IDs and does not import historical wins', async () => {
  const archive = { editionSlug:'s10', capturedOn:'2026-10-24', teams:[{id:'red',name:'Historical Red'},{id:'blue',name:'Historical Blue'}], players:[{teamId:'red',osuId:1,username:'Captain',role:'captain'}], pools:[{id:'gs1',name:'Group Stage 1',maps:[{slot:'HD2',beatmapId:123,title:'Recorded map'},{slot:'NM1',beatmapId:null,title:'Missing ID'}]}], matches:[{id:'match-1',label:'1',stage:'Group A',teamA:'red',teamB:'blue',score:[0,6]}] };
  const snapshot = { overview:{slug:'s10',overview:{kind:'historical_archive'}}, configuration:{edition:{archive}}, teams:[],mappools:[],players:[],competition:{fixtures:[]} };
  const catalog = catalogue({status:'ready',data:snapshot});
  assert.equal(catalog.kind,'historical_archive'); assert.equal(catalog.teams.length,2); assert.equal(catalog.pools[0].entries[0].id,'gs1:HD2');
  assert.equal(catalog.pools[0].entries[0].mod,'HD'); assert.equal(catalog.warnings.length,1); assert.equal(catalog.fixtures[0].pool,null);
  assert.throws(()=>catalogue({status:'ready',data:{...snapshot,overview:{slug:'s11',overview:{kind:'historical_archive'}}}}),/赛季不一致/);
  const data = new BroadcastData({oclr:{edition:async()=>snapshot},WebSocketImpl:class {close(){}},tosuWsUrl:'ws://test',staleMs:60000});
  const store = new SessionStore(); const stop = attachBroadcast(store,data);
  try {
    await store.loadEdition('s10');
    await store.importMatch({id:'history-import',version:store.state.version,payload:{edition:'s10',fixtureId:'match-1',poolId:'gs1',leftTeamId:'red',rightTeamId:'blue',title:'S10 historical verification',stage:'group',mode:'4v4',source:'4x3'}});
    assert.equal(store.state.match.provenance,'oclr-archive'); assert.equal(store.state.match.fixtureId,'match-1');
    assert.deepEqual(seriesOf(store.state),{a:0,b:0}); assert.equal(store.state.rounds.length,0);
  } finally { stop(); await store.tail; }
});

test('periodic refresh keeps same-edition selector labels, rejects import while loading, then clears on error', async () => {
  let release;
  let pending = false;
  const published = { overview:{},teams:[{id:'red',name:'Red',members:[]}],mappools:[],competition:{fixtures:[]},players:[] };
  const data = new BroadcastData({oclr:{edition:async()=>pending?new Promise(r=>{release=r;}):published},WebSocketImpl:class {close(){}},tosuWsUrl:'ws://test',staleMs:60000});
  const store = new SessionStore(); const stop = attachBroadcast(store,data);
  try {
    await store.loadEdition('s11'); pending = true;
    const refresh = data.refresh();
    assert.equal(store.live.oclr.status,'loading'); assert.equal(store.catalog.teams[0].id,'red');
    await assert.rejects(store.importMatch({payload:{edition:'s11'}}),/先读取/);
    release(published); await refresh;
    assert.equal(store.live.oclr.status,'ready');
    data.state.oclr={status:'blocked',data:null,error:'INVALID_TOKEN',updatedAt:null}; data.emit();
    assert.deepEqual(store.catalog.teams,[]);
  } finally {stop();await store.tail;}
});

test('inconsistent or missing individual scores hold automatic wins, including a true zero total', () => {
  const sim = simulate(pick(ready()));
  sim.feed(103); sim.feed(103, 3);
  const inconsistent = { totalScore: { left: 900, right: 800 }, players: [{ side: 'left', osuId: 1, score: 0 }, { side: 'right', osuId: 2, score: 800 }] };
  sim.feed(103, 4, 500, inconsistent); sim.feed(103, 4, 500, inconsistent);
  assert.deepEqual(seriesOf(sim.state), { a: 0, b: 0 });
  const missing = { ...inconsistent, players: [{ side: 'left', osuId: 1, score: null }, { side: 'right', osuId: 2, score: 800 }] };
  sim.feed(103, 4, 500, missing); assert.deepEqual(seriesOf(sim.state), { a: 0, b: 0 });
  const complete = { totalScore: { left: 0, right: 800 } };
  sim.feed(103, 4, 500, complete); sim.feed(103, 4, 500, complete);
  assert.deepEqual(seriesOf(sim.state), { a: 0, b: 1 });
});

test('late totals retract an automatic contribution and require review; manual decisions survive subsequent frames', () => {
  for (const corrected of [false, true]) {
    const sim = simulate(pick(ready()));
    const first = { totalScore: { left: 900, right: 800 } };
    sim.feed(103); sim.feed(103, 3); sim.feed(103, 4, 500, first); sim.feed(103, 4, 500, first);
    const id = currentRound(sim.state).id;
    if (corrected) sim.manual('set-series', { a: 2, b: 2, reason: '裁判核对' });
    sim.feed(103, 4, 500, { totalScore: { left: 1000, right: 1100 } });
    if (corrected) {
      assert.deepEqual(seriesOf(sim.state), { a: 2, b: 2 }); assert.equal(sim.state.incident, null);
    } else {
      assert.deepEqual(seriesOf(sim.state), { a: 0, b: 0 }); assert.equal(sim.state.incident.kind, 'unverified');
      assert.equal(currentRound(sim.state).finalScore, null);
      sim.manual('record-result', { roundId: id, winner: 'b', reviewReason: '已核对最终成绩' });
      sim.feed(103, 4, 500, first); assert.deepEqual(seriesOf(sim.state), { a: 0, b: 1 });
      assert.equal(sim.state.incident, null);
    }
  }
});

test('manual map and first-action corrections preserve run, EX, series and queued actions; undo restores selection', () => {
  let s = action(ready(), 'pick', 'a', 0, [{ kind: 'pick', team: 'b' }]);
  s = command(s, 'apply-bp', { entryId: 'nm1' });
  s = command(s, 'ex', { team: 'a', remaining: { a: 1, b: 2 } });
  s = command(s, 'start'); const before = structuredClone(s);
  s = command(s, 'adjust-round', { entryId: 'nm2', pickedBy: 'b' });
  assert.equal(currentRound(s).runId, currentRound(before).runId); assert.equal(currentRound(s).entryId, 'nm2');
  assert.equal(s.paused, false); assert.equal(s.incident, null); assert.deepEqual(s.ex, before.ex); assert.deepEqual(s.queue, before.queue);
  assert.deepEqual(currentRound(command(s, 'undo')), currentRound(before));
  s = command(s, 'set-roll', { winner: 'a', pickFirst: 'b', banFirst: 'a' });
  assert.equal(s.phase, 'playing'); assert.equal(s.scene, 'playing');
  const queue = structuredClone(s.queue);
  s = command(s, 'set-action', { action: { kind: 'ban', team: 'b', slot: 1 } });
  assert.deepEqual(s.queue, queue);
});

test('one-step waiting and referee replay retract only this map and are undoable', () => {
  let s = pick(ready()); s = command(s, 'start');
  s = command(s, 'record-result', { roundId: currentRound(s).id, winner: 'a' });
  const recorded = structuredClone(s);
  s = command(s, 'wait-result', { kind: 'player-disconnect', reason: '有人未结束，先等' });
  assert.equal(s.incident.kind, 'player-disconnect'); assert.equal(currentRound(s).status, 'ranking');
  assert.deepEqual(seriesOf(s), { a: 0, b: 0 });
  assert.deepEqual(currentRound(command(s, 'undo')), currentRound(recorded));
  s = command(recorded, 'referee-replay', { reason: '裁判明确要求重赛' });
  assert.equal(currentRound(s).replayOf, currentRound(recorded).id); assert.equal(currentRound(s).runId, null);
  assert.deepEqual(seriesOf(s), { a: 0, b: 0 });
  assert.deepEqual(currentRound(command(s, 'undo')), currentRound(recorded));
});

test('explicit BP plan changes only queued actions, without requiring an extra verification field', () => {
  const s = action(ready(), 'ban');
  assert.deepEqual(command(s, 'set-plan', { verifiedBy: '', queue: [] }).queue, []);
  assert.throws(() => command(s, 'set-plan', { queue: [{ kind: 'pick' }] }), /明确 BP/);
  const next = command(s, 'set-plan', { verifiedBy: '本场裁判确认', queue: [{ kind: 'pick', team: 'b' }] });
  assert.deepEqual(next.action, s.action); assert.equal(next.queue[0].team, 'b');
  for (const key of ['phase', 'scene', 'rounds', 'bans', 'ex']) assert.deepEqual(next[key], s[key]);
});

test('immediate individual settings change live layout and metadata without resetting progress or automation', () => {
  let s = pick(ready()); s = command(s, 'start');
  const original = structuredClone(s);
  for (const [field, value, team] of [['title', 'Corrected title'], ['mode', '3v3'], ['source', '16x9'], ['team-name', 'Corrected Red', 'a'], ['roster', [{ name: 'Actual player', osuId: 123 }], 'a']]) {
    s = command(s, 'setting', { field, value, team });
  }
  assert.equal(s.match.title, 'Corrected title'); assert.equal(s.match.mode, '3v3'); assert.equal(s.match.source, '16x9');
  assert.equal(s.match.teams.a.name, 'Corrected Red'); assert.equal(s.match.teams.a.roster[0].osuId, 123);
  for (const key of ['phase', 'scene', 'rounds', 'bans', 'ex', 'auto', 'action', 'queue', 'locked']) assert.deepEqual(s[key], original[key]);
  assert.deepEqual(command(s, 'undo').match.teams.a.roster, original.match.teams.a.roster);
});

test('live pool edits preserve referenced IDs and reject removal atomically; prepared map corrections keep automation armed', () => {
  let s = pick(ready()); const original = structuredClone(s);
  assert.throws(() => command(s, 'setting', { field: 'pool', value: s.pool.filter(e => e.id !== 'nm1') }), /不能删除/);
  assert.deepEqual(s, original);
  const renamed = s.pool.map(e => e.id === 'nm1' ? { ...e, label: 'NM9', title: 'Corrected title' } : e);
  s = command(s, 'setting', { field: 'pool', value: renamed });
  assert.equal(currentRound(s).entryId, 'nm1'); assert.equal(s.paused, false);
  s = command(s, 'setting', { field: 'pool', value: s.pool.map(e => e.id === 'nm1' ? { ...e, beatmapId: 9999 } : e) });
  assert.equal(s.paused, false); assert.equal(s.incident, null); assert.equal(currentRound(s).status, 'prepared');
});

test('metadata edits between Ranking frames keep automatic finish continuity', async () => {
  const store = new SessionStore({ state: pick(ready()) });
  await store.frame(frame(103, 1), 1000); await store.frame(frame(103, 3), 1500);
  const final = frame(103, 4, { totalScore: { left: 900, right: 800 } });
  await store.frame(final, 2000);
  await store.command({ id: `live-setting-${++counter}`, version: store.state.version, type: 'setting', payload: { field: 'title', value: 'Live title edit' } });
  await store.frame(final, 2500);
  assert.deepEqual(seriesOf(store.state), { a: 1, b: 0 });
});

test('published selections can update existing match metadata while preserving records and automatic intent', () => {
  let s = pick(ready()); s = command(s, 'start');
  s = command(s, 'record-result', { roundId: currentRound(s).id, winner: 'a' });
  const before = structuredClone(s);
  s = command(s, 'update-setup', { ...s.match, teams: { ...s.match.teams, b: { ...s.match.teams.b, name: 'Corrected Blue' } }, pool: s.pool });
  assert.equal(s.match.teams.b.name, 'Corrected Blue'); assert.deepEqual(seriesOf(s), { a: 1, b: 0 });
  for (const key of ['rounds', 'action', 'queue', 'bans', 'roll', 'ex', 'phase', 'scene', 'auto']) assert.deepEqual(s[key], before[key]);
  assert.equal(s.paused, false);
});

test('common EX counters can change during play, including zero for the active team, without changing activation or the run', () => {
  let s = pick(ready()); s = command(s, 'ex', { team: 'a', remaining: { a: 1, b: 2 } }); s = command(s, 'start');
  const before = structuredClone(s);
  s = command(s, 'ex', { team: 'a', remaining: { a: 0, b: 2 } });
  assert.deepEqual(s.ex, { team: 'a', remaining: { a: 0, b: 2 } });
  for (const key of ['phase', 'scene', 'rounds', 'bans', 'roll', 'queue', 'action']) assert.deepEqual(s[key], before[key]);
  assert.deepEqual(command(s, 'undo').ex, before.ex);
  assert.throws(() => command(s, 'ex', { team: 'b', remaining: { a: 0, b: 2 } }), /准备期/);
});

test('changing only EX counts between Ranking frames preserves automatic counting continuity', async () => {
  const store = new SessionStore({ state: pick(ready()) });
  await store.frame(frame(103, 1), 1000); await store.frame(frame(103, 3), 1500);
  const final = frame(103, 4, { totalScore: { left: 900, right: 800 } });
  await store.frame(final, 2000);
  await store.command({ id: `ex-quick-${++counter}`, version: store.state.version, type: 'ex', payload: { team: null, remaining: { a: 1, b: 2 } } });
  await store.frame(final, 2500);
  assert.deepEqual(seriesOf(store.state), { a: 1, b: 0 }); assert.equal(store.state.ex.remaining.a, 1);
});

test('Roll management edits points during Playing without changing the game, BP, scores or finish continuity', async () => {
  const store = new SessionStore({ state: pick(ready()) });
  await store.frame(frame(103, 1), 1000); await store.frame(frame(103, 3), 1500);
  const before = structuredClone(store.state);
  const final = frame(103, 4, { totalScore: { left: 900, right: 800 } });
  await store.frame(final, 2000);
  await store.command({ id: `roll-panel-${++counter}`, version: store.state.version, type: 'set-roll', payload: { a: 0, b: null, winner: null, pickFirst: 'b', banFirst: 'a' } });
  assert.deepEqual(store.state.roll, { a: 0, b: null, winner: null, pickFirst: 'b', banFirst: 'a' });
  for (const key of ['phase', 'scene', 'rounds', 'bans', 'queue', 'ex']) assert.deepEqual(store.state[key], before[key]);
  assert.deepEqual(seriesOf(store.state), { a: 0, b: 0 });
  await store.frame(final, 2500); assert.deepEqual(seriesOf(store.state), { a: 1, b: 0 });
  assert.throws(() => command(store.state, 'set-roll', { a: -1, b: 0, winner: null, pickFirst: null, banFirst: null }), /Roll/);
});

test('pool management waits for the map to end, then allows BP before recording its result', () => {
  let s = command(pick(ready()), 'start');
  s = command(s, 'display', { scene: 'mappool' });
  assert.equal(s.phase, 'playing');
  s = action(s, 'ban', 'b');
  assert.throws(() => command(s, 'apply-bp', { entryId: 'hd1' }), /尚未结束/);
  s = command(s, 'ranking');
  const playing = structuredClone(currentRound(s));
  s = command(s, 'display', { scene: 'mappool' });
  s = command(s, 'apply-bp', { entryId: 'hd1' });
  assert.equal(s.bans.b[0], 'hd1'); assert.deepEqual(currentRound(s), playing);
  s = action(s, 'pick', 'b'); s = command(s, 'apply-bp', { entryId: 'nm2' });
  const prepared = structuredClone(currentRound(s));
  assert.equal(prepared.status, 'prepared'); assert.equal(prepared.pickedBy, 'b');
  assert.deepEqual(s.rounds.find(r => r.id === playing.id), playing);
  assert.deepEqual(seriesOf(s), { a: 0, b: 0 }); assert.equal(s.scene, 'mappool');
  s = command(s, 'display', { scene: 'playing' });
  s = command(s, 'record-result', { roundId: playing.id, winner: 'a', keepDisplay: true });
  assert.deepEqual(currentRound(s), prepared); assert.equal(s.scene, 'playing'); assert.deepEqual(seriesOf(s), { a: 1, b: 0 });
});

test('pool Ban correction and Pick replacement preserve a prepared selection, EX, next queue and series', () => {
  let s = action(ready(), 'pick', 'a', 0, [{ kind: 'pick', team: 'b' }]);
  s = command(s, 'apply-bp', { entryId: 'nm1' }); s = command(s, 'ex', { team: 'a', remaining: { a: 1, b: 2 } });
  const prepared = structuredClone(currentRound(s)); const queue = structuredClone(s.queue); const ex = structuredClone(s.ex);
  s = command(s, 'set-action', { action: { kind: 'ban', team: 'b', slot: 0 } });
  s = command(s, 'apply-bp', { entryId: 'hd1' });
  assert.deepEqual(currentRound(s), prepared); assert.deepEqual(s.queue, queue); assert.deepEqual(s.ex, ex); assert.equal(s.action, null);
  s = command(s, 'set-action', { action: { kind: 'pick', team: 'b' } });
  s = command(s, 'apply-bp', { entryId: 'nm2' });
  assert.equal(currentRound(s).id, prepared.id); assert.equal(currentRound(s).entryId, 'nm2'); assert.equal(currentRound(s).pickedBy, 'b');
  assert.equal(s.rounds.length, 1); assert.deepEqual(seriesOf(s), { a: 0, b: 0 }); assert.deepEqual(s.queue, queue); assert.deepEqual(s.ex, ex);
});

test('Playing records one win in place and requires a separate Winner display even at the series target', () => {
  let s = pick(ready()); s = command(s, 'set-series', { a: 5, b: 0, reason: 'test baseline' }); s = command(s, 'start');
  const id = currentRound(s).id;
  s = command(s, 'record-result', { roundId: id, winner: 'a', keepDisplay: true });
  assert.deepEqual(seriesOf(s), { a: 6, b: 0 }); assert.equal(s.scene, 'playing'); assert.equal(s.winner, null);
  assert.throws(() => command(s, 'record-result', { roundId: id, winner: 'a', keepDisplay: true }), /已记录/);
  s = command(s, 'winner', { team: 'a' }); assert.equal(s.scene, 'victory');
});

test('scene-led automatic pool following works without forcing the old phase through Roll', () => {
  let s = setup();
  s = command(s, 'display', { scene: 'mappool' });
  s = command(s, 'auto', { bp: true, scenes: true, locked: false, profile: 'stable-tourney', left: 'Red room', right: 'Blue room' });
  s = action(s, 'ban', 'a', 0, [{ kind: 'pick', team: 'b' }]);
  const sim = simulate(s); sim.feed(999); sim.change(101);
  assert.equal(sim.state.bans.a[0], 'hd1'); assert.equal(sim.state.action.team, 'b');
  sim.change(103); assert.equal(currentRound(sim.state).status, 'prepared');
  sim.feed(103, 3); assert.equal(currentRound(sim.state).status, 'playing');
});

test('broadcast map marks can replace or clear played maps without changing results, progress or BP', () => {
  let s = command(pick(ready()), 'start');
  s = command(s, 'record-result', { roundId: currentRound(s).id, winner: 'a', keepDisplay: true });
  const original = structuredClone(s);
  for (const [status, team] of [['banned', 'b'], ['picked', 'a'], ['open', null]]) {
    s = command(s, 'map-mark', { entryId: 'nm1', status, team });
    assert.deepEqual(s.poolMarks, [{ entryId: 'nm1', status, team }]);
    assert.deepEqual(seriesOf(s), { a: 1, b: 0 });
    for (const key of ['rounds', 'currentRoundId', 'action', 'queue', 'bans', 'phase', 'scene', 'locked', 'ex', 'auto', 'incident']) assert.deepEqual(s[key], original[key]);
  }
  const held = command(command(pick(ready()), 'start'), 'incident', { kind: 'spectator', reason: '测试观战故障' });
  const changed = command(held, 'map-mark', { entryId: 'nm1', status: 'picked', team: 'b' });
  assert.deepEqual(changed.incident, held.incident);
});

test('map mark validation is atomic and undo works for sessions saved before poolMarks existed', () => {
  const legacy = setup(); delete legacy.poolMarks;
  const changed = command(legacy, 'map-mark', { entryId: 'nm1', status: 'picked', team: 'b' });
  assert.deepEqual(command(changed, 'undo').poolMarks, []);
  for (const payload of [{ entryId: 'missing', status: 'picked', team: 'a' }, { entryId: 'nm1', status: 'bogus', team: 'a' }, { entryId: 'nm1', status: 'picked', team: null }, { entryId: 'nm1', status: 'open', team: 'a' }]) {
    assert.throws(() => command(legacy, 'map-mark', payload), /请选择/);
  }
  assert.equal(legacy.poolMarks, undefined);
});

test('map marks persist, follow pool deletions, and reset only with a new match', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-marks-'));
  try {
    const file = join(dir, 'session.json'); const store = new SessionStore({ file, state: setup() });
    await store.command({ id: `mark-${++counter}`, version: store.state.version, type: 'map-mark', payload: { entryId: 'nm1', status: 'banned', team: 'b' } });
    const reopened = await SessionStore.open(file);
    assert.deepEqual(reopened.snapshot().session.poolMarks, [{ entryId: 'nm1', status: 'banned', team: 'b' }]);
    const removed = command(reopened.state, 'setting', { field: 'pool', value: pool.filter(e => e.id !== 'nm1') });
    assert.deepEqual(removed.poolMarks, []);
    assert.deepEqual(command(reopened.state, 'next-match').poolMarks, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('editing a broadcast mark between Ranking frames preserves automatic finish continuity', async () => {
  const store = new SessionStore({ state: pick(ready()) });
  await store.frame(frame(103, 1), 1000); await store.frame(frame(103, 3), 1500);
  const final = frame(103, 4, { totalScore: { left: 900, right: 800 } });
  await store.frame(final, 2000);
  await store.command({ id: `mark-ranking-${++counter}`, version: store.state.version, type: 'map-mark', payload: { entryId: 'nm1', status: 'banned', team: 'b' } });
  await store.frame(final, 2500);
  assert.deepEqual(seriesOf(store.state), { a: 1, b: 0 });
  assert.deepEqual(store.state.poolMarks, [{ entryId: 'nm1', status: 'banned', team: 'b' }]);
});

test('Playing preparation is explicit and independent of broadcast Pick, preserving earlier results', () => {
  let s = command(ready(), 'map-mark', { entryId: 'nm2', status: 'picked', team: 'b' });
  assert.equal(s.currentRoundId, null); assert.equal(s.rounds.length, 0);
  s = command(s, 'display', { scene: 'playing' });
  s = command(s, 'prepare-round', { entryId: 'nm1', pickedBy: 'a' });
  assert.equal(currentRound(s).entryId, 'nm1'); assert.equal(s.scene, 'playing'); assert.equal(s.paused, false);
  s = command(s, 'start'); const old = structuredClone(currentRound(s));
  assert.throws(() => command(s, 'prepare-round', { entryId: 'nm2', pickedBy: 'b' }), /尚未结束/);
  s = command(s, 'ranking');
  s = command(s, 'prepare-round', { entryId: 'nm2', pickedBy: 'b' });
  const next = structuredClone(currentRound(s));
  s = command(s, 'record-result', { roundId: old.id, winner: 'a', keepDisplay: true });
  assert.deepEqual(currentRound(s), next); assert.deepEqual(seriesOf(s), { a: 1, b: 0 });
  assert.deepEqual(s.poolMarks, [{ entryId: 'nm2', status: 'picked', team: 'b' }]);
});

test('initializing the whole match archives all prior content, clears every match field and can be undone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-initialize-'));
  try {
    let state = action(ready(), 'ban', 'b');
    state = command(state, 'apply-bp', { entryId: 'hd1' });
    state = command(pick(state), 'start');
    state = command(state, 'record-result', { roundId: currentRound(state).id, winner: 'a', keepDisplay: true });
    state = command(state, 'map-mark', { entryId: 'nm1', status: 'picked', team: 'b' });
    state = command(state, 'set-series', { a: 2, b: 1, reason: '测试初始化前的人工比分' });
    state = command(state, 'set-stage', { stage: 'final' });
    state = command(state, 'setting', { field: 'roster', team: 'a', value: [{ name: 'Test player', osuId: 123 }] });
    state = command(state, 'set-roll', { a: 83, b: 52, winner: 'a', pickFirst: 'b', banFirst: 'a' });
    state = command(state, 'arrival', { team: 'a', arrived: true, ready: true });
    state = action(state, 'pick', 'b', 0, [{ kind: 'pick', team: 'a' }]);
    state = command(state, 'ex', { team: null, remaining: { a: 1, b: 0 } });
    state = command(state, 'pause', { kind: 'tactical' });
    const file = join(dir, 'session.json');
    const store = new SessionStore({ file, state });
    await store.command({ id: 'initialize-whole-match', version: state.version, type: 'next-match' });
    const fresh = newSession();
    assert.notEqual(store.state.id, state.id);
    for (const key of Object.keys(fresh).filter(key => !['id', 'version', 'history', 'undo', 'commandIds'].includes(key))) assert.deepEqual(store.state[key], fresh[key], key);
    assert.deepEqual(seriesOf(store.state), { a: 0, b: 0 });
    const archived = JSON.parse(await readFile(join(dir, 'archive', `${state.id}-${state.version}.json`), 'utf8'));
    assert.deepEqual(archived, state);
    const restored = await SessionStore.open(file);
    assert.equal(restored.state.id, store.state.id);
    await restored.command({ id: 'undo-initialize', version: restored.state.version, type: 'undo' });
    for (const key of Object.keys(state).filter(key => !['version', 'history', 'undo', 'commandIds'].includes(key))) assert.deepEqual(restored.state[key], state[key], key);
    assert.deepEqual(seriesOf(restored.state), { a: 2, b: 1 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('failed archive prevents initialization and leaves the previous session untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-initialize-fail-'));
  try {
    const state = pick(ready());
    const file = join(dir, 'session.json');
    await writeFile(file, JSON.stringify(state));
    await writeFile(join(dir, 'archive'), 'Blocked archive directory');
    const store = new SessionStore({ file, state });
    await assert.rejects(store.command({ id: 'initialize-archive-failure', version: state.version, type: 'next-match' }));
    assert.equal(store.state, state);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), state);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
