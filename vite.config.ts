import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// `npm run dev` is the only process that hot-reloads Vue. It proxies the
// session/API routes to a running local server (the simulator by default), so
// the console can be edited against real session data without rebuilding dist.
const backend = process.env.OCLR_DEV_API || 'http://127.0.0.1:3005';
const backendOrigin = new URL(backend).origin;

export default defineConfig({
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  envDir: false,
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 3003,
    strictPort: true,
    fs: { strict: true, allow: [fileURLToPath(new URL('./ui', import.meta.url))] },
    // The local server requires same-origin writes, so requests proxied from
    // 3003 must present the backend's own origin rather than the Vite origin.
    proxy: { '/api': { target: backend, changeOrigin: true, headers: { Origin: backendOrigin } } },
  },
  preview: { host: '127.0.0.1', port: 3003, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true, assetsInlineLimit: 0, sourcemap: false, target: 'es2022' }
});
