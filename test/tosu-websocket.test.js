import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { get } from 'node:http';
import { startSimulation } from '../tools/tosu-simulator/stack.js';
import { seedCommands } from '../tools/tosu-simulator/fixture.js';

async function until(predicate, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await delay(30); }
  assert.fail(`Timed out: ${message}`);
}
async function boot(t) {
  const stack = await startSimulation({ offlineOclr: true, appPort: 0, wsPort: 0 });
  t.after(() => stack.stop());
  await until(() => stack.store.live.tosu.status === 'live', 'real WebSocket connection');
  return stack;
}
async function simulate(stack, action, patch) {
  const response = await fetch(`${stack.simulatorUrl}/api/simulator/control`, { method: 'POST', headers: { Origin: stack.simulatorUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, patch }) });
  assert.equal(response.status, 200); return response.json();
}
async function operator(stack, type, payload = {}) {
  const response = await fetch(`${stack.appUrl}/api/session/command`, { method: 'POST', headers: { Origin: stack.appUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), version: stack.store.state.version, type, payload }) });
  const result = await response.json(); assert.equal(response.status, 200, result.error?.message); return result;
}
const snapshot = stack => stack.store.snapshot();
const current = stack => stack.store.state.rounds.find(r => r.id === stack.store.state.currentRoundId);

test('real socket follows Roll-generated BP through both first Picks, replay and second bans without requiring wins', { timeout: 20000 }, async t => {
  const stack = await boot(t);
  await operator(stack, 'next-match');
  // Reset clears room binding. Wait for its next persisted WebSocket discovery
  // before reading a command version; otherwise disk timing can race setup.
  await until(() => stack.store.state.auto.profile === 'stable-tourney' &&
    stack.store.state.auto.left === '模拟红队' && stack.store.state.auto.right === '模拟蓝队',
  'room rediscovery after initialization');
  await operator(stack, 'setup', seedCommands()[0][1]);
  await operator(stack, 'set-roll', { a: 83, b: 52, winner: 'a', banFirst: 'a', pickFirst: 'b' });
  await operator(stack, 'auto', { ...stack.store.state.auto, profile: 'stable-tourney', left: '模拟红队', right: '模拟蓝队' });
  assert.equal(stack.store.state.action.team, 'a');
  await map(stack, 720001); await until(() => stack.store.state.bans.a[0], 'Roll-generated first Red Ban');
  await map(stack, 730001); await until(() => stack.store.state.bans.b[0], 'Roll-generated first Blue Ban');
  await map(stack, 710001); await until(() => current(stack)?.status === 'prepared', 'Blue first Pick');
  assert.equal(current(stack).pickedBy, 'b'); const id = current(stack).id;
  await map(stack, 710002); await until(() => current(stack)?.entryId === 'sim-nm2', 'replacement, same Pick');
  assert.equal(current(stack).id, id);
  const finish = async () => {
    await simulate(stack, 'set', { ipcState: 3, growing: false }); await until(() => current(stack)?.status === 'playing', 'observed Playing');
    await simulate(stack, 'set', { ipcState: 4, left: null, right: null }); await until(() => current(stack)?.status === 'ranking', 'finish without scores');
  };
  await finish(); assert.equal(stack.store.state.action.team, 'a');
  await map(stack, 710003); await until(() => current(stack)?.entryId === 'sim-nm3', 'Red first Pick');
  await finish(); assert.equal(stack.store.state.action.kind, 'ban'); assert.equal(stack.store.state.action.slot, 1);
  const action = structuredClone(stack.store.state.action);
  await operator(stack, 'referee-replay', { reason: '合成传输测试：裁判重赛' });
  await delay(350); assert.equal(stack.store.state.action, null); assert.equal(current(stack).status, 'prepared');
  await simulate(stack, 'set', { ipcState: 1 }); await until(() => stack.store.live.tosu.data?.tourney.ipcState === 1, 'new prestart edge');
  await finish(); assert.deepEqual(stack.store.state.action, action);
  await map(stack, 710004); await until(() => stack.store.state.bans.a[1], 'Red second Ban');
  await map(stack, 710005); await until(() => stack.store.state.bans.b[1], 'Blue second Ban');
  assert.equal(stack.store.state.action.team, 'b'); assert.equal(stack.store.state.action.ordinal, 2);
  await map(stack, 710006); await until(() => current(stack)?.entryId === 'sim-nm6', 'Blue second Pick');
  assert.equal(current(stack).pickedBy, 'b'); assert.deepEqual(snapshot(stack).session.series, { a: 0, b: 0 });
  assert.equal(stack.store.state.bpHistory.filter(item => item.kind === 'pick').length, 3);
});
const map = (stack, mapId) => simulate(stack, 'set', { mapId, ipcState: 1 });
async function prepare(stack) {
  await map(stack, 720001); await until(() => stack.store.state.bans.a[0], 'automatic Red Ban');
  await map(stack, 730001); await until(() => stack.store.state.bans.b[0], 'automatic Blue Ban');
  await map(stack, 710001); await until(() => current(stack)?.status === 'prepared', 'automatic Pick');
}
async function subscribe(base) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/session/events`, { signal: controller.signal });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const received = [];
  const reading = (async () => {
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        while (buffer.includes('\n\n')) {
          const boundary = buffer.indexOf('\n\n'); const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          if (event.startsWith('event: snapshot')) received.push(JSON.parse(event.split('\ndata: ')[1]));
        }
      }
    } catch (error) { if (error.name !== 'AbortError') throw error; }
  })();
  return { received, async close() { controller.abort(); await reading; } };
}

test('real tosu-shaped WebSocket drives Ban/Pick, replacement, live scores/chat, Ranking and two output streams', { timeout: 20000 }, async t => {
  const stack = await boot(t);
  const one = await subscribe(stack.appUrl); const two = await subscribe(stack.appUrl);
  t.after(async () => { await one.close(); await two.close(); });
  const raw = await (await fetch(`${stack.simulatorUrl}/json/v2`)).json();
  assert.equal(raw.simulation, true); assert.equal(raw.tourney.clients.length, 8);
  assert.equal(raw.tourney.clients[0].team, 'left'); assert.equal(raw.tourney.team.left, '模拟红队');
  assert.equal(stack.simulator.clients.size, 1, 'browsers subscribe to the session, not extra tosu connections');
  await prepare(stack); const roundId = current(stack).id;
  assert.equal(stack.store.state.bans.a[0], 'sim-hd1'); assert.equal(stack.store.state.bans.b[0], 'sim-hr1');
  assert.equal(stack.store.state.phase, 'bp'); assert.equal(stack.store.state.scene, 'mappool');
  await map(stack, 710002); await until(() => current(stack)?.entryId === 'sim-nm2', 'prepared map replacement');
  assert.equal(current(stack).id, roundId); assert.equal(stack.store.state.rounds.length, 1);
  await simulate(stack, 'set', { ipcState: 3 }); await until(() => stack.store.state.scene === 'playing', 'automatic Playing display');
  const firstScore = stack.store.live.tosu.data.tourney.totalScore.left;
  await until(() => stack.store.live.tosu.data.tourney.totalScore.left > firstScore, 'ongoing transport score updates');
  const live = stack.store.live.tosu.data.tourney;
  assert.equal(live.players.filter(p => p.side === 'left').reduce((sum, p) => sum + p.score, 0), live.totalScore.left);
  assert.ok(live.chat.some(line => line.message.includes('Playing')));
  await simulate(stack, 'set', { ipcState: 4, left: 1234567, right: 1100000 });
  await until(() => current(stack)?.status === 'recorded', 'automatic win from real socket frames');
  assert.equal(stack.store.state.scene, 'playing'); assert.deepEqual(snapshot(stack).session.series, { a: 1, b: 0 });
  assert.equal(current(stack).resultSource, 'tosu');
  await until(() => one.received.some(s => s.session.series.a === 1) && two.received.some(s => s.session.series.a === 1), 'both independent output subscriptions');
  const version = stack.store.state.version; await delay(650); assert.equal(stack.store.state.version, version, 'stable Ranking does not award again');
  await operator(stack, 'retract-result', { roundId, reason: 'Socket test: invalid result' });
  await delay(650); assert.deepEqual(snapshot(stack).session.series, { a: 0, b: 0 });
  await operator(stack, 'record-result', { roundId, winner: 'b' });
  await operator(stack, 'set-series', { a: 2, b: 2, reason: 'Socket test: corrected series' });
  await delay(650); assert.deepEqual(snapshot(stack).session.series, { a: 2, b: 2 });
  await until(() => one.received.some(s => s.session.series.a === 2 && s.session.series.b === 2) && two.received.some(s => s.session.series.a === 2 && s.session.series.b === 2), 'correction synchronized to both outputs');
  assert.ok(stack.simulator.framesSent >= 20);
});

test('real socket updates Playing map parameters and clears absent fields over SSE', async t => {
  const stack = await boot(t);
  const stream = await subscribe(stack.appUrl); t.after(() => stream.close());
  await prepare(stack);
  await simulate(stack, 'set', { ipcState: 3, growing: false });
  await until(() => stack.store.state.scene === 'playing', 'Playing');
  const map = () => stack.store.live.tosu.data.beatmap;
  assert.equal(map().stats.stars.total, 6.2);
  const version = stack.store.state.version;
  await simulate(stack, 'set', { mapParams: 'changed' });
  await until(() => stream.received.some(s => s.live.tosu.data?.beatmap.stats?.stars.total === 7.35), 'parameter update over SSE');
  assert.equal(map().id, 710001);
  assert.equal(map().stats.cs.converted, 5.2);
  assert.equal(map().stats.ar.converted, 10.3);
  assert.equal(map().stats.od.converted, 9.7);
  assert.equal(map().stats.bpm.common, 210.5);
  assert.equal(map().time.lastObject, 245000);
  assert.equal(stack.store.state.version, version, 'metadata update does not advance match state');
  await simulate(stack, 'set', { mapParams: 'partial' });
  await until(() => map().stats?.ar.converted === 9.8, 'partial parameters');
  assert.equal(map().stats.stars.total, null);
  assert.equal(map().stats.cs.converted, null);
  assert.equal(map().stats.bpm.common, null);
  assert.equal(map().time.lastObject, null);
  await simulate(stack, 'set', { mapParams: 'missing' });
  await until(() => map().stats === null, 'missing stats clear previous values');
  await simulate(stack, 'set', { mapParams: 'zero' });
  await until(() => map().stats?.stars.total === 0, 'explicit zero values');
  assert.equal(map().time.lastObject, 0);
});

test('real socket invalid frames, room mismatch, pause and undo never consume old map changes', { timeout: 15000 }, async t => {
  const stack = await boot(t);
  await simulate(stack, 'set', { wrongRoom: true, mapId: 720001 }); await delay(650);
  assert.equal(stack.store.state.bans.a[0], null);
  await simulate(stack, 'set', { wrongRoom: false }); await delay(650);
  assert.equal(stack.store.state.bans.a[0], null, 'restoring binding establishes a baseline');
  await simulate(stack, 'set', { invalid: true }); await until(() => stack.store.live.tosu.status === 'invalid-data', 'normalizer rejects raw error frames');
  await map(stack, 730001); await delay(300); assert.equal(stack.store.state.bans.a[0], null);
  await simulate(stack, 'set', { invalid: false }); await until(() => stack.store.live.tosu.status === 'live', 'valid raw frames resume');
  await delay(500); assert.equal(stack.store.state.bans.a[0], null);
  await operator(stack, 'pause', { kind: 'technical' });
  await map(stack, 710001); await delay(650); assert.equal(stack.store.state.scene, 'pause'); assert.equal(stack.store.state.bans.a[0], null);
  await operator(stack, 'resume'); await delay(250);
  await map(stack, 720001); await until(() => stack.store.state.bans.a[0] === 'sim-hd1', 'new map after resume');
  await operator(stack, 'undo'); await delay(650); assert.equal(stack.store.state.bans.a[0], null);
});

test('real WebSocket disconnect/reconnect and five-second silence establish fresh baselines without replaying Ranking', { timeout: 22000 }, async t => {
  const stack = await boot(t); await prepare(stack);
  await simulate(stack, 'set', { ipcState: 3 }); await until(() => stack.store.state.scene === 'playing', 'Playing');
  await simulate(stack, 'set', { silent: true, ipcState: 4, left: 900000, right: 1200000 });
  await until(() => stack.store.live.tosu.status === 'stale', 'real default 5s stale timeout', 6500);
  const originalConnections = stack.simulator.connections;
  await until(() => stack.simulator.connections > originalConnections, 'reconnect to silent endpoint', 3000);
  await simulate(stack, 'set', { silent: false }); await until(() => stack.store.live.tosu.status === 'live', 'frames resume at Ranking');
  await delay(650); assert.equal(stack.store.state.scene, 'playing'); assert.deepEqual(snapshot(stack).session.series, { a: 0, b: 0 });
  const beforeDrop = stack.simulator.connections;
  await simulate(stack, 'disconnect'); await until(() => stack.simulator.connections > beforeDrop && stack.store.live.tosu.status === 'live', 'socket closes then reconnects', 3500);
  await delay(650); assert.deepEqual(snapshot(stack).session.series, { a: 0, b: 0 });
});

test('real socket abort, independent same-map rematch and late missing/tied final totals keep the correct round', { timeout: 15000 }, async t => {
  const stack = await boot(t); await prepare(stack);
  await simulate(stack, 'set', { ipcState: 3 }); await until(() => current(stack)?.status === 'playing', 'Playing');
  const firstRun = current(stack).runId;
  await simulate(stack, 'set', { ipcState: 1 }); await delay(250);
  await simulate(stack, 'set', { ipcState: 4, left: 1000000, right: 0 }); await delay(650);
  assert.deepEqual(snapshot(stack).session.series, { a: 0, b: 0 }); assert.equal(stack.store.state.scene, 'playing');
  await operator(stack, 'replay', { reason: 'Socket test: explicit same-map replay' });
  await simulate(stack, 'set', { ipcState: 1 }); await delay(250);
  await simulate(stack, 'set', { ipcState: 3 }); await until(() => current(stack)?.status === 'playing', 'rematch Playing');
  assert.notEqual(current(stack).runId, firstRun);
  await simulate(stack, 'set', { ipcState: 4, left: null, right: null }); await until(() => current(stack)?.status === 'ranking', 'Ranking with unknown totals');
  assert.deepEqual(snapshot(stack).session.series, { a: 0, b: 0 });
  await simulate(stack, 'set', { left: 100, right: 100 }); await delay(500); assert.deepEqual(snapshot(stack).session.series, { a: 0, b: 0 });
  await simulate(stack, 'set', { left: 0, right: 900000 }); await until(() => current(stack)?.status === 'recorded', 'late valid totals award exactly once');
  assert.deepEqual(snapshot(stack).session.series, { a: 0, b: 1 }); assert.equal(stack.store.state.rounds[0].status, 'void');
});

test('prestart abort, missing client replay and Panic recovery remain distinct over the real WebSocket', { timeout: 18000 }, async t => {
  const stack = await boot(t); await prepare(stack);
  const initial = structuredClone(current(stack));
  const originalBp = structuredClone(stack.store.state.bpHistory);
  await simulate(stack, 'set', { ipcState: 2 }); await delay(150);
  await simulate(stack, 'set', { ipcState: 1 }); await delay(150);
  assert.equal(current(stack).id, initial.id); assert.equal(current(stack).runId, null);
  await operator(stack, 'incident', { kind: 'abort', reason: '模拟开打前卡住，取消启动' });
  assert.equal(stack.store.state.incident.kind, 'prestart-abort');
  await operator(stack, 'replay', { reason: '继续准备原图' });
  assert.equal(stack.store.state.rounds.length, 1); assert.equal(current(stack).id, initial.id);
  await delay(150);
  await simulate(stack, 'set', { ipcState: 3 }); await until(() => current(stack)?.status === 'playing', 'initial Playing');
  const oldRun = current(stack).runId;
  await simulate(stack, 'set', { missingClient: true }); await until(() => stack.store.state.incident, 'one missing client holds automation');
  assert.equal(stack.store.state.incident.kind, 'unverified');
  await operator(stack, 'incident', { kind: 'player-disconnect', reason: '模拟裁判确认选手掉线' });
  await simulate(stack, 'set', { ipcState: 4, left: 900, right: 800 }); await delay(400);
  assert.deepEqual(snapshot(stack).session.series, { a: 0, b: 0 });
  await simulate(stack, 'set', { ipcState: 1, missingClient: false });
  await operator(stack, 'replay', { reason: '模拟裁判确认同图重赛' });
  await delay(150);
  await simulate(stack, 'set', { ipcState: 3 }); await until(() => current(stack)?.status === 'playing', 'replay Playing');
  const replay = structuredClone(current(stack)); assert.notEqual(replay.runId, oldRun);
  await simulate(stack, 'panic'); await until(() => stack.store.state.incident, 'Panic observation gap');
  await until(() => !stack.simulator.demo && stack.simulator.room.ipcState === 3, 'simulated spectators recover');
  assert.equal(stack.simulator.room.clientsHidden, false);
  await operator(stack, 'incident', { kind: 'spectator', reason: '仅观战端 Panic，重赛本身仍在进行' });
  await operator(stack, 'resolve-incident', { reason: '核对后继续同一次开打' });
  await delay(250);
  assert.equal(current(stack).id, replay.id); assert.equal(current(stack).runId, replay.runId);
  await simulate(stack, 'set', { ipcState: 4, left: 900, right: 800 });
  await until(() => current(stack)?.status === 'recorded', 'valid result after verified spectator recovery');
  assert.deepEqual(snapshot(stack).session.series, { a: 1, b: 0 });
  assert.equal(stack.store.state.rounds.length, 2); assert.deepEqual(stack.store.state.bpHistory, originalBp);
});

test('simulator writes and WebSocket upgrades stay local and the explicit test stack never serves private files', { timeout: 10000 }, async t => {
  const stack = await boot(t);
  assert.equal((await fetch(`${stack.simulatorUrl}/api/simulator/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${stack.simulatorUrl}/.env.local`)).status, 404);
  assert.equal((await fetch(`${stack.appUrl}/.local/session.json`)).status, 404);
  const response = await fetch(`${stack.appUrl}/api/config`); const config = await response.json();
  assert.equal(config.tosuWsUrl, stack.simulator.wsUrl); assert.equal(config.authMode, 'anonymous');
  assert.ok(!('key' in config));
});

test('rapid reset during scripted playback is serialized and leaves a usable fresh simulated match', { timeout: 10000 }, async t => {
  const stack = await boot(t);
  await simulate(stack, 'demo');
  await Promise.all([simulate(stack, 'reset'), simulate(stack, 'reset')]);
  assert.equal(stack.simulator.demo, null);
  assert.equal(stack.store.state.phase, 'bp'); assert.equal(stack.store.state.rounds.length, 0);
  assert.deepEqual(snapshot(stack).session.series, { a: 0, b: 0 });
  await map(stack, 720001); await until(() => stack.store.state.bans.a[0] === 'sim-hd1', 'new match remains usable');
});


test('simulator allows direct document navigation but blocks cross-site data requests', async t => {
  const stack = await boot(t);
  const status = path => new Promise((resolve, reject) => {
    get(stack.simulatorUrl + path, { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(await status('/'), 200);
  assert.equal(await status('/json/v2'), 403);
});
