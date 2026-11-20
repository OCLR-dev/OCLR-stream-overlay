import { createServer } from 'node:net';
import { join } from 'node:path';
import { portableGuardPort } from '../../server/runtime.js';

export async function availableLoopbackPort(port) {
  const probe = createServer();
  try {
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  } catch (error) {
    if (['EADDRINUSE', 'EACCES'].includes(error.code)) return null;
    throw error;
  }
  const available = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return available;
}

export async function fixtureDataDir(directory, name, dataSubdirectory = '') {
  // Keep the hashed lease outside the default Windows dynamic port range.
  for (let i = 0; i < 64; i++) {
    const path = join(directory, i === 0 ? name : `${name} ${i}`);
    const port = portableGuardPort(join(path, dataSubdirectory));
    if (process.platform === 'win32' && port >= 49152) continue;
    if (await availableLoopbackPort(port)) return path;
  }
  throw new Error('No available portable test lease port');
}
