import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  envDir: false,
  plugins: [vue()],
  server: { host: '127.0.0.1', port: 3003, strictPort: true, fs: { strict: true, allow: [fileURLToPath(new URL('./ui', import.meta.url))] } },
  preview: { host: '127.0.0.1', port: 3003, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true, assetsInlineLimit: 0, sourcemap: false, target: 'es2022' }
});
