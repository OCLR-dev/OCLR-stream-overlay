import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionHttp } from './session/http.js';

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const UUID = '[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}';
const RESOURCES = [
  /^tournaments$/,
  new RegExp(`^tournaments/(${SLUG})$`),
  new RegExp(`^tournaments/(${SLUG})/(configuration|players|teams|competition|bracket|mappools)$`),
  new RegExp(`^tournaments/(${SLUG})/matches/(${UUID})$`),
];
const MODULES = ['index', 'oclr', 'tosu', 'broadcast'];
const MAX_BYTES = 2 * 1024 * 1024;
const UI_ROOT = fileURLToPath(new URL('../dist/', import.meta.url));
const UI_ASSET = /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css|svg|md|woff2?)$/;
const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2' };

// Serve only the generated index and flat, named Vite assets. Never fall back
// to the project directory, source files, .env files, or arbitrary SPA paths.
export async function serveUi(pathname, res, uiRoot = UI_ROOT) {
  if (!['/', '/index.html', '/overlay', '/control'].includes(pathname) && !UI_ASSET.test(pathname)) return false;
  const name = UI_ASSET.test(pathname) ? pathname.slice(1) : 'index.html';
  const filename = resolve(uiRoot, name);
  if (!filename.startsWith(resolve(uiRoot) + sep)) return false;
  try {
    const body = await readFile(filename);
    const extension = name.slice(name.lastIndexOf('.'));
    res.writeHead(200, {
      'Content-Type': name === 'index.html' ? 'text/html; charset=utf-8' : MIME[extension],
      'Cache-Control': name === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      fail(res, 500, 'UI_READ_FAILED');
      return true;
    }
    fail(res, 404, name === 'index.html' ? 'UI_BUILD_REQUIRED' : 'NOT_FOUND');
  }
  return true;
}

function reply(res, status, value, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(JSON.stringify(value));
}

function fail(res, status, code, headers) {
  reply(res, status, { error: { code } }, headers);
}

export function isAllowedResource(resource, searchParams) {
  if (!RESOURCES.some(pattern => pattern.test(resource))) return false;
  const collection = resource === 'tournaments' || resource.endsWith('/players');
  const allowed = collection ? ['q', 'page', 'pageSize', 'version'] :
    resource.endsWith('/mappools') ? ['poolId'] : [];
  const seen = new Set();
  for (const [key, value] of searchParams) {
    if (!allowed.includes(key) || seen.has(key) || value.length > 100) return false;
    if (key === 'poolId' && !new RegExp(`^${UUID}$`).test(value)) return false;
    if (['page', 'pageSize'].includes(key) && !/^[1-9][0-9]*$/.test(value)) return false;
    if (key === 'version' && !/^[a-f0-9]{64}$/.test(value)) return false;
    seen.add(key);
  }
  return true;
}

export async function readBoundedJson(response) {
  if (!response.body) throw new Error('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new Error('RESOURCE_TOO_LARGE');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createOverlayServer(config, fetchImpl = fetch, uiRoot = UI_ROOT, session = null) {
  return createServer(async (req, res) => {
    // Local-only reads. Other origins cannot use this service as an authenticated proxy.
    const hosts = [`localhost:${config.port}`, `127.0.0.1:${config.port}`];
    const origins = hosts.map(host => `http://${host}`);
    // Opening the public UI from a link is a cross-site document navigation.
    // Permit only that entry navigation; API and cross-site fetches stay blocked.
    const uiNavigation = req.method === 'GET' &&
      req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document' &&
      ['/', '/index.html', '/overlay', '/control'].includes(req.url.split('?')[0]);
    if (!hosts.includes(req.headers.host) ||
        (req.headers.origin && !origins.includes(req.headers.origin)) ||
        (req.headers['sec-fetch-site'] === 'cross-site' && !uiNavigation)) return fail(res, 403, 'LOCAL_ORIGIN_REQUIRED');
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return fail(res, 400, 'INVALID_REQUEST'); }
    if (await sessionHttp(req, res, url, session)) return;
    if (req.method !== 'GET') return fail(res, 405, 'READ_ONLY', { Allow: 'GET' });
    if (url.pathname === '/api/health') {
      return reply(res, 200, { project: 'oclr-stream-overlay', stage: 'operator-session', session: Boolean(session) });
    }
    if (await serveUi(url.pathname, res, uiRoot)) return;
    if (url.pathname === '/api/config') {
      return reply(res, 200, { oclrBaseUrl: '/api/oclr', tosuWsUrl: config.wsUrl, authMode: config.mode });
    }
    if (MODULES.some(name => url.pathname === `/src/${name}.js`)) {
      const body = await readFile(new URL(`../src/${url.pathname.split('/').pop()}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    if (!url.pathname.startsWith('/api/oclr/')) return fail(res, 404, 'NOT_FOUND');
    const resource = url.pathname.slice('/api/oclr/'.length);
    if (!isAllowedResource(resource, url.searchParams)) return fail(res, 400, 'RESOURCE_NOT_ALLOWED');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const headers = { Accept: 'application/json', Origin: config.origin };
      if (config.key) headers.Authorization = `Bearer ${config.key}`;
      const upstream = await fetchImpl(`${config.backend}/api/v1/${resource}${url.search}`, {
        method: 'GET', headers, redirect: 'error', cache: 'no-store', signal: controller.signal,
      });
      const body = await readBoundedJson(upstream);
      if (!upstream.ok) {
        const code = body?.error?.code;
        const safeCode = typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'UPSTREAM_ERROR';
        const retry = upstream.headers.get('retry-after');
        const retryHeaders = retry && /^\d+$/.test(retry) ? { 'Retry-After': retry } : {};
        return fail(res, upstream.status, safeCode, retryHeaders);
      }
      const version = upstream.headers.get('x-oclr-read-contract');
      if (!/^1\.(?:[1-9][0-9]*)\.[0-9]+$/.test(version || '')) return fail(res, 502, 'REMOTE_INCOMPATIBLE');
      if (!body || !Object.hasOwn(body, 'data') || body.meta?.apiVersion !== '1') {
        return fail(res, 502, 'INVALID_RESPONSE');
      }
      return reply(res, 200, body, { 'X-OCLR-Read-Contract': version });
    } catch (error) {
      return fail(res, 502, error.message === 'RESOURCE_TOO_LARGE' ? 'RESOURCE_TOO_LARGE' : 'UPSTREAM_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  });
}
