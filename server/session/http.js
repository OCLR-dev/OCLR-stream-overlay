const send = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
};

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('请求过大');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('JSON 格式无效'); }
}

export async function sessionHttp(req, res, url, store) {
  if (!['/api/session', '/api/session/events', '/api/session/command'].includes(url.pathname)) return false;
  if (!store) { send(res, 503, { error: { code: 'SESSION_SERVICE_REQUIRED' } }); return true; }
  if (req.method === 'GET' && url.pathname === '/api/session') {
    send(res, 200, store.snapshot()); return true;
  }
  if (req.method === 'GET' && url.pathname === '/api/session/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
    let pending = null;
    let latest;
    const write = snapshot => {
      if (!res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)) res.destroy();
    };
    let first = true;
    const unsubscribe = store.subscribe(snapshot => {
      latest = snapshot;
      if (first) { first = false; write(snapshot); }
      else if (!pending) pending = setTimeout(() => { pending = null; write(latest); }, 80);
    });
    const heartbeat = setInterval(() => res.write('event: heartbeat\ndata: {}\n\n'), 15000);
    res.on('close', () => { unsubscribe(); clearInterval(heartbeat); clearTimeout(pending); });
    return true;
  }
  if (req.method !== 'POST' || url.pathname !== '/api/session/command') {
    send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }); return true;
  }
  // Missing Origin is intentionally rejected for local writes (including curl).
  if (req.headers.origin !== `http://${req.headers.host}` ||
      req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    send(res, 403, { error: { code: 'SAME_ORIGIN_JSON_REQUIRED' } }); return true;
  }
  try {
    const command = await body(req);
    let snapshot;
    if (command.type === 'load-edition') {
      if (!store.loadEdition) throw new Error('数据适配层尚未启动');
      snapshot = await store.loadEdition(command.payload?.edition);
    } else if (command.type === 'import-match') {
      if (!store.importMatch) throw new Error('数据适配层尚未启动');
      snapshot = await store.importMatch(command);
    } else snapshot = await store.command(command);
    send(res, 200, snapshot);
  } catch (error) {
    // Only application validation text is sent. Filesystem/remote errors can carry private paths.
    const safe = /[\u4e00-\u9fff]/.test(error.message) ? error.message : '操作失败，请检查输入与来源状态';
    send(res, 409, { error: { code: 'SESSION_COMMAND_REJECTED', message: safe }, snapshot: store.snapshot() });
  }
  return true;
}
