import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { availableLoopbackPort, fixtureDataDir } from './portable-fixture.mjs';

const { values } = parseArgs({ options: {
  samples: { type: 'string', default: '7' },
  gap: { type: 'string', default: '250' },
  'wails-only': { type: 'boolean', default: false },
  'force-exit': { type: 'boolean', default: false },
} });
const count = Number(values.samples);
const gapMs = Number(values.gap);
assert.ok(Number.isInteger(count) && count > 0 && count <= 100, 'samples must be 1–100');
assert.ok(Number.isInteger(gapMs) && gapMs >= 0 && gapMs <= 10_000, 'gap must be 0–10000 ms');
const variants = values['wails-only'] ? ['wails'] : ['win32', 'windigo', 'wails'];
const forceExit = values['force-exit'];
assert.ok(!forceExit || values['wails-only'], '--force-exit requires --wails-only');
const dir = resolve('.local/launcher-benchmark');
const runDir = join(dir, 'run-' + Date.now());
const prepared = JSON.parse(await readFile(join(dir, 'prepared.json'), 'utf8'));
const build = JSON.parse(await readFile('release/OCLR-Windows-x64/app/portable-build.json', 'utf8')).build;
assert.equal(prepared.build, build, 'Package changed; prepare the benchmark again');
const port = await availableLoopbackPort(0);
assert.ok(port, 'No isolated loopback port available');
const endpoint = 'http://127.0.0.1:' + port;
const profiles = {};
for (const variant of variants) {
  const profile = await fixtureDataDir(runDir, 'profile-' + variant, 'OCLR/StreamOverlay');
  const prefs = join(profile, 'OCLR/StreamOverlayLauncher');
  await mkdir(prefs, { recursive: true });
  await writeFile(join(prefs, 'service-port.txt'), String(port));
  profiles[variant] = { profile, log: join(prefs, 'launcher.log'), stopFile: join(profile, 'benchmark-stop') };
}

const health = () => fetch(endpoint + '/api/health', { signal: AbortSignal.timeout(250) })
  .then(response => response.json()).catch(() => null);

async function measure(variant) {
  const { profile, log, stopFile } = profiles[variant];
  await rm(stopFile, { force: true });
  await writeFile(log, '');
  const started = Date.now();
  const clock = performance.now();
  const child = spawn(join(dir, variant, 'OCLR.exe'), [], {
    cwd: dir,
    env: { ...process.env, LOCALAPPDATA: profile, OCLR_BENCH_STOP: stopFile },
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let stderr = '';
  let spawnError;
  child.on('error', error => { spawnError = error; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});
  const done = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  let healthMs, frameMs, readyMs, webviewMs;
  try {
    while (performance.now() - clock < 20_000) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw Error(variant + ' exited before readiness: ' + stderr);
      }
      if (healthMs === undefined) {
        const status = await health();
        if (status?.ready && status.build === build) healthMs = Math.round(performance.now() - clock);
      }
      const contents = await readFile(log, 'utf8').catch(() => '');
      const lines = contents.split(/\r?\n/);
      const mark = stage => {
        const line = lines.find(line => line.endsWith('benchmark_' + stage));
        return line ? Date.parse(line.split(' ')[0]) - started : undefined;
      };
      frameMs ??= mark('frame');
      readyMs ??= mark('ready');
      const webview = contents.match(/WebView2 initialized elapsed_ms=(\d+)/);
      if (webview) webviewMs = Number(webview[1]);
      if (healthMs !== undefined && frameMs !== undefined && readyMs !== undefined) break;
      await delay(15);
    }
    assert.ok([healthMs, frameMs, readyMs].every(Number.isFinite),
      variant + ' incomplete markers: ' + JSON.stringify({ healthMs, frameMs, readyMs }));
    if (variant === 'wails') assert.ok(Number.isFinite(webviewMs), 'Missing WebView2 initialization marker');
    if (forceExit) {
      child.kill(); // Only the isolated benchmark launcher. Node handles stdin EOF.
    } else {
      await writeFile(stopFile, 'stop');
    }
    const closed = await Promise.race([done, delay(10_000, null, { ref: false })]);
    if (forceExit) {
      assert.equal(closed?.signal, 'SIGTERM', 'Benchmark launcher was not terminated');
    } else {
      assert.equal(closed?.code, 0, variant + ' did not exit normally: ' + stderr);
    }
    const shutdownDeadline = Date.now() + 10_000;
    while (await health()) {
      if (Date.now() > shutdownDeadline) throw Error('Owned backend did not stop after launcher exit');
      await delay(25);
    }
    if (gapMs) await delay(gapMs);
    return { healthMs, frameMs, readyMs, webviewMs };
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill();
    await done;
  }
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return {
    min: sorted[0],
    median: sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
}

const report = {
  date: new Date().toISOString(), baselines: prepared.variants, build, gapMs, count,
  method: 'full GUI with identical Node payload, isolated settings, automatic browser opening suppressed',
  exitMode: forceExit ? 'terminate launcher and wait for Node stdin EOF' : 'normal save and shutdown',
  firstProfile: {},
  samples: Object.fromEntries(variants.map(variant => [variant, []])),
};
try {
  for (const variant of variants) {
    report.firstProfile[variant] = await measure(variant);
    console.log('First profile', variant, report.firstProfile[variant]);
  }
  for (let i = 0; i < count; i++) {
    for (const variant of i % 2 ? [...variants].reverse() : variants) {
      const sample = await measure(variant);
      report.samples[variant].push(sample);
      console.log(i + 1, variant, sample);
    }
  }
  report.summary = Object.fromEntries(variants.map(variant => {
    const metrics = ['healthMs', 'frameMs', 'readyMs'];
    if (variant === 'wails') metrics.push('webviewMs');
    return [variant, Object.fromEntries(metrics.map(metric =>
      [metric, summarize(report.samples[variant].map(sample => sample[metric]))]))];
  }));
  report.sizes = {
    win32ExeBytes: (await stat(join(dir, 'win32-original.exe'))).size,
    windigoExeBytes: (await stat(join(dir, 'windigo-original.exe'))).size,
    wailsExeBytes: (await stat('release/OCLR-Windows-x64/OCLR.exe')).size,
    wailsZipBytes: (await stat('release/OCLR-Windows-x64.zip')).size,
  };
  console.log(JSON.stringify(report.summary, null, 2));
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  const contents = JSON.stringify(report, null, 2) + '\n';
  await writeFile(join(runDir, 'results.json'), contents);
  await writeFile(join(dir, 'results.json'), contents);
  console.log('Results:', runDir);
}
