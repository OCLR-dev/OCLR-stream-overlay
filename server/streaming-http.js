const send = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
};
export async function streamingHttp(req, res, url, source, store) {
  if (url.pathname !== '/api/streaming') return false;
  if (url.search) { send(res, 400, { error: { code: 'INVALID_QUERY' } }); return true; }
  if (req.method === 'GET') { send(res, 200, source.snapshot()); return true; }
  if (req.method !== 'POST') { send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }); return true; }
  if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    send(res, 403, { error: { code: 'SAME_ORIGIN_JSON_REQUIRED' } }); return true;
  }
  try {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length; if (size > 4096) throw new Error('INVALID_INPUT'); chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (input.action === 'connect') await source.connect(input);
    else if (input.action === 'disconnect') source.disconnect();
    else if (input.action === 'import' && store) await store.command(source.importCommand(input));
    else throw new Error('INVALID_INPUT');
    send(res, 200, source.snapshot());
  } catch (error) {
    const message = /[\u4e00-\u9fff]/.test(error.message) ? error.message : '连接未完成，请核对赛季与授权凭证后重试';
    send(res, 409, { error: { code: 'STREAMING_COMMAND_REJECTED', message } });
  }
  return true;
}
