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

export async function startSimulation({ appPort = 3005, wsPort = 24051, sessionFile = null, initialRoom = null } = {}) {
  // Port zero is reserved for isolated automated tests / diagnostics.
  const lease = appPort === 0 && wsPort === 0 ? null : await acquireRuntime({ appPort, mode: 'simulation' });
  let server; let stopData; let simulator;
  try {
    const directory = sessionFile ? dirname(sessionFile) : await mkdtemp(join(tmpdir(), 'oclr-tosu-ws-simulation-'));
    if (sessionFile) await access(sessionFile);
    const store = sessionFile ? await SessionStore.open(sessionFile) : new SessionStore({ file: join(directory, 'session.json'), state: simulationSession() });
    simulator = new TosuSimulator({ port: wsPort, onReset: async () => {
      const submit = (type, payload = {}) => store.command({ id: randomUUID(), version: store.state.version, type, payload });
      await submit('next-match');
      for (const [type, payload] of seedCommands()) await submit(type, payload);
    } });
    if (initialRoom) simulator.room = structuredClone(initialRoom);
    await simulator.start();
    const config = { port: appPort, mode: 'anonymous', wsUrl: simulator.wsUrl };
    // No loadConfig(), .env, credentials or outgoing OCLR requests in this stack.
    server = createOverlayServer(config, async () => { throw new Error('SIMULATION_OFFLINE'); }, undefined, store);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(appPort, '127.0.0.1', resolve); });
    config.port = server.address().port;
    const appUrl = `http://127.0.0.1:${config.port}`;
    simulator.appUrl = appUrl;
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
