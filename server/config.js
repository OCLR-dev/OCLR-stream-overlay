import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

export function loadConfig(env = process.env) {
  const localFile = resolve(ROOT, '.env.local');
  const local = existsSync(localFile) ? parseEnv(readFileSync(localFile, 'utf8')) : {};
  const values = { ...local, ...env };
  const mode = values.OCLR_AUTH_MODE || 'anonymous';
  if (!['anonymous', 'bearer'].includes(mode)) throw new Error('INVALID_AUTH_MODE');
  let key = values.OCLR_API_KEY || '';
  if (mode === 'bearer' && !key && values.OCLR_CREDENTIALS_FILE) {
    const credentials = parseEnv(readFileSync(resolve(ROOT, values.OCLR_CREDENTIALS_FILE), 'utf8'));
    key = credentials.OCLR_API_KEY || '';
  }
  if (mode === 'bearer' && !key) throw new Error('OCLR_KEY_REQUIRED');
  const backend = new URL(values.OCLR_API_BASE_URL || 'https://oclr.org');
  if (backend.protocol !== 'https:' || backend.username || backend.password ||
      backend.pathname !== '/' || backend.search || backend.hash) throw new Error('INVALID_BACKEND_ORIGIN');
  const origin = new URL(values.OCLR_API_ORIGIN || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.href !== `${origin.origin}/`) {
    throw new Error('INVALID_API_ORIGIN');
  }
  const wsUrl = new URL(values.TOSU_WS_URL || 'ws://127.0.0.1:24050/websocket/v2');
  if (!['ws:', 'wss:'].includes(wsUrl.protocol) || wsUrl.username || wsUrl.password) {
    throw new Error('INVALID_TOSU_URL');
  }
  const port = Number(values.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  return { backend: backend.origin, origin: origin.origin, key: mode === 'bearer' ? key : '', mode, port, wsUrl: wsUrl.href };
}
