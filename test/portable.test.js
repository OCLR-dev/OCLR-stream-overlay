import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preparePortableData } from '../server/portable-data.js';
import { simulationSession } from '../tools/tosu-simulator/fixture.js';
import { calculationFixture } from './calculation-fixture.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'http://127.0.0.1:3001';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function packageAt(dir, build) {
  await mkdir(dir, { recursive: true });
  for (const name of ['server', 'src', 'dist']) await cp(join(root, name), join(dir, name), { recursive: true });
  await cp(join(root, 'node_modules/rosu-pp-js'), join(dir, 'node_modules/rosu-pp-js'), { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"type":"module"}');
  await writeFile(join(dir, 'portable-build.json'), JSON.stringify({ build }));
}
function launch(app, dataDir) {
  const child = spawn(process.execPath, [join(app, 'server/portable.js')], {
    cwd: tmpdir(), env: { ...process.env, OCLR_DATA_DIR: dataDir }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = once(child, 'exit');
  return { child, done, error: () => stderr, async stop() { child.stdin.end('shutdown\n'); return done; } };
}
async function ready(build) {
  for (let n = 0; n < 100; n += 1) {
    const value = await fetch(`${base}/api/health`).then(r => r.json()).catch(() => null);
    if (value?.ready && value.build === build) return value;
    await pause(100);
  }
  throw new Error('Portable server did not become ready');
}

test('portable lifecycle: fixed address, Unicode paths, SSE, repeated launch, restart, update and data recovery', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'OCLR 中文 空格 '));
  const data = join(directory, '用户 数据');
  const app = join(directory, '第一版 程序/app');
  const next = join(directory, '更新版 程序/app');
  const build = 'a'.repeat(64), nextBuild = 'b'.repeat(64);
  let running;
  try {
    await packageAt(app, build);
    const calculator = await import(pathToFileURL(join(app, 'server/beatmap-calculation.js')));
    const calculated = await calculator.calculateBeatmap(calculationFixture(), 'HR');
    assert.ok(calculated.stars > 0); assert.ok(Math.abs(calculated.cs - 5.2) < .001);
    running = launch(app, data);
    const health = await ready(build);
    assert.equal(health.session, true);
    assert.equal(health.portable, true);
    assert.equal((await fetch(`${base}/api/config`).then(r => r.json())).tosuWsUrl, 'ws://127.0.0.1:24050/websocket/v2');
    const initial = JSON.parse(await readFile(join(data, 'session.json'), 'utf8'));
    assert.equal((await fetch(`${base}/control`)).status, 200);
    assert.equal((await fetch(`${base}/overlay`)).status, 200);
    const controlAbort = new AbortController();
    const outputAbort = new AbortController();
    const [control, output] = await Promise.all([controlAbort, outputAbort].map(controller => fetch(`${base}/api/session/events`, { signal: controller.signal })));
    const controlReader = control.body.getReader(), outputReader = output.body.getReader();
    await controlReader.read(); await outputReader.read();
    const response = await fetch(`${base}/api/session/command`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), version: initial.version, type: 'setting', payload: { field: 'title', value: '保留比赛与撤销' } }) });
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.session.match.title, '保留比赛与撤销');
    assert.match(new TextDecoder().decode((await controlReader.read()).value), /保留比赛与撤销/);
    assert.match(new TextDecoder().decode((await outputReader.read()).value), /保留比赛与撤销/);
    controlAbort.abort(); // Equivalent to closing the controller connection.
    assert.equal((await fetch(`${base}/overlay`)).status, 200);
    const duplicate = launch(app, data);
    assert.equal((await duplicate.done)[0], 1);
    assert.match(duplicate.error(), /已在运行/);
    const saved = await readFile(join(data, 'session.json'), 'utf8');
    outputAbort.abort();
    assert.equal((await running.stop())[0], 0); running = null;
    running = launch(app, data); await ready(build);
    assert.equal(await readFile(join(data, 'session.json'), 'utf8'), saved);
    await running.stop(); running = null;
    await packageAt(next, nextBuild);
    running = launch(next, data); await ready(nextBuild);
    assert.equal(await readFile(join(data, 'session.json'), 'utf8'), saved);
    assert.equal(await readFile(join(data, 'backups', nextBuild, 'session.json'), 'utf8'), saved);
    const recovered = await fetch(`${base}/api/session`).then(r => r.json());
    assert.equal(recovered.session.id, initial.id);
    assert.equal(recovered.session.canUndo, true);
    assert.equal(recovered.session.match.title, '保留比赛与撤销');
    await running.stop(); running = null;
    // Occupied output port must fail without creating data or moving to another port.
    const occupied = createServer((req, res) => res.end('unrelated service'));
    await new Promise((resolve, reject) => { occupied.once('error', reject); occupied.listen(3001, '127.0.0.1', resolve); });
    try {
      const blockedData = join(directory, '不能创建');
      const blocked = launch(app, blockedData);
      assert.equal((await blocked.done)[0], 1);
      assert.match(blocked.error(), /3001/);
      await assert.rejects(access(blockedData));
      assert.equal(await fetch(base).then(r => r.text()), 'unrelated service');
    } finally { await new Promise(resolve => occupied.close(resolve)); }
    // Corrupt sessions are retained, not replaced by an empty match.
    await writeFile(join(data, 'session.json'), 'broken original');
    const bad = launch(app, data);
    assert.equal((await bad.done)[0], 1);
    assert.match(bad.error(), /原文件已保留/);
    assert.equal(await readFile(join(data, 'session.json'), 'utf8'), 'broken original');
  } finally {
    if (running) await running.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('legacy migration backs up complete state/archive, survives replacement and refuses invalid/conflicting data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oclr-migration-'));
  try {
    const old = join(directory, '.local'), data = join(directory, 'stable');
    await mkdir(join(old, 'archive'), { recursive: true });
    const state = simulationSession();
    state.match.title = '旧比赛完整保留';
    const bytes = JSON.stringify(state);
    await writeFile(join(old, 'session.json'), bytes);
    await writeFile(join(old, 'archive/previous.json'), bytes);
    const file = await preparePortableData(data, old);
    assert.equal(await readFile(file, 'utf8'), bytes);
    assert.equal(await readFile(join(data, 'archive/previous.json'), 'utf8'), bytes);
    assert.equal(await readFile(join(old, 'session.json'), 'utf8'), bytes);
    const backup = (await readdir(directory)).find(name => name.startsWith('.local-backup-'));
    assert.equal(await readFile(join(directory, backup, 'session.json'), 'utf8'), bytes);
    await writeFile(join(old, 'session.json'), 'corrupted old file');
    assert.equal(await preparePortableData(data, old), file);
    await assert.rejects(preparePortableData(join(directory, 'new-target'), old), /SESSION_RESTORE_FAILED/);
    await writeFile(join(old, 'session.json'), bytes);
    await mkdir(join(directory, 'conflict'));
    await assert.rejects(preparePortableData(join(directory, 'conflict'), old), /DATA_MIGRATION_CONFLICT/);
    assert.equal(await readFile(file, 'utf8'), bytes);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
