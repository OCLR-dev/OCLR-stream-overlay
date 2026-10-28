import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
const frame = (mapId = 999, ipc = 1, extra = {}) => ({ beatmap: { id: mapId }, tourney: { ipcState: ipc, teams: { left: 'Red room', right: 'Blue room' }, players: [{ side: 'left', osuId: 1 }, { side: 'right', osuId: 2 }], totalScore: { left: 0, right: null }, ...extra } });
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

test('first connection, reconnect, invalid frames, pause and lock establish baselines without replay', () => {
  const sim = simulate(action(ready(), 'ban'));
  sim.feed(101); sim.feed(101); assert.equal(sim.state.bans.a[0], null);
  sim.change(103); assert.equal(sim.state.bans.a[0], 'nm1');
  sim.manual('undo'); sim.feed(103); sim.feed(103); assert.equal(sim.state.bans.a[0], null);
  sim.manual('pause', { kind: 'technical' }); sim.change(104); assert.equal(sim.state.scene, 'pause');
  sim.manual('resume'); sim.feed(104); sim.feed(104); assert.equal(sim.state.bans.a[0], null);
  sim.manual('display', { scene: 'mappool' }); sim.change(105); assert.equal(sim.state.bans.a[0], null);
  sim.manual('auto', { ...sim.state.auto, locked: false }); sim.feed(105); sim.feed(105); assert.equal(sim.state.bans.a[0], null);
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
  assert.equal(reconnect.state.scene, 'mappool');
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
