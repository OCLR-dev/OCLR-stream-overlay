import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { availableLoopbackPort, fixtureDataDir } from './portable-fixture.mjs';

const [baseline, windigo, output] = process.argv.slice(2).map(path => resolve(path));
const variants = { win32: baseline, windigo };
const guiScript = fileURLToPath(new URL('./verify_launcher_gui.ps1', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'OCLR 启动器比较 '));
const profile = await fixtureDataDir(temp, '旧设置', 'OCLR/StreamOverlay');
const prefs = join(profile, 'OCLR/StreamOverlayLauncher');
const dataFile = join(profile, 'OCLR/StreamOverlay/session.json');
const report = { platform: process.platform, node: process.version, architecture: process.arch, verification: {} };
const processes = new Set();
const url = (port, route) => 'http://127.0.0.1:' + port + route;
const health = port => fetch(url(port, '/api/health'), { signal: AbortSignal.timeout(500) })
  .then(response => response.json()).catch(() => null);
const run = promisify(execFile);
const variantsOrder = sample => sample % 2 === 0 ? ['win32', 'windigo'] : ['windigo', 'win32'];
const medians = byVariant => Object.fromEntries(Object.entries(byVariant).map(
  ([key, samples]) => [key, [...samples].sort((a, b) => a - b)[2]],
));

async function until(check, description) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(20);
  }
  throw new Error('Timed out waiting for ' + description);
}

function launch(directory, args) {
  const child = spawn(join(directory, 'OCLR.exe'), args, {
    cwd: temp, env: { ...process.env, LOCALAPPDATA: profile }, stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: args.length > 0,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
  const done = new Promise(resolve => {
    child.once('error', error => { stderr += error.message; });
    child.once('close', code => { processes.delete(child); resolve(code); });
  });
  child.stdin.on('error', () => {});
  processes.add(child);
  return { child, done, error: () => stderr };
}

function ready(port, launcher) {
  return until(async () => {
    if (!launcher.child.pid || launcher.child.exitCode !== null || launcher.child.signalCode !== null) {
      throw new Error('Launcher exited before readiness: ' + launcher.error());
    }
    const status = await health(port);
    return status?.ready ? status : null;
  }, 'local service readiness');
}

async function finish(launcher) {
  const code = await Promise.race([launcher.done, delay(12_000, 'timeout', { ref: false })]);
  assert.equal(code, 0, launcher.error());
}

async function gui(launcher, action, args = []) {
  await run('pwsh.exe', [
    '-NoProfile', '-File', guiScript, '-ProcessId', String(launcher.child.pid), '-Action', action, ...args,
  ], { windowsHide: true, timeout: 30_000 });
}

try {
  const port = await availableLoopbackPort(0);
  const next = await availableLoopbackPort(0);
  const tosuPort = await availableLoopbackPort(0);
  assert.equal(new Set([port, next, tosuPort]).size, 3);
  assert.ok([port, next, tosuPort].every(Boolean));
  const programs = join(temp, '直播工具');
  const tosuPath = join(programs, 'tosu.exe');
  const osuPath = join(programs, 'osu!.exe');
  const settings = JSON.stringify({ tosuPath, osuPath });
  await mkdir(programs);
  await mkdir(prefs, { recursive: true });
  await writeFile(tosuPath, 'fixture');
  await writeFile(osuPath, 'fixture');
  await writeFile(join(programs, 'tosu.env'), 'SERVER_PORT=' + tosuPort + '\r\n');
  await writeFile(join(prefs, 'settings.json'), settings);
  const portFile = join(prefs, 'service-port.txt');
  await writeFile(portFile, String(port));

  report.zipBytes = {};
  report.headlessSamplesMs = {};
  report.guiSamplesMs = {};
  const builds = {};
  for (const [key, directory] of Object.entries(variants)) {
    report.zipBytes[key] = (await stat(join(directory, '..', 'OCLR-Windows-x64.zip'))).size;
    report.headlessSamplesMs[key] = [];
    report.guiSamplesMs[key] = [];
    builds[key] = JSON.parse(await readFile(join(directory, 'app/portable-build.json'), 'utf8')).build;
  }

  for (let sample = 0; sample < 5; sample++) {
    for (const key of variantsOrder(sample)) {
      const start = performance.now();
      const launcher = launch(variants[key], ['--headless']);
      const status = await ready(port, launcher);
      report.headlessSamplesMs[key].push(Math.round(performance.now() - start));
      assert.equal(status.build, builds[key]);
      launcher.child.stdin.end();
      await finish(launcher);
    }
  }
  report.headlessMedianMs = medians(report.headlessSamplesMs);

  async function measureWindow(key, verify) {
    await writeFile(portFile, String(port));
    const start = performance.now();
    const launcher = launch(variants[key], []);
    const initial = await ready(port, launcher);
    report.guiSamplesMs[key].push(Math.round(performance.now() - start));
    assert.equal(initial.build, builds[key]);
    if (!verify) {
      await gui(launcher, 'Exit');
      await finish(launcher);
      assert.equal(await health(port), null);
      return;
    }
    for (const route of ['/control', '/overlay']) assert.equal((await fetch(url(port, route))).status, 200);
    const previousData = await readFile(dataFile);
    const expectedTosu = 'ws://127.0.0.1:' + tosuPort + '/websocket/v2';
    await until(async () => (await fetch(url(port, '/api/config')).then(r => r.json())).tosuWsUrl === expectedTosu, 'saved tosu endpoint');
    await gui(launcher, 'VerifyAndRestart', [
      '-Port', String(port), '-NewPort', String(next), '-TosuPath', tosuPath, '-OsuPath', osuPath,
    ]);
    const restarted = await ready(next, launcher);
    assert.equal(restarted.build, builds[key]);
    assert.notEqual(restarted.pid, initial.pid);
    assert.equal(await health(port), null);
    assert.equal(await readFile(portFile, 'utf8'), String(next));
    assert.equal(await readFile(join(prefs, 'settings.json'), 'utf8'), settings);
    assert.deepEqual(await readFile(dataFile), previousData);
    await gui(launcher, 'Exit');
    await finish(launcher);
    assert.equal(await health(next), null);
    report.verification[key] = { normalWindow: true, fourPages: true, legacySettings: true, restartAndExit: true };
  }
  for (let sample = 0; sample < 5; sample++) {
    for (const key of variantsOrder(sample)) await measureWindow(key, sample === 0);
  }
  report.guiMedianMs = medians(report.guiSamplesMs);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  for (const child of processes) {
    child.stdin.end();
    child.kill(); // Ends only our fixture; the Go process owns Node's stdin pipe.
  }
  const json = JSON.stringify(report, null, 2) + '\n';
  await writeFile(output, json);
  console.log(json);
}
