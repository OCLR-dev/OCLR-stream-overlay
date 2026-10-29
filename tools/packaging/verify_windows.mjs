// Run using the *bundled* runtime on Windows. All data is isolated in TEMP.
import { spawn } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { once } from 'node:events';

if (process.platform !== 'win32') throw new Error('Windows execution required');
const packageRoot = resolve(process.argv[2]);
const reportFile = resolve(process.argv[3]);
const temp = await mkdtemp(join(tmpdir(), 'OCLR 中文 空格 '));
const first = join(temp, '第一版 程序');
const second = join(temp, '更新 程序');
const local = join(temp, '用户 数据');
const data = join(local, 'OCLR/StreamOverlay/session.json');
const base = 'http://127.0.0.1:3001';
const results = [];
const children = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { platform: process.platform, arch: process.arch, node: process.version, temp, results };
function launch(folder, args = ['--headless']) {
  const child = spawn(join(folder, 'OCLR.exe'), args, { cwd: tmpdir(), env: { ...process.env, LOCALAPPDATA: local }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let error = '';
  child.stderr.on('data', chunk => { error += chunk; });
  const done = once(child, 'exit').then(([code]) => { children.delete(child); return code; });
  children.add(child);
  return { child, done, error: () => error, async stop() { child.stdin.end(); assert.equal(await done, 0, error); } };
}
async function ready() {
  for (let i = 0; i < 150; i++) {
    const h = await fetch(`${base}/api/health`).then(r => r.json()).catch(() => null);
    if (h?.ready) return h;
    await delay(200);
  }
  throw new Error('readiness timeout');
}
async function check(name, fn) { await fn(); results.push({ name, passed: true }); await writeFile(reportFile, JSON.stringify(report, null, 2)); }
let running;
try {
  await cp(packageRoot, first, { recursive: true });
  await cp(packageRoot, second, { recursive: true });
  await check('native x64 first start from Chinese/spaced path; ready before control/overlay', async () => {
    running = launch(first);
    const h = await ready();
    report.build = h.build;
    assert.equal(h.session, true);
    assert.equal(h.build, JSON.parse(await readFile(join(first, 'app/portable-build.json'))).build);
    for (const page of ['/control', '/overlay']) assert.equal((await fetch(base+page)).status, 200);
  });
  await check('repeated native launch reuses one server without changing match', async () => {
    const before = await readFile(data, 'utf8');
    const duplicate = launch(second);
    assert.equal(await duplicate.done, 0, duplicate.error());
    assert.equal(await readFile(data, 'utf8'), before);
  });
  await check('controller and independent output SSE synchronize; closing controller leaves output alive', async () => {
    const aborts = [new AbortController(), new AbortController()];
    const readers = await Promise.all(aborts.map(async controller => (await fetch(base+'/api/session/events', { signal: controller.signal })).body.getReader()));
    await Promise.all(readers.map(reader => reader.read()));
    const state = await fetch(base+'/api/session').then(r => r.json());
    const response = await fetch(base+'/api/session/command', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), version: state.session.version, type: 'setting', payload: { field: 'title', value: 'Windows 验收比赛' } }) });
    assert.equal(response.status, 200);
    for (const reader of readers) assert.match(new TextDecoder().decode((await reader.read()).value), /Windows 验收比赛/);
    aborts[0].abort();
    assert.equal((await fetch(base+'/overlay')).status, 200);
    aborts[1].abort();
  });
  const saved = await readFile(data, 'utf8');
  await check('normal native exit releases service and fixed port', async () => {
    await running.stop(); running = null;
    await assert.rejects(fetch(base+'/api/health'));
  });
  await check('restart from replacement program directory retains complete session and undo', async () => {
    running = launch(second); await ready();
    assert.equal(await readFile(data, 'utf8'), saved);
    assert.equal((await fetch(base+'/api/session').then(r => r.json())).session.canUndo, true);
    await running.stop(); running = null;
  });
  await check('occupied port refuses start; other program remains alive', async () => {
    const server = createServer((req, res) => res.end('unrelated'));
    await new Promise(resolve => server.listen(3001, '127.0.0.1', resolve));
    try {
      const blocked = launch(first);
      assert.equal(await blocked.done, 1);
      assert.equal(await fetch(base).then(r => r.text()), 'unrelated');
      assert.equal(await readFile(data, 'utf8'), saved);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
  await check('old backend is not silently reused', async () => {
    const server = createServer((req, res) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ project:'oclr-stream-overlay', ready:true, session:true, build:'old-version' })); });
    await new Promise(resolve => server.listen(3001, '127.0.0.1', resolve));
    try { const blocked = launch(first); assert.equal(await blocked.done, 1); assert.equal((await fetch(base).then(r=>r.json())).build, 'old-version'); }
    finally { await new Promise(resolve => server.close(resolve)); }
  });
  await check('corrupt data refuses startup and preserves original bytes', async () => {
    await writeFile(data, 'corrupt original');
    try { const broken = launch(first); assert.equal(await broken.done, 1); assert.equal(await readFile(data,'utf8'),'corrupt original'); }
    finally { await writeFile(data, saved); }
  });
  await check('bundled runtime and native smoke-test exit cleanly', async () => {
    const smoke = launch(first, ['--smoke-test']); assert.equal(await smoke.done, 0, smoke.error());
  });
  report.passed = true;
  report.guiCommand = `LOCALAPPDATA=${local}; ${join(first, 'OCLR.exe')}`;
  if (process.argv.includes('--gui')) {
    const gui = spawn(join(first, 'OCLR.exe'), [], { cwd: tmpdir(), env: { ...process.env, LOCALAPPDATA: local }, detached: true, stdio: 'ignore' });
    gui.unref();
  }
} catch (error) {
  report.passed = false; report.error = error.stack;
  process.exitCode = 1;
} finally {
  for (const child of children) child.stdin.end();
  await writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
