import { loadConfig } from './config.js';
import { createOverlayServer } from './app.js';

try {
  const config = loadConfig();
  const server = createOverlayServer(config);
  server.on('error', () => {
    console.error('SERVER_START_FAILED: check whether the configured port is in use.');
    process.exitCode = 1;
  });
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`OCLR data service: http://localhost:${config.port} (${config.mode})`);
  });
} catch {
  console.error('CONFIG_ERROR: check .env.local and the server-only credential file.');
  process.exitCode = 1;
}
