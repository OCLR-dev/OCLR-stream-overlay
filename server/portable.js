import { readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { loadConfig } from './config.js';
import { acquireRuntime } from './runtime.js';
import { createOverlayServer } from './app.js';
import { SessionStore } from './session/store.js';
import { attachBroadcast } from './session/data.js';
import { createBroadcastData, OclrClient } from '../src/index.js';
import { preparePortableData, backupBeforeVersion } from './portable-data.js';

const root = fileURLToPath(new URL('../', import.meta.url));
let lease, server, session, stopData;
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  stopData?.();
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await session?.tail;
  await lease?.release();
}
try {
  const manifest = JSON.parse(await readFile(join(root, 'portable-build.json'), 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(manifest.build)) throw new Error('PACKAGE_INVALID');
  const dataDir = resolve(process.env.OCLR_DATA_DIR || join(process.env.LOCALAPPDATA || '', 'OCLR', 'StreamOverlay'));
  if (!process.env.OCLR_DATA_DIR && !process.env.LOCALAPPDATA) throw new Error('DATA_LOCATION_REQUIRED');
  // Packaged users always get the same address and real tosu, regardless of cwd/env.
  const config = loadConfig({ PORT: '3001', TOSU_WS_URL: 'ws://127.0.0.1:24050/websocket/v2', OCLR_AUTH_MODE: 'anonymous' });
  config.runtime = { build: manifest.build, ready: false, portable: true, pid: process.pid };
  const guardPort = 40000 + createHash('sha256').update(dataDir.toLowerCase()).digest().readUInt16BE() % 10000;
  lease = await acquireRuntime({ appPort: config.port, mode: 'portable', guardPort });
  await access(join(root, 'dist/index.html'));
  // Bind the fixed output address before touching match data. Never move ports.
  server = createOverlayServer(config, fetch, undefined, null);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', resolve); });
  const file = await preparePortableData(dataDir, join(root, '../.local'));
  await backupBeforeVersion(dataDir, manifest.build);
  session = await SessionStore.open(file);
  if (!await access(file).then(() => true, () => false)) await session.save(session.state);
  config.session = session;
  const data = await createBroadcastData({ config: { tosuWsUrl: config.wsUrl },
    oclr: new OclrClient({ baseUrl: 'http://127.0.0.1:3001/api/oclr' }) });
  stopData = attachBroadcast(session, data);
  config.runtime.ready = true;
  const input = createInterface({ input: process.stdin });
  input.on('line', line => { if (line === 'shutdown') { input.close(); void shutdown(); } });
  input.on('close', () => void shutdown());
  process.once('SIGTERM', () => { input.close(); void shutdown(); });
  process.once('SIGINT', () => { input.close(); void shutdown(); });
} catch (error) {
  const message = error.code === 'EADDRINUSE' ? '固定的 OBS 地址被其他程序占用。请关闭占用 3001 的程序后重试；不会自动换地址。'
    : error.code === 'OCLR_ALREADY_RUNNING' ? error.message
    : error.message === 'SESSION_RESTORE_FAILED' ? '比赛记录无法读取，原文件已保留。请让维护者检查数据文件，不要初始化比赛。'
    : error.message === 'DATA_MIGRATION_CONFLICT' ? '发现旧比赛和已有数据文件夹，请让维护者核对后迁移；原数据未覆盖。'
    : '启动失败：请确认完整解压，并检查用户数据文件夹可写、磁盘空间充足。原比赛不会被清空。';
  console.error(message);
  await shutdown();
  process.exitCode = 1;
}
