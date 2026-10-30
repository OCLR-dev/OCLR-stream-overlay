import { boundedBody, createBeatmapMetadataResolver } from './beatmap-metadata.js';

const positiveId = value => Number.isSafeInteger(value) && value > 0;
const HOUR = 60 * 60 * 1000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function remember(cache, key, value, limit = 240) {
  if (cache.size >= limit) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

// Public .osu metadata supplies the set ID without an OAuth key. Never use a
// difficulty ID as a set ID, or guess artwork for an unavailable/deleted map.
export function createSetIdResolver(fetchImpl = fetch, { gapMs = 1000, now = Date.now } = {}) {
  const resolve = createBeatmapMetadataResolver(fetchImpl, { gapMs, now });
  return async id => (await resolve(id))?.setId ?? null;
}

function matchingLive(snapshot, id) {
  const { session, live } = snapshot;
  const data = live.tosu.data;
  return live.sources?.tosu !== 'simulated' && live.tosu.status === 'live' && data?.beatmap.id === id &&
    session.auto.profile === 'stable-tourney' && session.auto.left && session.auto.right &&
    data.tourney?.teams.left === session.auto.left && data.tourney?.teams.right === session.auto.right ? data.beatmap : null;
}

export function createArtworkHandler(config, fetchImpl, store) {
  const resolveMetadata = createBeatmapMetadataResolver(fetchImpl);
  // Thumbnails need this match and telemetry, not a copy of the potentially
  // large historical catalogue for every image request.
  const snapshot = () => store ? { session: store.state, live: store.live } : null;
  const backgrounds = new Map(); const pending = new Map();
  let tosuUrl = null;
  try {
    const url = new URL(config.wsUrl);
    if (['ws:', 'wss:'].includes(url.protocol) && !url.username && !url.password && !url.search) {
      url.protocol = url.protocol === 'ws:' ? 'http:' : 'https:';
      url.pathname = '/files/beatmap/background'; url.hash = '';
      tosuUrl = url.href;
    }
  } catch { /* A service without tosu can still use official covers. */ }
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/api/beatmaps/')) return false;
    const match = url.pathname.match(/^\/api\/beatmaps\/([1-9]\d*)\/(cover|background|metadata)$/);
    const id = Number(match?.[1]);
    const current = snapshot();
    const entry = current?.session.pool.find(item => item.beatmapId === id);
    const fail = status => { res.writeHead(status, { 'Cache-Control': 'no-store' }); res.end(); return true; };
    if (req.method !== 'GET') return fail(405);
    if (!match || url.search || !positiveId(id) || !entry) return fail(404);
    if (match[2] === 'metadata') {
      const metadata = await resolveMetadata(id);
      if (!metadata || !snapshot().session.pool.some(item => item.beatmapId === id)) return fail(404);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(metadata)); return true;
    }
    const liveMap = matchingLive(current, id);
    if (match[2] === 'background' && tosuUrl && liveMap) {
      const key = JSON.stringify([id, liveMap.checksum, liveMap.setId]);
      let cached = backgrounds.get(key);
      if (!cached || cached.until <= Date.now()) {
        if (!pending.has(key)) pending.set(key, (async () => {
          let image = null;
          try {
            const response = await fetchImpl(tosuUrl, { headers: { Accept: 'image/*' }, redirect: 'error', signal: AbortSignal.timeout(5000) });
            const type = response.headers.get('content-type')?.split(';')[0];
            if (!response.ok || !IMAGE_TYPES.has(type)) throw new Error('INVALID_BACKGROUND');
            image = { type, bytes: await boundedBody(response, 8 * 1024 * 1024) };
            const latest = matchingLive(snapshot(), id);
            if (!latest || JSON.stringify([id, latest.checksum, latest.setId]) !== key) image = null;
          } catch { /* Missing local artwork falls back to the verified official set. */ }
          const result = { image, until: Date.now() + (image ? HOUR : 10000) };
          remember(backgrounds, key, result, 8);
          return result;
        })());
        try { cached = await pending.get(key); } finally { pending.delete(key); }
      }
      const latest = matchingLive(snapshot(), id);
      // The shortcut follows tosu's selected map. A map/room change while the
      // response is in flight must never attach its background to the old card.
      if (cached.image && latest && JSON.stringify([id, latest.checksum, latest.setId]) === key) {
        res.writeHead(200, { 'Content-Type': cached.image.type, 'Content-Length': cached.image.bytes.length,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Artwork-Source': 'tosu' });
        res.end(cached.image.bytes); return true;
      }
    }
    const setId = positiveId(entry.setId) ? entry.setId : positiveId(liveMap?.setId) ? liveMap.setId : (await resolveMetadata(id))?.setId;
    if (!setId || !snapshot().session.pool.some(item => item.beatmapId === id)) return fail(404);
    res.writeHead(302, { Location: `https://assets.ppy.sh/beatmaps/${setId}/covers/cover.jpg`,
      'Cache-Control': 'public, max-age=3600', 'X-Artwork-Source': 'osu-cover' });
    res.end(); return true;
  };
}
