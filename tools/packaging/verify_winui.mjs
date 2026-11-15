import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { availableLoopbackPort, fixtureDataDir } from './portable-fixture.mjs';

const [baseline, prototype, output] = process.argv.slice(2).map(value => resolve(value));
const standard = 'OCLR-Windows-x64';
const winui = 'OCLR-WinUI-Prototype-Windows-x64';
const temp = await mkdtemp(join(tmpdir(), 'OCLR WinUI 核验 '));
const profile = await fixtureDataDir(temp, '旧设置', 'OCLR/StreamOverlay');
const prefs = join(profile, 'OCLR/StreamOverlayLauncher');
const dataFile = join(profile, 'OCLR/StreamOverlay/session.json');
const report = { platform: process.platform, architecture: process.arch, samples: {}, verification: {} };
const children = new Set();
const powerShell = promisify(execFile);
const env = { ...process.env, LOCALAPPDATA: profile };
const base = port => `http://127.0.0.1:${port}`;
const config = port => fetch(base(port) + '/api/config').then(response => response.json());
const health = port => fetch(base(port) + '/api/health', { signal: AbortSignal.timeout(800) }).then(response => response.json()).catch(() => null);

async function until(check, description) {
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(25);
  }
  throw new Error('Timed out: ' + description);
}

function launch(directory, executable, args) {
  const child = spawn(join(directory, executable), args, { cwd: temp, windowsHide: args.length > 0, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', text => { stderr = (stderr + text).slice(-4096); });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => { children.delete(child); resolve(code); });
  });
  children.add(child);
  return { child, done, error: () => stderr };
}

async function ready(port, launcher) {
  return until(async () => {
    if (launcher.child.exitCode !== null) throw new Error('Launcher exited: ' + launcher.error());
    const status = await health(port);
    return status?.ready ? status : null;
  }, 'portable service readiness');
}

async function measure(directory, port) {
  const start = performance.now();
  const launcher = launch(directory, 'OCLR.exe', ['--headless']);
  await ready(port, launcher);
  const elapsed = Math.round(performance.now() - start);
  launcher.child.stdin.end();
  assert.equal(await launcher.done, 0, launcher.error());
  return elapsed;
}

try {
  const port = await availableLoopbackPort(0);
  const restartPort = await availableLoopbackPort(0);
  assert.ok(port && restartPort && port !== restartPort);
  await mkdir(prefs, { recursive: true });
  await writeFile(join(prefs, 'service-port.txt'), String(port));
  const programs = join(temp, '直播工具');
  await mkdir(programs);
  const tosuPath = join(programs, 'tosu.exe'), osuPath = join(programs, 'osu!.exe');
  await writeFile(tosuPath, 'fixture');
  await writeFile(osuPath, 'fixture');
  await writeFile(join(programs, 'tosu.env'), 'SERVER_PORT=25357\r\n');
  const oldSettings = JSON.stringify({ tosuPath, osuPath });
  await writeFile(join(prefs, 'settings.json'), oldSettings);

  report.zipBytes = {
    win32: (await stat(join(baseline, '..', standard + '.zip'))).size,
    winui: (await stat(join(prototype, '..', winui + '.zip'))).size,
  };
  report.samples = { win32: [], winui: [] };
  for (let i = 0; i < 5; i++) {
    for (const [key, directory] of i % 2 ? [['winui', prototype], ['win32', baseline]] : [['win32', baseline], ['winui', prototype]]) {
      report.samples[key].push(await measure(directory, port));
    }
  }
  report.medianReadyMs = Object.fromEntries(Object.entries(report.samples).map(([key, samples]) => [key, [...samples].sort((a, b) => a - b)[2]]));
  await access(dataFile);

  report.guiReadyMs = {};
  for (const [key, directory] of [['win32', baseline], ['winui', prototype]]) {
    const start = performance.now();
    const gui = launch(directory, 'OCLR.exe', []);
    const { pid } = await ready(port, gui);
    report.guiReadyMs[key] = Math.round(performance.now() - start);
    const { stdout } = await powerShell('powershell.exe', [
      '-NoProfile', '-Command', `(Get-Process -Id ${gui.child.pid} -ErrorAction Stop).MainWindowHandle`,
    ], { windowsHide: true, timeout: 10_000 });
    assert.ok(Number(stdout.trim()) > 0, key + ' window should be visible');
    assert.equal(await fetch(base(port) + '/control').then(response => response.status), 200);
    // End only the fixture window and wait for the service to drain after the pipe closes.
    gui.child.kill();
    await gui.done;
    await until(async () => {
      try { process.kill(pid, 0); return false; }
      catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    }, key + ' owning process exit drains the service');
  }
  report.verification.winuiWindowAndControl = true;

  const core = launch(prototype, 'OCLR-core.exe', ['--winui-host']);
  const lines = createInterface({ input: core.child.stdout })[Symbol.asyncIterator]();
  const request = async (action, value = '') => {
    core.child.stdin.write(JSON.stringify({ action, value }) + '\n');
    const line = await lines.next();
    assert.equal(line.done, false, core.error());
    return JSON.parse(line.value);
  };
  const started = await request('start');
  assert.equal(started.status, 'ready', started.detail);
  assert.equal(started.port, String(port));
  assert.deepEqual([started.tosuPath, started.osuPath], [tosuPath, osuPath]);
  assert.equal((await config(port)).tosuWsUrl, 'ws://127.0.0.1:25357/websocket/v2');
  report.verification.legacySettings = true;

  const before = await health(port);
  const saved = await readFile(dataFile, 'utf8');
  const invalid = await request('restart', '0');
  assert.match(invalid.detail, /1–65535/);
  assert.equal((await health(port)).pid, before.pid);
  const restarted = await request('restart', String(restartPort));
  assert.equal(restarted.status, 'ready', restarted.detail);
  assert.equal(restarted.port, String(restartPort));
  assert.notEqual((await health(restartPort)).pid, before.pid);
  assert.equal(await health(port), null);
  assert.equal(await readFile(dataFile, 'utf8'), saved);
  assert.equal(await readFile(join(prefs, 'settings.json'), 'utf8'), oldSettings);
  assert.equal(await readFile(join(prefs, 'service-port.txt'), 'utf8'), String(restartPort));
  assert.match((await request('logs')).log, /backend ready/);
  await request('stop');
  assert.equal(await core.done, 0, core.error());
  report.verification.restartAndLog = true;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  for (const child of children) child.stdin.end();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
