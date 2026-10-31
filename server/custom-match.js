import { fileURLToPath } from 'node:url';
import { SessionStore } from './session/store.js';
import { newCustomSession } from './session/model.js';
import { createOverlayServer } from './app.js';
import { TosuClient } from '../src/index.js';
import { acquireRuntime } from './runtime.js';

// Deliberately does not load config.js, env files, credentials or OCLR clients.
export async function startCustomMatch({ port = 3011, sessionFile = fileURLToPath(new URL('../.local/custom-match/session.json', import.meta.url)),
  simulatorPort = null, guard = true, guardPort, runtime, initialState = newCustomSession, onStage = () => {} } = {}) {
  onStage('检查本机服务');
  const lease = guard ? await acquireRuntime({ appPort: port, mode: 'custom-match', guardPort }) : null;
  let server; let simulator; let client; let unsubscribe;
  try {
    onStage('读取比赛记录');
    const store = await SessionStore.open(sessionFile, { initialState });
    if (!store.state.match.custom) throw new Error('拒绝打开非自定义比赛会话');
    onStage('保存比赛记录');
    await store.save(store.state);
    if (simulatorPort !== null) {
      const { TosuSimulator } = await import('../tools/tosu-simulator/server.js');
      simulator = new TosuSimulator({ port: simulatorPort, getPool: () => store.state.pool });
      await simulator.start();
      simulator.room.leftName = 'TEST ROOM RED'; simulator.room.rightName = 'TEST ROOM BLUE';
    }
    store.live.sources = { tosu: simulator ? 'simulated' : 'live', oclr: 'disabled-custom' };
    store.live.oclr = { status: 'disabled', updatedAt: null, error: null };
    let currentUrl = null;
    unsubscribe = store.subscribe(({ session }) => {
      const url = session.auto.wsUrl || '';
      if (url === currentUrl) return;
      currentUrl = url;
      const token = store.sourceToken = (store.sourceToken || 0) + 1;
      store.live.sources.tosu = simulator && url === simulator.wsUrl ? 'simulated' : 'live';
      client?.stop(); client = null;
      void store.sourceStatus('idle', token);
      if (!url) return;
      client = new TosuClient({ url,
        onStatus: status => { void store.sourceStatus(status, token); },
        onFrame: frame => { void store.frame(frame, Date.now(), token).catch(() => { store.live.note = '会话自动更新未保存，请检查本机存储'; store.emit(); }); },
      });
      client.start();
    });
    onStage(`监听本机端口 ${port}`);
    const config = { port, mode: 'custom', customMatch: true, wsUrl: store.state.auto.wsUrl, runtime };
    server = createOverlayServer(config, fetch, undefined, store);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    config.port = server.address().port;
    const appUrl = `http://127.0.0.1:${config.port}`;
    if (simulator) simulator.appUrl = appUrl;
    let stopped = false;
    return { store, appUrl, simulator, async stop() {
      if (stopped) return;
      stopped = true; unsubscribe(); client?.stop();
      await simulator?.stop(); await store.tail;
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await lease?.release();
    } };
  } catch (error) {
    unsubscribe?.(); client?.stop(); await simulator?.stop();
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await lease?.release(); throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--simulate'].includes(arg))) throw new Error('支持参数：--simulate（独立测试信号）');
    const app = await startCustomMatch({ simulatorPort: args.includes('--simulate') ? 24054 : null });
    console.log(`自定义赛事控制台：${app.appUrl}/control\n只读输出：${app.appUrl}/overlay`);
    if (app.simulator) console.log(`隔离 tosu 模拟器：http://127.0.0.1:${app.simulator.port}/ · ${app.simulator.wsUrl}`);
    process.once('SIGINT', () => void app.stop()); process.once('SIGTERM', () => void app.stop());
  } catch (error) {
    console.error(error.message === 'SESSION_RESTORE_FAILED' ? '会话文件无效，已保留文件，拒绝替换' : error.message);
    process.exitCode = 1;
  }
}
