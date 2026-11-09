import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Rebuild the production UI and keep a simulator alive while editing. UI files
// are debounced into one build; backend files restart the simulator because
// Node has already imported them. Existing services are never killed.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SIM_ENTRY = resolve(ROOT, 'server/custom-match.js');
const DEFAULT_DELAY_MS = 5000;
const WATCH_ROOTS = [
  { directory: 'ui', kind: 'ui' },
  { directory: 'src', kind: 'backend' },
  { directory: 'server', kind: 'backend' },
  { directory: 'tools/tosu-simulator', kind: 'backend' },
];
const BUILD_CONFIG_FILES = new Set(['vite.config.ts', 'tsconfig.json']);
const IGNORED = /(^|\/)(?:node_modules|dist|coverage|release)(?:\/|$)|(^|\/)\.|(?:\.swp|\.tmp|\.log|\.tsbuildinfo)$|~$/i;

function usage() {
  console.log(`用法: npm run watch -- [模拟器参数]

监视 ui/ 与构建配置，安静 ${DEFAULT_DELAY_MS}ms 后自动执行 npm run build。
首次构建后启动自定义比赛服务（--simulate 可启用隔离模拟信号）；已有同项目服务会直接复用，不会结束别人的进程。
server/、src/、tools/tosu-simulator/ 变更会重启由本命令启动的模拟服务。

  --watch-delay <ms>  修改安静期（默认 ${DEFAULT_DELAY_MS}，也可用 OCLR_WATCH_DELAY_MS）
  --help              显示本说明

其余参数原样传给 server/custom-match.js，例如：
  npm run watch -- --simulate --app-port 3012 --ws-port 24055 --session-file /path/to/test-session.json
  npm run watch -- --simulate`);
}

function parseArguments(argv) {
  const simArgs = [];
  let delayMs = Number(process.env.OCLR_WATCH_DELAY_MS || DEFAULT_DELAY_MS);
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      usage();
      process.exit(0);
    }
    if (argument === '--watch-delay') {
      delayMs = Number(argv[++index]);
      continue;
    }
    if (argument.startsWith('--watch-delay=')) {
      delayMs = Number(argument.slice('--watch-delay='.length));
      continue;
    }
    simArgs.push(argument);
  }
  if (!Number.isFinite(delayMs) || delayMs < 100) {
    console.error('--watch-delay 必须是至少 100 的毫秒数。');
    process.exit(1);
  }
  return { delayMs, simArgs };
}

const { delayMs, simArgs } = parseArguments(process.argv.slice(2));
const appPort = (() => {
  const index = simArgs.indexOf('--app-port');
  const value = Number(index >= 0 ? simArgs[index + 1] : 3011);
  return Number.isInteger(value) && value > 0 ? value : 3011;
})();
const controlUrl = `http://127.0.0.1:${appPort}/control`;
const overlayUrl = `http://127.0.0.1:${appPort}/overlay`;
const npmCommand = process.env.npm_execpath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const npmPrefix = process.env.npm_execpath ? [process.env.npm_execpath] : [];

let timer = null;
let cycleActive = false;
let stopping = false;
let lastChangeAt = 0;
let changedUi = new Set();
let changedBackend = new Set();
let simProcess = null;
let buildProcess = null;
const intentionalSimStops = new WeakSet();
let externalNoticeShown = false;

function log(message) {
  console.log(`[watch] ${message}`);
}

function stamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function pipeLines(stream, prefix, output) {
  let buffered = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buffered += chunk;
    let newline = buffered.indexOf('\n');
    while (newline !== -1) {
      const line = buffered.slice(0, newline).replace(/\r$/, '');
      buffered = buffered.slice(newline + 1);
      if (line.trim()) output(`${prefix} ${line}`);
      newline = buffered.indexOf('\n');
    }
  });
  stream.on('end', () => {
    if (buffered.trim()) output(`${prefix} ${buffered.replace(/\r$/, '')}`);
  });
}

function spawnWatched(command, arguments_, label) {
  const child = spawn(command, arguments_, {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  pipeLines(child.stdout, `[${label}]`, line => console.log(line));
  pipeLines(child.stderr, `[${label}]`, line => console.error(line));
  return child;
}

function terminateTree(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      terminateTree(child, 'SIGKILL');
      finish();
    }, timeoutMs);
    child.once('exit', finish);
    child.once('error', finish);
  });
}

function runBuild() {
  log('执行 npm run build ...');
  const startedAt = Date.now();
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (buildProcess === child) buildProcess = null;
      resolve({ ...result, durationMs: Date.now() - startedAt });
    };
    const child = spawnWatched(npmCommand, [...npmPrefix, 'run', 'build'], 'build');
    buildProcess = child;
    child.once('exit', (code, signal) => finish({ code, signal }));
    child.once('error', error => {
      console.error(`[build] 启动失败：${error.message}`);
      finish({ code: 1, signal: null, error });
    });
  });
}

function startSimulator() {
  if (stopping) return false;
  log('启动模拟服务 ...');
  const child = spawnWatched(process.execPath, [SIM_ENTRY, ...simArgs], 'sim');
  simProcess = child;
  child.once('error', error => {
    if (simProcess === child) simProcess = null;
    console.error(`[sim] 启动失败：${error.message}`);
  });
  child.once('exit', (code, signal) => {
    if (simProcess === child) simProcess = null;
    if (!stopping && !intentionalSimStops.has(child)) {
      log(`模拟服务已退出（code=${code}, signal=${signal}），下次构建或服务端修改时重新启动。`);
    }
  });
  return true;
}

async function stopSimulator() {
  const child = simProcess;
  if (!child) return;
  intentionalSimStops.add(child);
  simProcess = null;
  log('停止模拟服务 ...');
  terminateTree(child);
  await waitForExit(child);
}

async function serviceIsRunning() {
  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return false;
    const body = await response.json();
    if (body?.project !== 'oclr-stream-overlay') return false;
    if (body.mode === 'custom-match') return true;
    const config = await fetch(`http://127.0.0.1:${appPort}/api/config`, { signal: AbortSignal.timeout(1000) });
    return config.ok && (await config.json()).authMode === 'custom';
  } catch {
    return false;
  }
}

function reportControlUrl() {
  log(`控制台: ${controlUrl} · 输出: ${overlayUrl}（构建完成后刷新页面）`);
}

async function ensureService() {
  if (simProcess || stopping) return;
  if (await serviceIsRunning()) {
    if (!externalNoticeShown) {
      externalNoticeShown = true;
      log(`检测到已在运行的本项目服务（${controlUrl}），沿用该服务；不会结束它。`);
      log('若修改 server/、src/ 或 tools/tosu-simulator/，请手动重启该服务。');
    }
    return;
  }
  if (stopping) return;
  externalNoticeShown = false;
  if (startSimulator()) reportControlUrl();
}

async function restartService() {
  if (stopping) return;
  if (simProcess) {
    await stopSimulator();
    if (stopping) return;
    if (startSimulator()) reportControlUrl();
    return;
  }
  if (await serviceIsRunning()) {
    externalNoticeShown = true;
    log(`服务端修改需要重启，但 ${controlUrl} 不是本命令启动的；请手动重启该服务。`);
    return;
  }
  if (stopping) return;
  if (startSimulator()) reportControlUrl();
}

function scheduleCycle() {
  if (stopping) return;
  if (timer) clearTimeout(timer);
  const remaining = Math.max(0, delayMs - (Date.now() - lastChangeAt));
  timer = setTimeout(() => {
    timer = null;
    void runCycle();
  }, remaining);
}

async function runCycle({ initial = false } = {}) {
  if (cycleActive || stopping) return;
  cycleActive = true;
  const uiFiles = changedUi;
  const backendFiles = changedBackend;
  changedUi = new Set();
  changedBackend = new Set();
  const buildNeeded = initial || uiFiles.size > 0;

  try {
    if (buildNeeded) {
      if (initial) log(`首次构建；完成后启动或复用模拟服务。安静期 ${delayMs}ms。`);
      else log(`检测到 ${uiFiles.size} 个 UI/构建文件修改，开始构建。`);
      const result = await runBuild();
      if (stopping) return;
      if (result.code === 0) {
        const seconds = (result.durationMs / 1000).toFixed(1);
        log(`构建成功（${seconds}s）。`);
      } else {
        log(`构建失败（exit=${result.code ?? 'signal'}）。保留现有 dist 与模拟服务。`);
      }
    }

    if (stopping) return;
    if (backendFiles.size > 0) {
      const names = [...backendFiles].slice(0, 3).join('、');
      log(`检测到服务端文件修改：${names}${backendFiles.size > 3 ? ` 等 ${backendFiles.size} 个` : ''}`);
      await restartService();
    } else {
      await ensureService();
    }
  } catch (error) {
    console.error(`[watch] 处理失败：${error?.stack || error}`);
  } finally {
    cycleActive = false;
    if (!stopping && (changedUi.size > 0 || changedBackend.size > 0)) scheduleCycle();
  }
}

function onChange(kind, relativePath) {
  if (stopping) return;
  const normalized = relativePath.split(sep).join('/');
  if (!normalized || IGNORED.test(normalized) || normalized.endsWith('/')) return;
  lastChangeAt = Date.now();
  if (kind === 'ui') changedUi.add(normalized);
  else changedBackend.add(normalized);
  scheduleCycle();
}

const watchers = [];
for (const { directory, kind } of WATCH_ROOTS) {
  const absolute = resolve(ROOT, directory);
  try {
    const watcher = watch(absolute, { recursive: true, encoding: 'utf8' }, (_event, filename) => {
      if (!filename) return;
      onChange(kind, relative(ROOT, resolve(absolute, filename)));
    });
    watcher.on('error', error => console.error(`[watch] 监视 ${directory}/ 失败：${error.message}`));
    watchers.push(watcher);
  } catch (error) {
    console.error(`[watch] 无法监视 ${directory}/：${error.message}`);
  }
}
// Watch the project root shallowly so editor atomic renames of config files are
// still seen, without recursively walking node_modules.
try {
  const configWatcher = watch(ROOT, { recursive: false, encoding: 'utf8' }, (_event, filename) => {
    if (filename && BUILD_CONFIG_FILES.has(filename)) onChange('ui', filename);
  });
  configWatcher.on('error', error => console.error(`[watch] 监视构建配置失败：${error.message}`));
  watchers.push(configWatcher);
} catch (error) {
  console.error(`[watch] 无法监视构建配置：${error.message}`);
}

async function shutdown(signal) {
  if (stopping) {
    log('强制退出。');
    terminateTree(buildProcess, 'SIGKILL');
    terminateTree(simProcess, 'SIGKILL');
    process.exit(130);
  }
  stopping = true;
  if (timer) clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  log(`收到 ${signal}，正在退出 ...`);
  if (buildProcess) {
    terminateTree(buildProcess);
    await waitForExit(buildProcess);
  }
  await stopSimulator();
  log('已退出。');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGHUP', () => void shutdown('SIGHUP'));

log(`OCLR UI 监视器启动（${stamp()}）`);
log(`监视 ui/、vite.config.ts、tsconfig.json：修改后安静 ${delayMs}ms 自动构建。`);
log('监视 server/、src/、tools/tosu-simulator/：修改后重启由本命令启动的模拟服务。');
void runCycle({ initial: true });
