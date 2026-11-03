import { boundedBody } from './beatmap-metadata.js';

const MAX_PROFILE_BYTES = 2 * 1024 * 1024;
const COVER_TTL = 6 * 60 * 60 * 1000;
const FAILURE_TTL = 10 * 60 * 1000;

function end(res, status, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end();
}

// osu! profile covers live under a per-user content hash. The profile page is
// public, so resolve that hash locally instead of requiring OAuth in the browser.
export function parseProfileCover(body, uid) {
  if (!Number.isSafeInteger(uid) || uid <= 0) return null;
  const pattern = new RegExp(`user-profile-covers/${uid}/([a-f0-9]{64})\\.(jpe?g|png|webp)`, 'i');
  const match = String(body).replaceAll('\\/', '/').match(pattern);
  return match ? `https://assets.ppy.sh/user-profile-covers/${uid}/${match[1].toLowerCase()}.${match[2].toLowerCase()}` : null;
}

export function createPlayerArtHandler(fetchImpl = fetch, { now = Date.now } = {}) {
  const covers = new Map();
  const pending = new Map();

  async function resolveCover(uid) {
    try {
      const response = await fetchImpl(`https://osu.ppy.sh/users/${uid}`, {
        method: 'GET',
        headers: { Accept: 'text/html', 'User-Agent': 'oclr-stream-overlay/0.1' },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') || '')) return null;
      return parseProfileCover((await boundedBody(response, MAX_PROFILE_BYTES)).toString('utf8'), uid);
    } catch {
      return null;
    }
  }

  async function coverFor(uid) {
    const cached = covers.get(uid);
    if (cached && cached.until > now()) return cached.url;
    if (!pending.has(uid)) pending.set(uid, resolveCover(uid));
    let url;
    try { url = await pending.get(uid); } finally { pending.delete(uid); }
    covers.set(uid, { url, until: now() + (url ? COVER_TTL : FAILURE_TTL) });
    return url;
  }

  return async (req, res, url) => {
    if (!url.pathname.startsWith('/api/players/')) return false;
    const match = url.pathname.match(/^\/api\/players\/([1-9]\d*)\/(cover|avatar)$/);
    if (!match || url.search) { end(res, 404); return true; }
    if (req.method !== 'GET') { end(res, 405, { Allow: 'GET' }); return true; }
    const uid = Number(match[1]);
    if (!Number.isSafeInteger(uid)) { end(res, 404); return true; }
    if (match[2] === 'avatar') {
      end(res, 302, { Location: `https://a.ppy.sh/${uid}`, 'Cache-Control': 'public, max-age=86400' });
      return true;
    }
    const cover = await coverFor(uid);
    if (!cover) { end(res, 404); return true; }
    end(res, 302, { Location: cover, 'Cache-Control': 'public, max-age=21600' });
    return true;
  };
}
