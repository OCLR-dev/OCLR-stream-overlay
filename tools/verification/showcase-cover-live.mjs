// Production-route regression with explicitly synthetic, in-memory diagnostics.
// No saved sessions, credentials, external API calls or real OBS/tosu processes.
// Run after npm run build: node tools/verification/showcase-cover-live.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createOverlayServer } from '../../server/app.js';
import { ObsController } from '../../server/obs/controller.js';
import { showcaseScene } from '../../server/obs/showcase.js';
import { SessionStore } from '../../server/session/store.js';
import { Studio } from '../../test/obs-fixture.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const out = fileURLToPath(new URL('../../docs/verification/showcase-cover/integration/', import.meta.url));
const report = { checks: [], errors: [] };
const profile = await mkdtemp('/private/tmp/oclr-cover-live-');
class ReplayFeed {
  constructor(options) { Object.assign(this, options); }
  start() { this.active = true; }
  stop() { this.active = false; }
  push(status, time, id) { if (this.active) this.onFrame(this.normalize({ osuIsRunning: 1, status, rawStatus: status === 32 ? 7 : 2, mapid: id, time })); }
}
const studio = new Studio();
studio.useUuids = true;
studio.kinds.push('color_source_v3');
const session = new SessionStore();
const original = structuredClone(session.state);
const config = { port: 0, wsUrl: 'ws://127.0.0.1:24050/websocket/v2' };
const obs = await new ObsController({ overlayUrl: () => `http://127.0.0.1:${config.port}/overlay`, Socket: studio.Socket,
  ReplayClient: ReplayFeed, tosuUrl: config.wsUrl, resultsMs: 450 }).start(session);
config.obs = obs;
const server = createOverlayServer(config, async () => { throw new Error('External requests forbidden in this regression'); }, undefined, session);
let chrome, ws;
try {
  await mkdir(out, { recursive: true });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  await obs.command({ action: 'connect', port: 4455, password: 'diagnostic-only' });
  for (let n = 0; obs.phase !== 'ready' && n < 100; n++) await wait(10);
  assert.equal(obs.phase, 'ready');
  await obs.command({ action: 'create-showcase' });
  await obs.command({ action: 'setup-showcase-transition' });
  const initial = await fetch(`${base}/api/showcase`).then(r => r.json());
  const post = body => fetch(`${base}/api/showcase`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) }).then(r => r.json());
  await post({ type: 'pool-text', poolToken: initial.poolToken, text: 'NM1 101 Diagnostic map A\nHD1 102 Diagnostic map B' });
  await post({ type: 'stage-label', value: 'LOCAL VERIFICATION' });
  const v2 = (number, id = 101) => {
    session.live.tosu = { status: 'live', updatedAt: new Date().toISOString(), data: { state: { number },
      beatmap: { id, title: `Diagnostic map ${id === 101 ? 'A' : 'B'}`, artist: 'Local diagnostic fixture', difficulty: 'Regression', setId: null }, tourney: null } };
    session.emit();
  };
  studio.cut(showcaseScene); await obs.tail;
  v2(2);
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let devtools;
  for (let i = 0; i < 80 && !devtools; i++) { devtools = await readFile(`${profile}/DevToolsActivePort`, 'utf8').catch(() => null); if (!devtools) await wait(100); }
  assert.ok(devtools, 'Chrome started');
  const target = await fetch(`http://127.0.0.1:${devtools.split('\n')[0]}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  ws = new WebSocket(target.webSocketDebuggerUrl); await once(ws, 'open');
  let seq = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const task = pending.get(message.id);
    if (task) { pending.delete(message.id); message.error ? task.reject(message.error) : task.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') report.errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      const id = Number(request.url.match(/beatmaps\/(\d+)/)?.[1]);
      // Keep image and metadata traffic entirely synthetic and in memory.
      const image = !request.url.includes('/metadata');
      const body = image ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
        : Buffer.from(JSON.stringify({ beatmapId: id, source: 'osu-file', title: 'Diagnostic', artist: 'Local fixture', difficulty: 'Regression' })).toString('base64');
      void send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: image ? 'image/png' : 'application/json' }], body });
    }
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined);
    return result.result.value;
  };
  const until = async (expression, label) => {
    for (let n = 0; n < 100; n++) { if (await evaluate(expression)) { report.checks.push(label); return; } await wait(30); }
    throw new Error(`Timed out: ${label}`);
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/beatmaps/*' }] });
  await send('Page.navigate', { url: `${base}/showcase?clean=1&layer=cover` });
  await until(`document.querySelector('.showcase-stage-title strong')?.textContent === 'LOCAL VERIFICATION' && !!document.querySelector('.cover-brand')`, 'production output reads Showcase SSE and treats the first map as a baseline');
  await evaluate('document.fonts.ready.then(() => true)');
  await until(`document.querySelector('.showcase-cover')?.dataset.stage === 'holding'`, 'initial cover mounts silently');
  const shoot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${out}${name}.png`, Buffer.from(data, 'base64'));
    return data;
  };
  obs.replayClient.push(8, 0, 101); obs.replayClient.push(8, .2, 101); await obs.tail;
  await until(`document.querySelector('.showcase-cover')?.dataset.stage === 'hidden'`, 'confirmed replay reveals artwork');
  const transparent = await shoot('playing-transparent');
  const opaquePixels = await evaluate(`new Promise(resolve => { const img = new Image(); img.onload = () => {
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); const pixels = ctx.getImageData(0, 0, 1920, 1080).data;
    let count = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++; resolve(count);
  }; img.src = 'data:image/png;base64,${transparent}'; })`);
  assert.equal(opaquePixels, 0, 'all output pixels are transparent after revealing');
  report.checks.push('1920×1080 playback output is fully transparent');
  v2(7); obs.replayClient.push(32, 120, 101);
  await wait(100);
  assert.equal(await evaluate(`document.querySelector('.showcase-cover').dataset.stage`), 'hidden');
  await until(`document.querySelector('.showcase-cover')?.dataset.stage === 'entering'`, 'results timeout animates the eight bands');
  await until(`document.querySelector('.showcase-cover')?.dataset.stage === 'holding'`, 'curtain reaches opaque holding state');
  await until(`document.querySelectorAll('.cover-chip[data-state="done"]').length === 1 && !!document.querySelector('.cover-brand')`, 'completed map is counted once and same map shows brand');
  await shoot('results-brand');
  v2(1, 102);
  await until(`document.querySelector('.cover-slot')?.textContent === 'HD1' && !document.querySelector('.cover-brand')`, 'new client map selects the next real Slot');
  await shoot('next-map');
  await send('Page.reload');
  await until(`document.querySelectorAll('.cover-chip[data-state="done"]').length === 1 && document.querySelector('.cover-slot')?.textContent === 'HD1'`, 'reload preserves server progress and next map');
  v2(2, 102); obs.replayClient.push(8, 0, 102); obs.replayClient.push(8, .2, 102); await obs.tail;
  await until(`document.querySelector('.showcase-cover')?.dataset.stage === 'hidden'`, 'next replay reveals the same persistent output');
  session.live.tosu.status = 'disconnected'; session.emit(); await obs.tail;
  await until(`document.querySelector('.showcase-cover')?.dataset.stage === 'holding' && !!document.querySelector('.cover-brand')`, 'disconnect cuts immediately to opaque brand cover');
  assert.deepEqual(session.state, original, 'diagnostic playback never writes match state');
  assert.equal(report.errors.length, 0);
  await writeFile(`${out}browser-checks.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  ws?.close(); chrome?.kill();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  obs.close(); session.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
