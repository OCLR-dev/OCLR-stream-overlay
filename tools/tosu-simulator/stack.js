import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOverlayServer } from '../../server/app.js';
import { SessionStore } from '../../server/session/store.js';
import { attachBroadcast } from '../../server/session/data.js';
import { createBroadcastData, OclrClient } from '../../src/index.js';
import { seedCommands, simulationSession } from './fixture.js';
import { TosuSimulator } from './server.js';
import { acquireRuntime } from '../../server/runtime.js';
import { loadConfig, ROOT } from '../../server/config.js';

export async function startSimulation({ appPort = 3005, wsPort = 24051, sessionFile = null, initialRoom = null,
  offlineOclr = false, oclrConfig = null, oclrFetch = fetch } = {}) {
  if (appPort === 0 && wsPort === 0 && !offlineOclr && !sessionFile) {
    throw new Error('隔离测试需明确指定比赛副本或离线样本，不能隐式打开当前比赛');
  }
  // Port zero is reserved for isolated automated tests / diagnostics.
  const lease = appPort === 0 && wsPort === 0 ? null : await acquireRuntime({ appPort, mode: 'simulation' });
  let server; let stopData; let simulator;
  try {
    // Normal use shares the real local match store. Fully offline fixtures are
    // explicit and reserved for deterministic tests/diagnostics.
    const explicitSessionFile = !!sessionFile;
    if (!sessionFile && !offlineOclr) sessionFile = join(ROOT, '.local/session.json');
    const directory = sessionFile ? dirname(sessionFile) : await mkdtemp(join(tmpdir(), 'oclr-tosu-ws-simulation-'));
    if (explicitSessionFile) await access(sessionFile);
    const store = sessionFile ? await SessionStore.open(sessionFile) : new SessionStore({ file: join(directory, 'session.json'), state: simulationSession() });
    simulator = new TosuSimulator({ port: wsPort, offlineFixtures: offlineOclr,
      getPool: offlineOclr ? null : () => store.state.pool,
      onReset: offlineOclr ? async () => {
        const submit = async (type, payload = {}) => {
          const id = randomUUID();
          for (let attempt = 0; ; attempt++) {
            try { return await store.command({ id, version: store.state.version, type, payload }); }
            catch (error) {
              if (attempt >= 3 || error.message !== '会话已被其他操作更新，请核对最新状态后重试') throw error;
            }
          }
        };
        await submit('next-match');
        for (const [type, payload] of seedCommands()) await submit(type, payload);
      } : null });
    if (initialRoom) simulator.room = structuredClone(initialRoom);
    await simulator.start();
    const config = { ...(offlineOclr ? { mode: 'anonymous' } : oclrConfig || loadConfig()), port: appPort, wsUrl: simulator.wsUrl };
    server = createOverlayServer(config, offlineOclr ? async () => { throw new Error('SIMULATION_OFFLINE'); } : oclrFetch, undefined, store);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(appPort, '127.0.0.1', resolve); });
    config.port = server.address().port;
    const appUrl = `http://127.0.0.1:${config.port}`;
    simulator.appUrl = appUrl;
    store.live.sources = { tosu: 'simulated', oclr: offlineOclr ? 'offline-fixture' : 'remote-read-only' };
    const data = await createBroadcastData({ config: { tosuWsUrl: simulator.wsUrl }, oclr: new OclrClient({ baseUrl: `${appUrl}/api/oclr` }) });
    stopData = attachBroadcast(store, data);
    let stopped = false;
    return { appUrl, simulatorUrl: `http://127.0.0.1:${simulator.port}`, simulator, store, directory,
      async stop() { if (stopped) return; stopped = true; stopData(); await simulator.stop(); await store.tail; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await lease?.release(); } };
  } catch (error) {
    stopData?.();
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (simulator?.server.listening) await simulator.stop();
    await lease?.release(); throw error;
  }
}
