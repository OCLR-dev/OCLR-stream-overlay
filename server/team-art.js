export const validTeamImageId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

// Public team media uses the configured website origin. Never forward the
// developer/streamer credential or accept a URL supplied by session data.
export function createTeamArtHandler(config) {
  const backend = new URL(config.backend || 'https://oclr.org').origin;
  return (req, res, url) => {
    if (!url.pathname.startsWith('/api/teams/')) return false;
    const match = url.pathname.match(/^\/api\/teams\/([^/]+)\/avatar$/);
    const version = url.searchParams.get('v');
    const valid = match && validTeamImageId(match[1]) && validTeamImageId(version) &&
      [...url.searchParams].length === 1;
    const status = !valid ? 404 : req.method !== 'GET' ? 405 : 302;
    res.writeHead(status, { 'Cache-Control': 'no-store',
      ...(status === 405 ? { Allow: 'GET' } : {}),
      ...(status === 302 ? { Location: `${backend}/api/teams/${match[1]}/avatar?${new URLSearchParams({ v: version })}` } : {}) });
    res.end();
    return true;
  };
}
