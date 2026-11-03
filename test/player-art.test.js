import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerArtHandler, parseProfileCover } from '../server/player-art.js';

const HASH = 'ac1b84e6b12237571b58607417795432bde8e22f98e7ab65806879a929f4ced5';
const profile = String.raw`<script>{"cover":{"url":"https:\/\/assets.ppy.sh\/user-profile-covers\/7562902\/${HASH}.jpeg"}}</script>`;

function recorder() {
  const state = {};
  return {
    state,
    res: {
      writeHead(status, headers = {}) { state.status = status; state.headers = headers; },
      end(body) { state.body = body; },
    },
  };
}

test('profile covers resolve only for the requested numeric user and preserve the asset extension', () => {
  assert.equal(parseProfileCover(profile, 7562902),
    `https://assets.ppy.sh/user-profile-covers/7562902/${HASH}.jpeg`);
  assert.equal(parseProfileCover(profile.replace('.jpeg', '.PNG'), 7562902),
    `https://assets.ppy.sh/user-profile-covers/7562902/${HASH}.png`);
  assert.equal(parseProfileCover(profile, 7562903), null);
  assert.equal(parseProfileCover(profile, 0), null);
  assert.equal(parseProfileCover(profile, -1), null);
  assert.equal(parseProfileCover(profile, 1.5), null);
  assert.equal(parseProfileCover('<html>no cover</html>', 7562902), null);
});

test('player art redirects avatars and resolves, caches and retries covers', async () => {
  let time = Date.now(); const calls = []; const fetchImpl = async url => {
    calls.push(url);
    return new Response(profile, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  const handler = createPlayerArtHandler(fetchImpl, { now: () => time });
  const req = { method: 'GET' };

  let recorded = recorder();
  assert.equal(await handler(req, recorded.res, new URL('http://localhost/api/players/7562902/avatar')), true);
  assert.equal(recorded.state.status, 302);
  assert.equal(recorded.state.headers.Location, 'https://a.ppy.sh/7562902');
  assert.equal(calls.length, 0);

  recorded = recorder();
  assert.equal(await handler(req, recorded.res, new URL('http://localhost/api/players/7562902/cover')), true);
  assert.equal(recorded.state.status, 302);
  assert.equal(recorded.state.headers.Location, `https://assets.ppy.sh/user-profile-covers/7562902/${HASH}.jpeg`);
  assert.equal(calls.length, 1);

  recorded = recorder();
  assert.equal(await handler(req, recorded.res, new URL('http://localhost/api/players/7562902/cover')), true);
  assert.equal(calls.length, 1);
  time += 6 * 60 * 60 * 1000 + 1;
  recorded = recorder();
  await handler(req, recorded.res, new URL('http://localhost/api/players/7562902/cover'));
  assert.equal(calls.length, 2);
});

test('player art rejects malformed, non-GET and missing-cover requests without leaking paths', async () => {
  const handler = createPlayerArtHandler(async () => new Response('<html>no cover</html>', {
    headers: { 'content-type': 'text/html' },
  }));
  for (const [method, path, status] of [
    ['POST', '/api/players/7562902/cover', 405],
    ['GET', '/api/players/0/cover', 404],
    ['GET', '/api/players/7562902/cover?x=1', 404],
    ['GET', '/api/players/7562902/nope', 404],
    ['GET', '/api/players/7562902/cover', 404],
  ]) {
    const recorded = recorder();
    assert.equal(await handler({ method }, recorded.res, new URL(`http://localhost${path}`)), true);
    assert.equal(recorded.state.status, status);
  }
  assert.equal(await handler({ method: 'GET' }, recorder().res, new URL('http://localhost/api/other')), false);
});
