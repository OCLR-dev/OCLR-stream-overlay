import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverlayServer, isAllowedResource, readBoundedJson } from '../server/app.js';

test('proxy allowlist rejects private routes, arbitrary URLs, mutations and unknown queries', () => {
  assert.equal(isAllowedResource('tournaments/s11/mappools', new URLSearchParams()), true);
  for (const resource of ['staff/tournaments/s11/streaming', 'me', 'https://example.org', '../.env.local']) {
    assert.equal(isAllowedResource(resource, new URLSearchParams()), false);
  }
  assert.equal(isAllowedResource('tournaments', new URLSearchParams('page=1&page=2')), false);
  assert.equal(isAllowedResource('tournaments/s11/teams', new URLSearchParams('token=secret')), false);
});

test('oversized upstream JSON is rejected', async () => {
  await assert.rejects(readBoundedJson(new Response(' '.repeat(2 * 1024 * 1024 + 1))), /RESOURCE_TOO_LARGE/);
});

test('local service keeps the Key server-side and refuses cross-origin requests and credential files', async t => {
  const config = { port: 0, backend: 'https://oclr.org', origin: 'http://localhost:3000',
    key: 'synthetic-test-key', mode: 'bearer', wsUrl: 'ws://127.0.0.1:24050/websocket/v2' };
  let upstreamOptions;
  const server = createOverlayServer(config, async (url, options) => {
    upstreamOptions = options;
    assert.equal(url, 'https://oclr.org/api/v1/tournaments/s11/teams');
    return new Response(JSON.stringify({ data: [], meta: { apiVersion: '1' } }), {
      headers: { 'X-OCLR-Read-Contract': '1.1.0' },
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  const publicConfig = await (await fetch(`${base}/api/config`)).text();
  assert.doesNotMatch(publicConfig, /synthetic-test-key|OCLR_API_KEY/);
  assert.equal((await fetch(`${base}/.env.local`)).status, 404);
  assert.equal((await fetch(`${base}/server/config.js`)).status, 404);
  assert.equal((await fetch(`${base}/src/index.js`)).status, 200);
  assert.equal((await fetch(`${base}/api/oclr/tournaments/s11/teams`, { headers: { Origin: 'https://example.org' } })).status, 403);
  assert.equal((await fetch(`${base}/api/oclr/tournaments/s11/teams`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/api/oclr/tournaments/s11/teams`)).status, 200);
  assert.equal(upstreamOptions.headers.Authorization, 'Bearer synthetic-test-key');
  assert.equal(upstreamOptions.headers.Origin, 'http://localhost:3000');
});

test('contract mismatch and backend authorization rejection remain failures', async t => {
  const config = { port: 0, backend: 'https://oclr.org', origin: 'http://localhost:3000' };
  let response = new Response(JSON.stringify({ data: [], meta: { apiVersion: '1' } }), {
    headers: { 'X-OCLR-Read-Contract': '1.0.0' },
  });
  const server = createOverlayServer(config, async () => response);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  config.port = server.address().port;
  const url = `http://127.0.0.1:${config.port}/api/oclr/tournaments`;
  assert.equal((await (await fetch(url)).json()).error.code, 'REMOTE_INCOMPATIBLE');
  response = new Response(JSON.stringify({ error: { code: 'INVALID_TOKEN', message: 'private backend details' } }), { status: 401 });
  const denied = await fetch(url);
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: { code: 'INVALID_TOKEN' } });
});
