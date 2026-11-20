import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { createOverlayServer } from '../server/app.js';

// Node fetch rewrites Sec-Fetch-Mode to cors. Use raw HTTP to reproduce the
// browser's actual document-navigation headers without changing the policy.
function requestWithHeaders(url, headers) {
  return new Promise((resolve, reject) => {
    get(url, { headers }, response => {
      response.resume();
      resolve({ status: response.statusCode, headers: response.headers });
    }).on('error', reject);
  });
}
const statusWithHeaders = async (...args) => (await requestWithHeaders(...args)).status;

test('built UI serves only generated files and never exposes source, credentials or arbitrary paths', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'oclr-ui-'));
  const dist = join(fixture, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(fixture, '.env.local'), 'PRIVATE_TEST_SENTINEL');
  await writeFile(join(dist, 'index.html'), '<!doctype html><div id="app"></div>');
  await writeFile(join(dist, 'assets/index-Ab12.js'), 'export const demo = true;');
  await writeFile(join(dist, 'assets/violet-CD34.svg'), '<svg/>');
  await writeFile(join(dist, 'assets/season-Ab12.webp'), Buffer.from('RIFF-test-logo'));
  const config = { port: 0, mode: 'anonymous' };
  let upstreamRequests = 0;
  const server = createOverlayServer(config, async () => { upstreamRequests += 1; throw new Error('UNEXPECTED_API_CALL'); }, dist);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.port = server.address().port;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(fixture, { recursive: true }); });
  const base = `http://127.0.0.1:${config.port}`;
  for (const path of ['/', '/index.html', '/overlay', '/control', '/showcase', '/showcase?clean=1']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /id="app"/);
  }
  const script = await fetch(`${base}/assets/index-Ab12.js`);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.match(script.headers.get('cache-control'), /immutable/);
  assert.match(await script.text(), /demo = true/);
  const logo = await fetch(`${base}/assets/season-Ab12.webp`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/webp');
  for (const path of ['/.env.local', '/assets/%2e%2e%2f.env.local', '/assets/../.env.local', '/assets/missing.js', '/ui/model.ts', '/server/config.js', '/package.json', '/not-a-scene']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /PRIVATE_TEST_SENTINEL/);
  }
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  assert.equal((await fetch(base, { headers: { Origin: 'https://example.org' } })).status, 403);
  const navigation = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
  assert.equal(await statusWithHeaders(base, navigation), 200);
  assert.equal(await statusWithHeaders(`${base}/showcase`, navigation), 200);
  assert.equal(await statusWithHeaders(`${base}/api/config`, navigation), 403);
  assert.equal(await statusWithHeaders(`${base}/assets/index-Ab12.js`, navigation), 403);
  const desktop = { ...navigation, 'Sec-Fetch-Dest': 'iframe', Referer: 'http://wails.localhost/' };
  for (const page of ['control', 'showcase']) {
    const frame = await requestWithHeaders(`${base}/${page}?desktop=1`, desktop);
    assert.equal(frame.status, 200);
    assert.equal(frame.headers['content-security-policy'], 'frame-ancestors http://wails.localhost');
    assert.equal(await statusWithHeaders(`${base}/${page}?desktop=1`, { ...desktop, Referer: 'https://example.org/' }), 403);
    assert.equal(await statusWithHeaders(`${base}/${page}`, desktop), 403);
  }
  assert.equal(await statusWithHeaders(`${base}/control?desktop-login=s11`, navigation), 200);
  assert.equal(await statusWithHeaders(`${base}/control?desktop-login=s11`, desktop), 403);
  assert.equal(await statusWithHeaders(`${base}/api/session?desktop=1`, desktop), 403);
  assert.equal(await statusWithHeaders(`${base}/overlay?desktop=1`, desktop), 403);
  assert.equal(upstreamRequests, 0);
});

test('an absent UI build reports a clear error and health remains available', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'oclr-no-ui-'));
  const config = { port: 0 };
  const server = createOverlayServer(config, undefined, fixture);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.port = server.address().port;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(fixture, { recursive: true }); });
  const base = `http://127.0.0.1:${config.port}`;
  assert.equal((await (await fetch(base)).json()).error.code, 'UI_BUILD_REQUIRED');
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});
