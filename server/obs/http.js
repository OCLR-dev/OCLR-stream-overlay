import { ObsError } from './socket.js';

export async function obsHttp(req, res, url, obs) {
  if (url.pathname !== '/api/obs') return false;
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
    return true;
  };
  if (url.search) return send(400, { error: { code: 'INVALID_QUERY' } });
  if (!obs) return send(503, { error: { message: '本机 OBS 服务尚未就绪。' } });
  if (req.method === 'GET') return send(200, obs.snapshot());
  if (req.method !== 'POST') return send(405, { error: { code: 'METHOD_NOT_ALLOWED' } });
  if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    return send(403, { error: { code: 'SAME_ORIGIN_JSON_REQUIRED' } });
  }
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) return send(413, { error: { code: 'REQUEST_TOO_LARGE' } });
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return send(200, await obs.command(input));
  } catch (error) {
    return send(409, { error: { message: error instanceof ObsError ? error.message : '操作未完成，请核对本机设置后重试。' } });
  }
}
