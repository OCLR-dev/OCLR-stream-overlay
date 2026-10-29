import { loadConfig } from './config.js';
import { createOverlayServer } from './app.js';
import { SessionStore } from './session/store.js';
import { attachBroadcast } from './session/data.js';
import { createBroadcastData, OclrClient } from '../src/index.js';
import { fileURLToPath } from 'node:url';
import { acquireRuntime } from './runtime.js';

let lease;
try {
  const config = loadConfig();
  lease = await acquireRuntime({ appPort: config.port, mode: 'production' });
  const session = await SessionStore.open(fileURLToPath(new URL('../.local/session.json', import.meta.url)));
  const server = createOverlayServer(config, fetch, undefined, session);
  server.on('error', () => {
    console.error('SERVER_START_FAILED: check whether the configured port is in use.');
    void lease.release();
    process.exitCode = 1;
  });
  let stopData;
  server.listen(config.port, '127.0.0.1', async () => {
    const data = await createBroadcastData({ config: { tosuWsUrl: config.wsUrl },
      oclr: new OclrClient({ baseUrl: `http://127.0.0.1:${config.port}/api/oclr` }) });
    stopData = attachBroadcast(session, data);
    console.log(`OCLR control: http://localhost:${config.port}/control | output: /overlay (${config.mode})`);
  });
  const shutdown = async () => { stopData?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await session.tail; await lease.release(); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
} catch (error) {
  await lease?.release();
  console.error(error.code === 'OCLR_ALREADY_RUNNING' ? error.message : error.message === 'SESSION_RESTORE_FAILED'
    ? 'SESSION_RESTORE_FAILED: local records were preserved; check .local/session.json before restarting.'
    : 'CONFIG_ERROR: check .env.local and the server-only credential file.');
  process.exitCode = 1;
}
