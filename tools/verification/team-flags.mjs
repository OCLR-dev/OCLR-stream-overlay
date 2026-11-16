// Isolated browser regression. All team identities, images and awards below
// are synthetic; this never loads credentials or connects to tosu/OBS.
import { createOverlayServer } from '../../server/app.js';
import { SessionStore } from '../../server/session/store.js';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('../../docs/verification/team-flags/', import.meta.url));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const store = new SessionStore();
const command = (type, payload = {}) => store.command({ id: crypto.randomUUID(), version: store.state.version, type, payload });
const red = { id: id(1), name: '隔离验证红队 · 长队名检查', avatarKey: id(11), roster: [] };
const blue = { id: id(2), name: '隔离验证蓝队', avatarKey: id(22), roster: [] };
await command('setup', { title: '合成队旗回归 · 非真实赛事', stage: 'group', mode: '4v4', source: '4x3', teams: { a: red, b: blue }, pool: [] });
const config = { port: 0, backend: 'https://oclr.org', wsUrl: null };
const server = createOverlayServer(config, async () => new Response('', { status: 404 }), undefined, store);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); config.port = server.address().port;
const profile = await mkdtemp('/private/tmp/oclr-52-chrome-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
let ws;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await mkdir(out, { recursive: true });
  let devtools;
  for (let i = 0; i < 60; i++) {
    devtools = await readFile(profile + '/DevToolsActivePort', 'utf8').catch(() => null);
    if (devtools) break;
    await wait(100);
  }
  assert.ok(devtools, 'Chrome started');
  const port = devtools.split('\n')[0];
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  ws = new WebSocket(target.webSocketDebuggerUrl); await once(ws, 'open');
  let seq = 0; const pending = new Map(); const errors = []; const media = []; const held = [];
  let holdKey = null;
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++seq; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  const fulfill = (requestId, url) => {
    const failed = url.searchParams.get('v') === id(99);
    const isRed = url.pathname.includes(id(1));
    const width = isRed ? 240 : 80, height = isRed ? 80 : 160;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${isRed ? '#814256' : '#335180'}"/><rect x="3" y="3" width="${width - 6}" height="${height - 6}" fill="none" stroke="white" stroke-width="3"/><text x="${width / 2}" y="${height / 2 + 6}" text-anchor="middle" fill="white" font-size="18">TEST ${isRed ? 'A' : 'B'}</text></svg>`;
    return send('Fetch.fulfillRequest', { requestId, responseCode: failed ? 404 : 200, responseHeaders: [{ name: 'Content-Type', value: 'image/svg+xml' }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(failed ? '' : svg).toString('base64') });
  };
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data); const p = pending.get(m.id);
    if (p) { pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params; const url = new URL(request.url);
      media.push(request.url);
      if (url.searchParams.get('v') === holdKey) held.push({ requestId, url });
      else void fulfill(requestId, url).catch(error => errors.push(String(error)));
    }
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, 'browser evaluation succeeds');
    return result.result.value;
  };
  const until = async (expression, label) => {
    for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await wait(50); }
    assert.fail(label);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://oclr.org/api/teams/*/avatar*' }] });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const base = `http://127.0.0.1:${config.port}`;
  const report = { synthetic: true, checks: [], mediaRequests: media };
  const flags = `([...document.querySelectorAll('.team-block .team-flag')].map(e => ({ label:e.getAttribute('aria-label'), text:e.textContent.trim(), src:e.querySelector('img')?.getAttribute('src'), loaded:!!e.querySelector('img.is-loaded'), fit:e.querySelector('img') && getComputedStyle(e.querySelector('img')).objectFit, box:(()=>{const r=e.querySelector('.team-flag-frame').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})() })))`;
  const shot = async name => {
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(out + name, Buffer.from(screenshot.data, 'base64'));
  };
  await send('Page.navigate', { url: base + '/overlay' });
  await until(`document.querySelectorAll('.team-block .team-flag img.is-loaded').length === 2`, 'both flags loaded');
  const initial = await evaluate(flags);
  assert.ok(initial[0].src.includes(id(1)) && initial[1].src.includes(id(2)));
  assert.ok(initial.every(f => f.fit === 'contain' && f.box.width === 120 && f.box.height === 72));
  report.checks.push({ case: 'standalone images, wide/tall contain', flags: initial });
  await shot('overlay-images.png');
  // Verify every scene and eight layout combinations keep the flag geometry.
  for (const scene of ['waiting', 'roll', 'mappool', 'playing', 'victory', 'pause']) {
    store.state.scene = scene; store.state.version++; store.emit(); await wait(120);
    assert.deepEqual((await evaluate(flags)).map(f => f.box), initial.map(f => f.box));
  }
  const geometry = [];
  for (const mode of ['3v3', '4v4']) for (const source of ['4x3', '16x9']) for (const ex of [null, 'a']) {
    store.state.scene = 'playing'; store.state.match.mode = mode; store.state.match.source = source; store.state.ex.team = ex; store.state.version++; store.emit(); await wait(120);
    assert.deepEqual((await evaluate(flags)).map(f => f.box), initial.map(f => f.box));
    geometry.push({ mode, source, ex, flagsUnchanged: true });
  }
  report.checks.push({ case: 'six scenes and eight capture layouts', geometry });
  store.state.ex.team = null; store.state.match.mode = '4v4'; store.state.match.source = '4x3';
  store.state.version++; store.emit(); await wait(150);
  await evaluate(`window.flagCaptureNodes = [...document.querySelectorAll('[data-playfield] [data-game-capture]')]`);
  const setTeams = async teams => { store.state.match.teams = structuredClone(teams); store.state.version++; store.emit(); await wait(140); };
  // Old image is still downloading when its side switches to another team.
  holdKey = id(33);
  await setTeams({ a: { ...red, avatarKey: holdKey }, b: blue });
  await until(`document.querySelector('.team-block--a .team-flag-monogram') !== null`, 'pending image fallback');
  for (let i = 0; i < 40 && !held.length; i++) await wait(50);
  assert.ok(held.length, 'old request held');
  await setTeams({ a: blue, b: red });
  await until(`document.querySelector('.team-block--a .team-flag img.is-loaded')?.getAttribute('src').includes('${id(2)}')`, 'new team loaded');
  for (const old of held) await fulfill(old.requestId, old.url).catch(() => {});
  holdKey = null; await wait(150);
  assert.ok((await evaluate(flags))[0].src.includes(id(2)));
  await setTeams({ a: blue, b: { ...red, avatarKey: id(44) } });
  await until(`document.querySelector('.team-block--b .team-flag img.is-loaded')?.getAttribute('src').includes('${id(44)}')`, 'new image version loaded');
  report.checks.push({ case: 'swap, version update and late previous image', passed: true });
  // Live automatic banner for each side; no old award is replayed on refresh.
  for (const team of ['a', 'b']) {
    store.state.history.push({ id: crypto.randomUUID(), at: new Date().toISOString(), version: ++store.state.version, source: 'tosu', message: `tosu 最终队分 ${team === 'a' ? '2:1' : '1:2'} · 自动加赢图` });
    store.emit();
    await until(`document.querySelector('.map-win-banner[data-team="${team}"] .team-flag img.is-loaded') !== null`, 'winning flag loaded');
    const banner = await evaluate(`({ src:document.querySelector('.map-win-banner img').getAttribute('src'), fit:getComputedStyle(document.querySelector('.map-win-banner img')).objectFit, width:document.querySelector('.map-win-banner .team-flag-frame').getBoundingClientRect().width, height:document.querySelector('.map-win-banner .team-flag-frame').getBoundingClientRect().height })`);
    assert.ok(banner.src.includes(store.state.match.teams[team].id));
    assert.deepEqual([banner.width, banner.height, banner.fit], [150, 90, 'contain']);
    report.checks.push({ case: 'win banner ' + team, ...banner });
    await shot('banner-' + team + '.png');
  }
  await setTeams({ a: { ...red, avatarKey: null }, b: { ...blue, avatarKey: id(99) } });
  await until(`document.querySelectorAll('.team-block .team-flag-monogram').length === 2 && document.querySelectorAll('.team-block .team-flag img').length === 0`, 'missing/failed images use monograms');
  report.checks.push({ case: 'one absent and one failed image', flags: await evaluate(flags) });
  assert.equal(await evaluate(`window.flagCaptureNodes.every((node, i) => node === document.querySelectorAll('[data-playfield] [data-game-capture]')[i])`), true, 'image changes preserve mounted game captures');
  await send('Page.navigate', { url: base + '/overlay' });
  await until(`document.querySelectorAll('.team-block .team-flag-monogram').length === 2`, 'fallback after reload');
  assert.equal(await evaluate(`document.querySelector('.map-win-banner') === null`), true, 'refresh does not replay past awards');
  await shot('fallback.png');
  for (const team of ['a', 'b']) {
    store.state.history.push({ id: crypto.randomUUID(), at: new Date().toISOString(), version: ++store.state.version, source: 'tosu', message: `tosu 最终队分 ${team === 'a' ? '2:1' : '1:2'} · 自动加赢图` });
    store.emit();
    await until(`document.querySelector('.map-win-banner[data-team="${team}"] .team-flag-monogram') !== null && document.querySelector('.map-win-banner img') === null`, 'winning flag fallback');
    report.checks.push({ case: 'win banner fallback ' + team, passed: true });
  }
  await setTeams({ a: { ...red, avatarKey: undefined }, b: { ...blue, avatarKey: null } });
  await wait(150);
  assert.equal(await evaluate(`document.querySelectorAll('.team-block .team-flag img').length`), 0);
  report.checks.push({ case: 'legacy and exhibition absent images', passed: true });
  await setTeams({ a: red, b: blue });
  await send('Page.navigate', { url: base + '/control' });
  await until(`document.querySelector('iframe')?.contentDocument?.querySelectorAll('.team-block .team-flag img.is-loaded').length === 2`, 'control preview images loaded');
  assert.equal(await evaluate(`document.querySelector('iframe').contentDocument.body.dataset.sessionTransport`), 'parent-preview');
  report.checks.push({ case: 'control preview shares session transport and loads both images', passed: true });
  await shot('control-preview.png');
  assert.deepEqual(errors, []);
  report.runtimeErrors = errors;
  await writeFile(out + 'browser-checks.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, checks: report.checks.length, out }));
} finally {
  ws?.close(); chrome.kill('SIGTERM'); await once(chrome, 'exit');
  store.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
