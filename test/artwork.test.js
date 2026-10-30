import test from 'node:test';
import assert from 'node:assert/strict';
import { createSetIdResolver } from '../server/artwork.js';
import { createOverlayServer } from '../server/app.js';
import { SessionStore } from '../server/session/store.js';

const osuFile = (id = 101, setId = 42) => `osu file format v14\r\n\r\n[Metadata]\r\nTitle:Artwork test\r\nBeatmapID:${id}\r\nBeatmapSetID:${setId}\r\n\r\n[Difficulty]\r\nApproachRate:9\r\n`;

test('official artwork resolves verified set IDs, deduplicates requests and caches success and failure with bounded lifetimes', async () => {
  let time = Date.now(); const calls = [];
  const resolve = createSetIdResolver(async url => {
    calls.push(url);
    return new Response(url.endsWith('/101') ? osuFile() : '<html>not a beatmap</html>');
  }, { gapMs: 0, now: () => time });
  assert.deepEqual(await Promise.all([resolve(101), resolve(101)]), [42, 42]);
  assert.equal(calls.length, 1);
  assert.equal(await resolve(101), 42); assert.equal(calls.length, 1);
  assert.equal(await resolve(102), null); assert.equal(await resolve(102), null); assert.equal(calls.length, 2);
  time += 60001;
  assert.equal(await resolve(102), null); assert.equal(calls.length, 3);
  assert.equal(await resolve(101), 42); assert.equal(calls.length, 3);
  for (const id of [0, -1, NaN, 1.2, Number.MAX_SAFE_INTEGER + 1]) assert.equal(await resolve(id), null);
  assert.equal(calls.length, 3);
});

test('artwork never substitutes difficulty IDs or accepts mismatched, oversized, deleted or malformed metadata', async () => {
  for (const response of [new Response(osuFile(102)), new Response(osuFile(101, -1)), new Response(osuFile(101, 0)),
    new Response('<html>BeatmapSetID:42</html>'), new Response('', { status: 404 }),
    new Response(osuFile(), { headers: { 'Content-Length': 3 * 1024 * 1024 } }),
    new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
    const resolve = createSetIdResolver(async () => response, { gapMs: 0 });
    assert.equal(await resolve(101), null);
  }
});

async function start(t, fetchImpl, { setId = 42, simulated = false } = {}) {
  const store = new SessionStore();
  await store.command({ id: 'setup', version: 0, type: 'setup', payload: {
    title: 'Artwork isolation', stage: 'group', mode: '3v3', source: '4x3',
    teams: { a: { name: 'Red', roster: [] }, b: { name: 'Blue', roster: [] } },
    pool: [{ id: 'hr2', mod: 'HR', label: 'HR2', beatmapId: 101, ...(setId ? { setId } : {}) }],
  } });
  store.state.auto = { ...store.state.auto, profile: 'stable-tourney', left: 'Red room', right: 'Blue room' };
  store.live.tosu = { status: 'live', data: { beatmap: { id: 101, setId: 42, checksum: 'map-a' },
    tourney: { teams: { left: 'Red room', right: 'Blue room' } } } };
  if (simulated) store.live.sources = { tosu: 'simulated' };
  const config = { port: 0, key: 'MUST_NOT_LEAK', wsUrl: 'ws://127.0.0.1:24050/websocket/v2' };
  const server = createOverlayServer(config, fetchImpl, undefined, store);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.port = server.address().port;
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${config.port}`;
  return { store, request: (path = '/api/beatmaps/101/cover', options = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...options }) };
}

test('cover URLs use official set IDs; only this match pool can request artwork and no credentials or arbitrary URLs are forwarded', async t => {
  const { request } = await start(t, async () => { throw new Error('NO_UPSTREAM_NEEDED'); });
  const cover = await request();
  assert.equal(cover.status, 302); assert.equal(cover.headers.get('location'), 'https://assets.ppy.sh/beatmaps/42/covers/cover.jpg');
  for (const path of ['/api/beatmaps/999/cover', '/api/beatmaps/101/audio', '/api/beatmaps/101/cover?url=http://evil.test', '/api/beatmaps/9007199254740992/cover']) {
    assert.equal((await request(path)).status, 404);
  }
  assert.equal((await request('/api/beatmaps/101/cover', { method: 'POST' })).status, 405);
});

test('matching live tosu backgrounds are bounded, cached, use the configured server and never receive the OCLR key', async t => {
  const calls = [];
  const { request } = await start(t, async (url, options) => {
    calls.push({ url, options });
    return new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } });
  });
  const first = await request('/api/beatmaps/101/background');
  assert.equal(first.status, 200); assert.equal(first.headers.get('x-artwork-source'), 'tosu');
  assert.deepEqual([...new Uint8Array(await first.arrayBuffer())], [255, 216, 255]);
  assert.equal((await request('/api/beatmaps/101/background')).status, 200);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'http://127.0.0.1:24050/files/beatmap/background');
  assert.equal(calls[0].options.headers.Authorization, undefined); assert.equal(calls[0].options.redirect, 'error');
});

test('wrong-map, disconnected, wrong-room and simulated signals never serve a tosu background for this card', async t => {
  const { store, request } = await start(t, async () => { throw new Error('MUST_NOT_FETCH'); });
  for (const change of [() => { store.live.tosu.data.beatmap.id = 999; },
    () => { store.live.tosu.data.beatmap.id = 101; store.live.tosu.status = 'stale'; },
    () => { store.live.tosu.status = 'live'; store.live.tosu.data.tourney.teams.left = 'Another room'; },
    () => { store.live.tosu.data.tourney.teams.left = 'Red room'; store.live.sources = { tosu: 'simulated' }; }]) {
    change();
    const response = await request('/api/beatmaps/101/background');
    assert.equal(response.status, 302); assert.equal(response.headers.get('x-artwork-source'), 'osu-cover');
  }
});

test('a map change during background download and invalid image responses fall back without attaching another map artwork', async t => {
  let store; let invalid = false;
  const server = await start(t, async () => {
    if (invalid) return new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } });
    store.live.tosu.data.beatmap.id = 999;
    return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } });
  });
  store = server.store;
  assert.equal((await server.request('/api/beatmaps/101/background')).status, 302);
  store.live.tosu.data.beatmap.id = 101;
  assert.equal((await server.request('/api/beatmaps/101/background')).status, 302);
  store.live.tosu.data.beatmap = { id: 101, setId: 42, checksum: 'map-b' }; invalid = true;
  assert.equal((await server.request('/api/beatmaps/101/background')).status, 302);
});

test('historical pools without set IDs resolve public metadata independently and keep the saved match unchanged', async t => {
  const { store, request } = await start(t, async url => {
    assert.equal(url, 'https://osu.ppy.sh/osu/101'); return new Response(osuFile());
  }, { setId: null, simulated: true });
  const before = structuredClone(store.state);
  const response = await request();
  assert.equal(response.status, 302); assert.match(response.headers.get('location'), /\/42\/covers\/cover.jpg$/);
  assert.deepEqual(store.state, before);
});
