// Run using the *bundled* runtime on Windows. All data is isolated in TEMP.
import { spawn } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, mkdir, access, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, get } from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { availableLoopbackPort, fixtureDataDir } from './portable-fixture.mjs';

if (process.platform !== 'win32') throw new Error('Windows execution required');
const packageRoot = resolve(process.argv[2]);
const reportFile = resolve(process.argv[3]);
const manifest = JSON.parse(await readFile(join(packageRoot, 'app/portable-build.json'), 'utf8'));
const custom = manifest.kind === 'custom-match';
const executable = custom ? 'OCLR-Custom-Match.exe' : 'OCLR.exe';
const entryScript = custom ? 'custom-portable.js' : 'portable.js';
const matchData = custom ? 'CustomMatchTest' : 'StreamOverlay';
const defaultPort = custom ? 3011 : 3001;
const dataDir = join('OCLR', matchData);
const settingsDir = join('OCLR', matchData + 'Launcher');
const temp = await mkdtemp(join(tmpdir(), 'OCLR 中文 空格 '));
const first = join(temp, '第一版 程序');
const second = join(temp, '更新 程序');
const local = await fixtureDataDir(temp, '用户 数据', dataDir);
const data = join(local, join(dataDir, 'session.json'));
const launcherLog = join(local, join(settingsDir, 'launcher.log'));
const appPort = process.env.OCLR_VERIFY_PORT
  ? Number(process.env.OCLR_VERIFY_PORT)
  : await availableLoopbackPort(defaultPort) ?? await availableLoopbackPort(0);
assert.ok(Number.isInteger(appPort) && appPort > 0 && appPort <= 65535);
const base = `http://127.0.0.1:${appPort}`;
const results = [];
const children = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { platform: process.platform, arch: process.arch, node: process.version, temp, appPort, results };
function launch(folder, args = ['--headless'], localAppData = local) {
  const child = spawn(join(folder, executable), args, { cwd: tmpdir(), env: { ...process.env, LOCALAPPDATA: localAppData }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let error = '';
  child.stderr.on('data', chunk => { error += chunk; });
  const done = once(child, 'close').then(([code]) => { children.delete(child); return code; });
  children.add(child);
  return { child, done, error: () => error, async stop() { child.stdin.end(); assert.equal(await done, 0, error); } };
}
async function ready(launcher = running) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (launcher.child.exitCode !== null || launcher.child.signalCode !== null) {
      const code = await launcher.done;
      throw new Error(`Launcher exited before readiness (${launcher.child.signalCode ?? code}): ${launcher.error().trim() || 'no stderr'}`);
    }
    const h = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }).then(r => r.json()).catch(() => null);
    if (h?.ready) return h;
    await delay(200);
  }
  throw new Error(`Launcher readiness timed out on port ${appPort}`);
}
async function check(name, fn) { await fn(); results.push({ name, passed: true }); await writeFile(reportFile, JSON.stringify(report, null, 2)); }
async function waitForLog(pattern) {
  for (let i = 0; i < 100; i++) {
    const log = await readFile(launcherLog, 'utf8');
    if (pattern.test(log)) return log;
    await delay(200);
  }
  throw new Error('launcher log entry did not appear: ' + pattern);
}
let running;
try {
  await check('distributable includes project and third-party licenses', async () => {
    for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
      assert.equal(await readFile(join(packageRoot, name), 'utf8'), await readFile(new URL('../../' + name, import.meta.url), 'utf8'));
    }
    assert.equal(JSON.parse(await readFile(join(packageRoot, 'app/package.json'), 'utf8')).license, 'MIT');
  });
  await check('bundled tosu contains Windows x64 executable, env, provenance and matching source license', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'tosu/bundled-release.json'), 'utf8'));
    assert.match(manifest.bundledVersion, /^v/);
    assert.match(manifest.url, /^https:\/\/github.com\/tosuapp\/tosu\/releases\/download\//);
    assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
    const exe = await readFile(join(packageRoot, 'tosu/tosu.exe'));
    assert.equal(exe.subarray(0, 2).toString(), 'MZ');
    assert.equal(exe.readUInt16LE(exe.readUInt32LE(60) + 4), 0x8664);
    const source = await readFile(join(packageRoot, 'licenses/tosu/source.zip'));
    assert.equal(createHash('sha256').update(source).digest('hex'), manifest.sourceSha256);
    assert.ok((await readFile(join(packageRoot, 'licenses/tosu/LICENSE'))).length > 100);
    assert.ok((await readFile(join(packageRoot, 'licenses/tosu/GPL-3.0.txt'))).length > 100);
    assert.match(await readFile(join(packageRoot, 'tosu/tosu.env'), 'utf8'), /^SERVER_PORT=\d+/m);
    report.tosu = manifest;
  });
  await cp(packageRoot, first, { recursive: true });
  await cp(packageRoot, second, { recursive: true });
  // Isolated test endpoint; never connect these fixtures to the operator's tosu.
  const bundledTosuPort = await availableLoopbackPort(0);
  for (const folder of [first, second]) {
    const envPath = join(folder, 'tosu/tosu.env');
    const env = await readFile(envPath, 'utf8');
    await writeFile(envPath, env.replace(/^SERVER_PORT=.*$/m, `SERVER_PORT=${bundledTosuPort}`));
  }
  if (appPort !== defaultPort) {
    const prefs = join(local, settingsDir);
    await mkdir(prefs, { recursive: true });
    await writeFile(join(prefs, 'service-port.txt'), String(appPort));
  }
  await check('bundled WASM HR calculation works offline from a Unicode path', async () => {
    const { calculateBeatmap } = await import(pathToFileURL(join(first, 'app/server/beatmap-calculation.js')));
    const body = 'osu file format v14\n[General]\nMode:0\n[Difficulty]\nHPDrainRate:5\nCircleSize:4\nOverallDifficulty:9\nApproachRate:9\nSliderMultiplier:1.4\nSliderTickRate:1\n[TimingPoints]\n0,500,4,0,0,100,1,0\n[HitObjects]\n' +
      Array.from({ length: 16 }, (_, i) => `${64 + i % 4 * 112},${64 + i % 3 * 112},${1000 + i * 125},1,0,0:0:0:0:`).join('\n');
    const value = await calculateBeatmap(body, 'HR');
    assert.ok(value.stars > 0); assert.ok(Math.abs(value.cs - 5.2) < .001); assert.equal(value.ar, 10);
  });
  await check('native x64 first start from Chinese/spaced path; ready before control/overlay', async () => {
    running = launch(first);
    const h = await ready();
    report.build = h.build;
    assert.equal(h.session, true);
    assert.equal(h.build, JSON.parse(await readFile(join(first, 'app/portable-build.json'))).build);
    for (const page of ['/control', '/overlay']) assert.equal((await fetch(base+page)).status, 200);
  });
  if (custom) await check('Custom-Match starts with its configured local defaults and keeps website routes disabled', async () => {
    const { session, live } = await fetch(base + '/api/session').then(r => r.json());
    assert.equal(session.match.custom, true);
    if (manifest.template) {
      const template = JSON.parse(await readFile(join(first, 'app/match-template.json'), 'utf8'));
      assert.equal(session.match.title, template.title);
      assert.equal(session.match.bestOf, template.bestOf);
      assert.equal(session.pool.length, template.pool.length);
    } else {
      for (const file of ['app/match-template.json', '比赛配置.json', '图池录入.txt']) {
        await assert.rejects(access(join(first, file)), { code: 'ENOENT' });
      }
      assert.equal(session.match.title, '自定义赛事 · 待配置');
      assert.equal(session.match.stageName, '');
      assert.equal(session.match.bestOf, null);
      assert.equal(session.match.bpPreset, null);
      assert.equal(session.match.bpRule, '');
      assert.deepEqual(session.pool, []);
      assert.deepEqual(session.series, { a: 0, b: 0 });
    }
    assert.equal(session.auto.wsUrl, null);
    assert.equal(live.sources.launcherTosu, true);
    for (const route of ['/api/streaming', '/api/oclr/tournaments', '/api/showcase/website']) {
      assert.equal((await fetch(base + route)).status, 403);
    }
  });
  await check('fresh launcher resolves bundled tosu without saving an absolute preference', async () => {
    const expected = `ws://127.0.0.1:${bundledTosuPort}/websocket/v2`;
    for (let i = 0; i < 100; i++) {
      if ((await fetch(base + '/api/config').then(r => r.json())).tosuWsUrl === expected) break;
      await delay(100);
    }
    assert.equal((await fetch(base + '/api/config').then(r => r.json())).tosuWsUrl, expected);
    await assert.rejects(access(join(local, join(settingsDir, 'settings.json'))), { code: 'ENOENT' });
  });
  await check('desktop can frame the packaged console and Showcase without granting access to other origins or APIs', async () => {
    const request = (path, referer) => new Promise((resolve, reject) => {
      get(base + path, { headers: { Referer: referer, 'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'iframe' } }, response => {
        response.resume();
        resolve({ status: response.statusCode, policy: response.headers['content-security-policy'] });
      }).on('error', reject);
    });
    const shell = 'http://wails.localhost/';
    for (const path of ['/control?desktop=1', '/showcase?desktop=1']) {
      assert.deepEqual(await request(path, shell), { status: 200, policy: 'frame-ancestors http://wails.localhost' });
      assert.equal((await request(path, 'https://example.org/')).status, 403);
    }
    assert.equal((await request('/api/session?desktop=1', shell)).status, 403);
    assert.equal((await fetch(base + '/control?desktop-login=s11')).status, custom ? 403 : 200);
  });
  await check('repeated native launch reuses one server without changing match', async () => {
    const before = await readFile(data, 'utf8');
    const duplicate = launch(second);
    assert.equal(await duplicate.done, 0, duplicate.error());
    assert.equal(await readFile(data, 'utf8'), before);
  });
  await check('desktop control, browser control and independent output SSE synchronize; reloading control preserves the session', async () => {
    const aborts = [new AbortController(), new AbortController(), new AbortController()];
    const readers = await Promise.all(aborts.map(async controller => (await fetch(base+'/api/session/events', { signal: controller.signal })).body.getReader()));
    await Promise.all(readers.map(reader => reader.read()));
    const state = await fetch(base+'/api/session').then(r => r.json());
    const response = await fetch(base+'/api/session/command', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), version: state.session.version, type: 'setting', payload: { field: 'title', value: 'Windows 验收比赛' } }) });
    assert.equal(response.status, 200);
    for (const reader of readers) assert.match(new TextDecoder().decode((await reader.read()).value), /Windows 验收比赛/);
    aborts[0].abort();
    const refreshed = await fetch(base+'/api/session').then(r => r.json());
    assert.equal(refreshed.session.id, state.session.id);
    assert.equal(refreshed.session.match.title, 'Windows 验收比赛');
    assert.equal((await fetch(base+'/overlay')).status, 200);
    aborts[1].abort();
    aborts[2].abort();
  });
  await check('portable artwork survives pool setup, initialization and undo without stopping the native service', async () => {
    const command = async (type, payload) => {
      const { session } = await fetch(base+'/api/session').then(r => r.json());
      const response = await fetch(base+'/api/session/command', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: crypto.randomUUID(), version: session.version, type, payload }) });
      assert.equal(response.status, 200);
      return response.json();
    };
    await command('setting', { field: 'pool', value: [{ id: 'nm1', beatmapId: 101, setId: 42, mod: 'NM', label: 'NM1' }] });
    for (const kind of ['cover', 'list', 'fullsize', 'background']) {
      const image = await fetch(`${base}/api/beatmaps/101/${kind}`, { redirect: 'manual' });
      assert.equal(image.status, 302);
      assert.match(image.headers.get('location'), /^https:\/\/assets\.ppy\.sh\/beatmaps\/42\/covers\//);
    }
    await command('next-match', {});
    assert.equal((await fetch(base+'/api/beatmaps/101/cover', { redirect: 'manual' })).status, 404);
    assert.equal((await fetch(base+'/api/health').then(r => r.json())).ready, true);
    await command('undo', {});
    assert.equal((await fetch(base+'/api/beatmaps/101/cover', { redirect: 'manual' })).status, 302);
  });
  const saved = await readFile(data, 'utf8');
  await check('normal native exit releases service and fixed port', async () => {
    const { pid } = await ready();
    await running.stop(); running = null;
    await assert.rejects(fetch(base+'/api/health'));
    assert.match(await readFile(launcherLog, 'utf8'), new RegExp('backend exited pid=' + pid + ' exit_code=0'));
  });
  await check('restart from replacement program directory retains complete session and undo', async () => {
    running = launch(second); await ready();
    assert.equal(await readFile(data, 'utf8'), saved);
    assert.equal((await fetch(base+'/api/session').then(r => r.json())).session.canUndo, true);
    assert.equal((await fetch(base+'/api/beatmaps/101/cover', { redirect: 'manual' })).status, 302);
    await running.stop(); running = null;
  });
  await check('occupied port refuses start; other program remains alive', async () => {
    const server = createServer((req, res) => res.end('unrelated'));
    await new Promise(resolve => server.listen(appPort, '127.0.0.1', resolve));
    try {
      const blocked = launch(first);
      assert.equal(await blocked.done, 1);
      assert.equal(await fetch(base).then(r => r.text()), 'unrelated');
      assert.equal(await readFile(data, 'utf8'), saved);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
  await check('old backend is not silently reused', async () => {
    const server = createServer((req, res) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ project:'oclr-stream-overlay', ready:true, session:true, build:'old-version' })); });
    await new Promise(resolve => server.listen(appPort, '127.0.0.1', resolve));
    try { const blocked = launch(first); assert.equal(await blocked.done, 1); assert.equal((await fetch(base).then(r=>r.json())).build, 'old-version'); }
    finally { await new Promise(resolve => server.close(resolve)); }
  });
  await check('corrupt data refuses startup and preserves original bytes', async () => {
    await writeFile(data, 'corrupt original');
    try {
      const broken = launch(first);
      assert.equal(await broken.done, 1);
      const log = await readFile(launcherLog, 'utf8');
      assert.match(log, /backend stderr: "比赛记录无法读取/);
      assert.match(log, /backend exited pid=\d+ exit_code=1/);
      assert.equal(await readFile(data, 'utf8'), 'corrupt original');
    }
    finally { await writeFile(data, saved); }
  });
  await check('bundled runtime and native smoke-test exit cleanly', async () => {
    const smoke = launch(first, ['--smoke-test']); assert.equal(await smoke.done, 0, smoke.error());
  });
  await check('native launcher reads the saved executable directory and supplies the backend port', async () => {
    const fixture = createServer();
    fixture.on('upgrade', (_req, socket) => socket.destroy());
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
    try {
      const port = fixture.address().port;
      const tosuDir = join(temp, 'tosu 测试');
      const tosuPath = join(tosuDir, 'tosu.exe');
      await mkdir(tosuDir);
      await writeFile(tosuPath, 'fixture');
      await writeFile(join(tosuDir, 'tosu.env'), `SERVER_IP=127.0.0.1\r\nSERVER_PORT=${port}\r\n`);
      const preferences = join(local, settingsDir);
      await mkdir(preferences, { recursive: true });
      await writeFile(join(preferences, 'settings.json'), JSON.stringify({ tosuPath }));
      running = launch(first);
      await ready();
      const url = `ws://127.0.0.1:${port}/websocket/v2`;
      for (let i = 0; i < 25; i++) {
        if ((await fetch(base + '/api/config').then(r => r.json())).tosuWsUrl === url) break;
        await delay(100);
      }
      assert.equal((await fetch(base + '/api/config').then(r => r.json())).tosuWsUrl, url);
      await running.stop(); running = null;
    } finally { await new Promise(resolve => fixture.close(resolve)); }
  });
  await check('fully portable launcher retains its session and selected tools after moving the package', async () => {
    const packagePath = await fixtureDataDir(temp, '完全便携 旧目录', join('OCLR-data', matchData));
    const movedPackage = await fixtureDataDir(temp, '完全便携 新目录', join('OCLR-data', matchData));
    const unusedAppData = join(temp, '便携模式不应写入');
    const launcherDir = join('OCLR-data', matchData + 'Launcher');
    await cp(first, packagePath, { recursive: true });
    await mkdir(join(packagePath, launcherDir), { recursive: true });
    await mkdir(join(packagePath, join('OCLR-data', matchData)), { recursive: true });
    await mkdir(join(packagePath, 'custom tools'), { recursive: true });
    await writeFile(join(packagePath, 'OCLR-portable'), 'OCLR portable storage\n');
    await writeFile(join(packagePath, launcherDir, 'service-port.txt'), String(appPort));
    await writeFile(join(packagePath, join('OCLR-data', matchData, 'session.json')), saved);
    let port;
    do { port = await availableLoopbackPort(0); } while (port === bundledTosuPort);
    assert.ok(port);
    await writeFile(join(packagePath, 'custom tools', 'tosu.exe'), 'synthetic fixture, never launched');
    await writeFile(join(packagePath, 'custom tools', 'tosu.env'), `SERVER_PORT=${port}\r\n`);
    await writeFile(join(packagePath, 'custom tools', 'osu!.exe'), 'synthetic fixture, never launched');
    await writeFile(join(packagePath, launcherDir, 'settings.json'), JSON.stringify({
      tosuPath: '.\\custom tools\\tosu.exe', osuPath: '.\\custom tools\\osu!.exe',
    }));
    await rename(packagePath, movedPackage);
    running = launch(movedPackage, ['--headless'], unusedAppData);
    await ready();
    const { session } = await fetch(base + '/api/session').then(r => r.json());
    assert.equal(session.match.title, 'Windows 验收比赛');
    const expected = `ws://127.0.0.1:${port}/websocket/v2`;
    for (let i = 0; i < 25; i++) {
      if ((await fetch(base + '/api/config').then(r => r.json())).tosuWsUrl === expected) break;
      await delay(100);
    }
    assert.equal((await fetch(base + '/api/config').then(r => r.json())).tosuWsUrl, expected);
    await running.stop(); running = null;
    await access(join(movedPackage, launcherDir, 'launcher.log'));
    await assert.rejects(access(unusedAppData), { code: 'ENOENT' });
    assert.equal(await readFile(data, 'utf8'), saved);

    const { prepareStableReplay, stageReplayFile } = await import(pathToFileURL(join(movedPackage, 'app/server/showcase-replay-files.js')));
    const tempReplays = join(movedPackage, 'OCLR-data/ReplayTemp');
    process.env.OCLR_LAUNCHER_SETTINGS = join(movedPackage, launcherDir, 'settings.json');
    process.env.OCLR_REPLAY_TEMP = tempReplays;
    try {
      assert.equal(typeof await prepareStableReplay('unused.osr'), 'function');
      const replay = await stageReplayFile(Buffer.from('synthetic replay bytes'));
      assert.equal(resolve(replay.path, '../..'), tempReplays);
      await replay.dispose();
      await assert.rejects(access(replay.path), { code: 'ENOENT' });
    } finally {
      delete process.env.OCLR_LAUNCHER_SETTINGS;
      delete process.env.OCLR_REPLAY_TEMP;
    }
  });
  await check('native launcher keeps the same backend through timeouts and logs its eventual exit', async () => {
    // The copied package and marker stay in the temporary test workspace.
    const marker = join(second, 'fixture-mode.txt');
    await writeFile(marker, 'ready');
    await writeFile(join(second, 'app/server', entryScript), [
      "import { readFile } from 'node:fs/promises';",
      "import { createServer } from 'node:http';",
      "import { createInterface } from 'node:readline';",
      "const { build } = JSON.parse(await readFile(new URL('../portable-build.json', import.meta.url), 'utf8'));",
      "const marker = new URL('../../fixture-mode.txt', import.meta.url);",
      "const server = createServer(async (request, response) => {",
      "  const mode = await readFile(marker, 'utf8');",
      "  if (mode === 'timeout') return;",
      "  if (mode === 'exit') return process.stderr.write('synthetic final backend error', () => process.exit(23));",
      "  response.end(JSON.stringify({ project: 'oclr-stream-overlay', build, ready: true, session: true, pid: process.pid }));",
      "});",
      `server.listen(${appPort}, '127.0.0.1');`,
      "const input = createInterface({ input: process.stdin });",
      "input.on('close', () => { server.closeAllConnections(); server.close(); });",
    ].join('\n'));
    const monitored = launch(second);
    const { pid } = await ready(monitored);
    await waitForLog(new RegExp('backend ready pid=' + pid + '\\b'));
    await writeFile(marker, 'timeout');
    await waitForLog(new RegExp('health failed pid=' + pid + ' consecutive=3 .*reason=.*(?:Timeout|timeout)'));
    assert.equal(monitored.child.exitCode, null);
    await writeFile(marker, 'ready');
    await waitForLog(new RegExp('health recovered pid=' + pid + ' failures=3'));
    assert.equal((await ready(monitored)).pid, pid);
    await writeFile(marker, 'exit');
    const code = monitored.child.exitCode ?? (await once(monitored.child, 'exit', { signal: AbortSignal.timeout(10_000) }))[0];
    assert.equal(code, 23, monitored.error());
    const log = await readFile(launcherLog, 'utf8');
    assert.match(log, /backend stderr: "synthetic final backend error"/);
    assert.match(log, new RegExp('backend exited pid=' + pid + ' exit_code=23'));
  });
  report.passed = true;
  report.guiCommand = `LOCALAPPDATA=${local}; ${join(first, executable)}`;
  if (process.argv.includes('--gui')) {
    const gui = spawn(join(first, executable), [], { cwd: tmpdir(), env: { ...process.env, LOCALAPPDATA: local }, detached: true, stdio: 'ignore' });
    gui.unref();
  }
} catch (error) {
  report.passed = false; report.error = error.stack;
  const log = await readFile(launcherLog, 'utf8').catch(() => '');
  if (log) report.launcherLogTail = log.trimEnd().split(/\r?\n/).slice(-8);
  process.exitCode = 1;
} finally {
  for (const child of children) child.stdin.end();
  await writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
