import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startSimulation } from '../tosu-simulator/stack.js';

// Adversarial characterization, not a declaration of real osu! IPC ordering.
// Every score and player here belongs to the isolated synthetic simulator.
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: npm run sim:timing -- [--out report.json]');
const output = resolve(args[1] || `.local/diagnostics/result-timing-${Date.now()}.json`);
const stack = await startSimulation({ appPort: 0, wsPort: 0 });
const results = [];
let transform = value => value;
const originalWire = stack.simulator.wire.bind(stack.simulator);
stack.simulator.wire = () => JSON.stringify(transform(JSON.parse(originalWire())));
const current = () => stack.store.state.rounds.find(r => r.id === stack.store.state.currentRoundId);
const inspect = () => {
  const { session } = stack.store.snapshot();
  return { scene: session.scene, status: current()?.status, series: session.series,
    incident: session.incident?.kind || null, finalScore: current()?.finalScore || null };
};
async function until(predicate, label) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error(`Probe setup timed out: ${label}`);
}
const command = (type, payload) => stack.store.command({ id: crypto.randomUUID(), version: stack.store.state.version, type, payload });
async function prepare() {
  transform = value => value;
  await stack.simulator.reset();
  await command('set-action', { action: { kind: 'pick', team: 'a' }, queue: [{ kind: 'pick', team: 'b' }] });
  await command('apply-bp', { entryId: 'sim-nm1' });
  stack.simulator.set({ mapId: 710001, ipcState: 1, growing: false });
  await delay(600);
}
async function play() {
  stack.simulator.set({ ipcState: 3 });
  await until(() => current()?.status === 'playing', 'Playing');
}
const send = async (patch, ms = 450) => { stack.simulator.set(patch); await delay(ms); };
const noWin = s => s.series.a === 0 && s.series.b === 0;
async function probe(id, description, exercise, expected) {
  await prepare();
  const samples = [];
  const sample = label => { const value = { label, ...inspect() }; samples.push(value); return value; };
  await exercise(sample);
  const pass = expected(samples);
  results.push({ id, description, pass, samples });
  console.log(`${pass ? 'PASS' : 'RISK'} ${id}: ${description}`);
}

try {
  await until(() => stack.store.live.tosu.status === 'live', 'WebSocket');
  await probe('normal', '正常连续 Playing → Ranking', async sample => {
    await play(); await send({ ipcState: 4, left: 1200, right: 1000 }); sample('final');
  }, s => s[0].series.a === 1);
  await probe('late-ipc', '最后一路未结束期间 IPC 保持 Playing，旧分数停住', async sample => {
    await play(); await send({ left: 1200, right: 1000 }, 1200); sample('still-playing');
    await send({ ipcState: 4, left: 1200, right: 1500 }); sample('last-player-finished');
  }, s => noWin(s[0]) && s[0].scene === 'playing' && s[1].series.b === 1);
  await probe('early-ipc', 'Ranking 提前，旧的有效队分冻结 1.2 秒后反转胜方', async sample => {
    await play(); await send({ ipcState: 4, left: 1200, right: 1000 }, 1200); sample('before-late-score');
    await send({ right: 1500 }); sample('late-score');
  }, s => noWin(s[0]) && s[1].series.b === 1 && s[1].series.a === 0);
  await probe('missing-total', 'Ranking 先到，但最终队分缺失，之后才补齐', async sample => {
    await play(); await send({ ipcState: 4, left: null, right: null }, 700); sample('missing');
    await send({ left: 1200, right: 1500 }); sample('complete');
  }, s => noWin(s[0]) && s[1].series.b === 1);
  await probe('tied-total', 'Ranking 先到，暂时平分，随后补齐', async sample => {
    await play(); await send({ ipcState: 4, left: 1000, right: 1000 }, 700); sample('tie');
    await send({ right: 1500 }); sample('complete');
  }, s => noWin(s[0]) && s[1].series.b === 1);
  await probe('changing-total', 'Ranking 期间持续更新队分，每次间隔短于防抖', async sample => {
    await play();
    for (const right of [1100, 1200, 1300, 1400]) await send({ ipcState: 4, left: 1000, right }, 100);
    sample('updating'); await send({ right: 1500 }); sample('stable');
  }, s => noWin(s[0]) && s[1].series.b === 1);
  await probe('true-zero', '真实零分与缺失值区分', async sample => {
    await play(); await send({ ipcState: 4, left: 0, right: 500 }); sample('zero');
  }, s => s[0].series.b === 1 && s[0].finalScore.a === 0);
  await probe('first-ranking', '首次收到的就是 Ranking，未观察到本次 Playing', async sample => {
    await send({ ipcState: 4, left: 1200, right: 1500 }, 700); sample('unobserved-run');
  }, s => noWin(s[0]) && s[0].status === 'prepared');
  await probe('ipc-blip', 'Ranking 短暂出现后返回 Playing', async sample => {
    await play(); await send({ ipcState: 4, left: 1200, right: 1000 }, 100);
    await send({ ipcState: 3 }, 350); sample('returned-playing');
    await send({ ipcState: 4, right: 1500 }); sample('real-ranking');
  }, s => noWin(s[0]) && s[0].status === 'playing' && s[1].series.b === 1);
  await probe('client-still-incomplete', '一路命中数未完成，管理器已 Ranking', async sample => {
    await play();
    transform = value => {
      const client = value.tourney?.clients?.[0];
      if (client) { client.play.score = 10; client.play.hits = { ...client.play.hits, '300': 1, '100': 0, '50': 0, '0': 0 }; }
      return value;
    };
    await send({ ipcState: 4, left: 1200, right: 1000 }, 700); sample('one-client-incomplete');
  }, s => noWin(s[0]));
  await probe('manager-client-race', '管理器队分与各选手求和不一致', async sample => {
    await play();
    transform = value => { if (value.tourney?.clients?.[0]) value.tourney.clients[0].play.score = 0; return value; };
    await send({ ipcState: 4, left: 1200, right: 1000 }, 700); sample('inconsistent-snapshot');
  }, s => noWin(s[0]));
  await probe('coherent-stale', '全体字段一致但实际是旧快照，IPC 单独先变 Ranking', async sample => {
    await play(); await send({ ipcState: 4, left: 1200, right: 1000 }, 1600); sample('coherent-but-not-final');
  }, s => noWin(s[0]));
  await probe('late-same-winner', '先自动计胜后总分继续上涨：撤回自动加分，等待核对', async sample => {
    await play(); await send({ ipcState: 4, left: 1200, right: 1000 });
    await send({ left: 1600, right: 1100 }); sample('late-final-totals');
  }, s => noWin(s[0]) && s[0].status === 'ranking' && s[0].incident === 'unverified');
  await probe('single-results-screen', '单个选中实例先到 ResultsScreen，但赛事 IPC 仍是 Playing', async sample => {
    await play(); transform = value => ({ ...value, state: { number: 7, name: 'ResultsScreen' } });
    await send({ left: 1200, right: 1000 }, 700); sample('single-client-results');
  }, s => noWin(s[0]) && s[0].scene === 'playing');
  await probe('past-map-duration', '播放时间超过谱面末尾，但赛事仍是 Playing', async sample => {
    await play(); transform = value => { value.beatmap.time.live = value.beatmap.time.lastObject + 60000; return value; };
    await send({ left: 1200, right: 1000 }, 700); sample('past-duration');
  }, s => noWin(s[0]) && s[0].scene === 'playing');
  await probe('missing-spectator', '最后一路窗口消失后仍收到 Ranking', async sample => {
    await play(); await send({ missingClient: true }, 200);
    await send({ ipcState: 4, left: 1200, right: 1000 }); sample('missing-client');
  }, s => noWin(s[0]) && s[0].incident === 'unverified');
  await probe('abort-before-ranking', 'Playing → Idle → 旧 Ranking', async sample => {
    await play(); await send({ ipcState: 1 }, 200);
    await send({ ipcState: 4, left: 1200, right: 1000 }); sample('aborted');
  }, s => noWin(s[0]) && s[0].incident === 'unverified');
  const report = { generatedAt: new Date().toISOString(), transport: 'real localhost WebSocket / synthetic tosu frames',
    actualOsuTested: false, summary: { total: results.length, pass: results.filter(r => r.pass).length, risk: results.filter(r => !r.pass).length }, results };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report.summary, report: output }));
  process.exitCode = report.summary.risk ? 1 : 0;
} finally { await stack.stop(); }
