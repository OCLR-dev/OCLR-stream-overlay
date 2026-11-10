// Exercise the exact packaged backend through HTTP and a real local WebSocket.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TosuSimulator } from '../tosu-simulator/server.js';

const packageRoot = resolve(process.argv[2]);
const reportFile = resolve(process.argv[3]);
const manifest = JSON.parse(await readFile(join(packageRoot, 'app/portable-build.json'), 'utf8'));
const template = JSON.parse(await readFile(join(packageRoot, 'app/match-template.json'), 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'MP5 R5 中文 空格 '));
const base = 'http://127.0.0.1:3011';
const checks = [];
const report = { platform: process.platform, runtime: process.version, build: manifest.build, label: manifest.label, checks };
const simulator = new TosuSimulator({ port: 0, getPool: () => template.pool });
let running;
let snapshot;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = () => snapshot.session.rounds.find(item => item.id === snapshot.session.currentRoundId);
async function get() { snapshot = await fetch(`${base}/api/session`).then(r => r.json()); return snapshot; }
async function until(check, label) {
  for (let i = 0; i < 160; i++) { await get(); if (check()) return; await sleep(50); }
  throw new Error(`Timeout: ${label}`);
}
async function cmd(type, payload = {}) {
  await get();
  const response = await fetch(`${base}/api/session/command`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: crypto.randomUUID(), version: snapshot.session.version, type, payload }) });
  snapshot = await response.json();
  assert.equal(response.status, 200, JSON.stringify(snapshot));
}
async function launch() {
  const child = spawn(process.execPath, [join(packageRoot, 'app/server/custom-portable.js')], {
    cwd: tmpdir(), env: { ...process.env, LOCALAPPDATA: directory }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  running = { child, done: once(child, 'exit') };
  for (let i = 0; i < 100; i++) {
    const health = await fetch(`${base}/api/health`).then(r => r.json()).catch(() => null);
    if (health?.build === manifest.build && health.ready) return;
    if (child.exitCode !== null) throw new Error(errors);
    await sleep(50);
  }
  throw new Error(`Startup timeout: ${errors}`);
}
async function stop() {
  if (!running) return;
  const old = running; running = null;
  old.child.stdin.end('shutdown\n');
  assert.equal((await old.done)[0], 0);
}
async function readyRoom(mapId) {
  simulator.set({ mapId, ipcState: 1, left: 0, right: 0, growing: false });
  await sleep(350);
}
try {
  await launch(); await get();
  assert.equal(snapshot.session.pool.length, 17);
  assert.equal(snapshot.session.match.bestOf, 9);
  assert.equal(snapshot.session.match.teams.a.name, template.teams.a.name);
  assert.equal(snapshot.session.match.teams.b.name, template.teams.b.name);
  assert.equal(snapshot.session.rounds.length, 0);
  for (const route of ['/control', '/overlay']) assert.equal((await fetch(base + route)).status, 200);
  assert.equal((await fetch(`${base}/api/oclr/tournaments`)).status, 403);
  assert.equal((await fetch(`${base}/.env.local`)).status, 404);
  checks.push('Packaged backend starts with the complete MP5 template, 0:0, working control/overlay and disabled OCLR access.');

  await simulator.start();
  await cmd('auto', { ...snapshot.session.auto, wsUrl: simulator.wsUrl });
  await until(() => snapshot.live.tosu.status === 'live', 'WebSocket connected');
  await cmd('warmup', { enabled: true });
  const formal = JSON.stringify([snapshot.session.rounds, snapshot.session.bans, snapshot.session.series, snapshot.session.scene]);
  simulator.set({ mapId: template.pool[0].beatmapId, ipcState: 3, left: 600000, right: 500000, growing: false });
  await sleep(400);
  simulator.set({ ipcState: 4 }); await sleep(550); await get();
  assert.equal(JSON.stringify([snapshot.session.rounds, snapshot.session.bans, snapshot.session.series, snapshot.session.scene]), formal);
  assert.equal(snapshot.live.tosu.data.tourney.totalScore.left, 600000);
  await readyRoom(template.pool[0].beatmapId);
  await cmd('warmup', { enabled: false });
  checks.push('Warm-up displays live totals through Playing/Ranking and exits at fresh Idle without changing formal records or scene.');

  await cmd('set-roll', { a: 90, b: 40, winner: 'a', banFirst: 'a', pickFirst: 'b' });
  for (const entry of template.pool.filter(item => ['HD1', 'HR1'].includes(item.id))) {
    await cmd('apply-bp', { entryId: entry.id, actionId: snapshot.session.action.id });
  }
  checks.push('Roll assigns independent first Ban/Pick and both opening Bans complete.');

  const entries = template.pool.filter(item => !['HD1', 'HR1', 'TB1'].includes(item.id)).slice(0, 8);
  for (const [i, entry] of entries.entries()) {
    await cmd('apply-bp', { entryId: entry.id, actionId: snapshot.session.action.id });
    await readyRoom(entry.beatmapId);
    simulator.set({ ipcState: 3, left: 250000, right: 200000 });
    await until(() => round()?.status === 'playing' && snapshot.session.scene === 'playing', `Playing ${entry.id}`);
    if (i === 0) {
      simulator.set({ ipcState: 1 });
      await until(() => round()?.status === 'prepared', 'aborted attempt returns to ready');
      simulator.set({ ipcState: 3 }); await until(() => round()?.status === 'playing', 'same map restarts');
      checks.push('Interrupted Playing returns to preparation and the same Pick restarts automatically.');
    }
    const winner = i % 2 === 0 ? 'a' : 'b';
    simulator.set({ ipcState: 4, left: winner === 'a' ? 1200000 : 1000000, right: winner === 'b' ? 1200000 : 1000000 });
    await until(() => round()?.status === 'recorded', `Ranking ${entry.id}`);
    assert.equal(round().winner, winner);
    if (i === 0) {
      const roundId = snapshot.session.currentRoundId;
      await cmd('retract-result', { roundId, reason: 'R5 撤回验证' });
      await sleep(500); await get(); assert.deepEqual(snapshot.session.series, { a: 0, b: 0 });
      await cmd('record-result', { roundId, winner: 'b', keepDisplay: true });
      await sleep(500); await get(); assert.deepEqual(snapshot.session.series, { a: 0, b: 1 });
      await cmd('correct-result', { roundId, winner: 'a', reason: 'R5 修正验证' });
      checks.push('Retracted result stays retracted under repeated Ranking; manual winner and correction stay effective.');
    }
    await sleep(350); await get();
    assert.deepEqual(snapshot.session.series, { a: Math.ceil((i + 1) / 2), b: Math.floor((i + 1) / 2) });
    await readyRoom(entry.beatmapId);
    await until(() => snapshot.session.scene === 'mappool', `return to pool ${entry.id}`);
  }
  assert.deepEqual(snapshot.session.series, { a: 4, b: 4 });
  checks.push('Eight regular maps automatically start, score once and return to Mappool, reaching 4:4.');
  const tb = template.pool.find(item => item.mod === 'TB');
  await cmd('prepare-round', { entryId: tb.id, tiebreaker: true });
  assert.equal(round().pickedBy, null);
  await readyRoom(tb.beatmapId);
  simulator.set({ ipcState: 3 }); await until(() => round()?.status === 'playing', 'TB Playing');
  simulator.set({ ipcState: 4, left: 1500000, right: 1400000 });
  await until(() => round()?.status === 'recorded', 'TB recorded');
  assert.deepEqual(snapshot.session.series, { a: 5, b: 4 });
  assert.notEqual(snapshot.session.scene, 'victory');
  await cmd('winner', { team: 'a' }); assert.equal(snapshot.session.scene, 'victory');
  checks.push('Separate TB has no Pick owner, automatically reaches 5:4 and Winner is explicitly displayed.');

  // Stop the signal before restart so it cannot add irrelevant live baseline updates.
  await simulator.stop();
  await sleep(150); await get();
  const id = snapshot.session.id;
  const rounds = structuredClone(snapshot.session.rounds);
  const saved = await readFile(join(directory, 'OCLR/CustomMatchTest/session.json'), 'utf8');
  await stop(); await launch(); await get();
  assert.equal(snapshot.session.id, id);
  assert.deepEqual(snapshot.session.series, { a: 5, b: 4 });
  assert.deepEqual(snapshot.session.rounds, rounds);
  assert.equal(snapshot.session.rounds.filter(item => item.status === 'recorded').length, 9);
  assert.equal(snapshot.session.scene, 'victory');
  assert.equal(snapshot.session.canUndo, true);
  assert.equal(await readFile(join(directory, 'OCLR/CustomMatchTest/session.json'), 'utf8'), saved);
  checks.push('Restart restores the exact saved session with nine recorded maps, the interrupted attempt, 5:4, Winner and undo history.');
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack; process.exitCode = 1;
} finally {
  await stop();
  if (simulator.server.listening) await simulator.stop();
  await rm(directory, { recursive: true, force: true });
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
