import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { startSimulation } from '../tools/tosu-simulator/stack.js';

test('live timing recorder captures ordered raw IPC/zero/missing totals and markers without names or chat', { timeout: 6000 }, async t => {
  const stack = await startSimulation({ appPort: 0, wsPort: 0 });
  t.after(() => stack.stop());
  const dir = await mkdtemp(join(tmpdir(), 'oclr-timing-recorder-'));
  t.after(() => rm(dir, { recursive: true }));
  const output = join(dir, 'trace.ndjson');
  stack.simulator.set({ growing: false, left: 0, right: null });
  const child = spawn(process.execPath, [fileURLToPath(new URL('../tools/tosu-diagnostics/record.js', import.meta.url)),
    '--url', stack.simulator.wsUrl, '--duration', '1', '--out', output], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stderr = '';
  child.stderr.on('data', part => { stderr += part; }); child.stdout.resume();
  const exit = new Promise((resolveExit, reject) => { child.once('exit', resolveExit); child.once('error', reject); });
  child.stdin.end('模拟：其他人已结束\n');
  await delay(450); stack.simulator.set({ ipcState: 4, left: 100, right: 200 });
  assert.equal(await exit, 0, stderr);
  const data = await readFile(output, 'utf8'); const lines = data.trim().split('\n').map(JSON.parse);
  const frames = lines.filter(line => line.event === 'frame');
  assert.ok(frames.length >= 3);
  assert.ok(frames.some(f => f.ipcState === 1 && f.totalScore.left === 0 && f.totalScore.right === null));
  assert.ok(frames.some(f => f.ipcState === 4 && f.totalScore.right === 200));
  assert.ok(lines.some(line => line.event === 'marker' && line.label === '模拟：其他人已结束'));
  assert.ok(frames.every((frame, index) => frame.sequence === index + 1));
  assert.ok(lines.every((line, index) => !index || line.elapsedMs >= lines[index - 1].elapsedMs));
  assert.ok(!data.includes('SIM-A1')); assert.ok(!data.includes('模拟 WebSocket 已启动'));
  assert.equal(lines.at(-1).event, 'stop'); assert.equal(lines.at(-1).validFrames, frames.length);
});
