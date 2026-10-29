import { createServer, createConnection } from 'node:net';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// One backend per checkout, shared by normal and simulator launchers. The OS
// releases this loopback-only lease on exit, so there are no stale PID files.
const root = fileURLToPath(new URL('../', import.meta.url));
const guardPort = 40000 + createHash('sha256').update(root).digest().readUInt16BE() % 10000;

async function runningService(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let value = '';
    const finish = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(500, () => finish(null));
    socket.on('error', () => finish(null));
    socket.on('data', chunk => {
      value += chunk;
      if (value.length > 1024) finish(null);
    });
    socket.on('end', () => { try { finish(JSON.parse(value)); } catch { finish(null); } });
  });
}

export async function acquireRuntime({ appPort, mode, guardPort: port = guardPort }) {
  const info = { service: 'oclr-stream-overlay', pid: process.pid, appPort, mode };
  const guard = createServer(socket => {
    socket.on('error', () => {});
    socket.end(JSON.stringify(info));
  });
  try {
    await new Promise((resolve, reject) => {
      guard.once('error', reject);
      guard.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    const current = await runningService(port);
    const reason = new Error(current?.service === info.service
      ? `OCLR 服务已在运行：http://127.0.0.1:${current.appPort}/control。请使用现有服务。`
      : 'OCLR 启动检查端口被占用，请检查本机服务。');
    reason.code = 'OCLR_ALREADY_RUNNING';
    throw reason;
  }
  let released = false;
  return { guardPort: guard.address().port, async release() {
    if (released) return;
    released = true;
    await new Promise(resolve => guard.close(resolve));
  } };
}
