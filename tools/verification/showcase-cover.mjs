// Issue #57 local preview capture. Drives the synthetic review page
// (/showcase?cover-demo=1) in headless Chrome; never touches tosu, OBS,
// the shared session or credentials.
//   node tools/verification/showcase-cover.mjs [http://127.0.0.1:3013]
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const base = process.argv[2] || 'http://127.0.0.1:3013';
const out = fileURLToPath(new URL('../../docs/verification/showcase-cover/', import.meta.url));
const profile = await mkdtemp('/private/tmp/oclr-57-chrome-');
const frames = await mkdtemp('/private/tmp/oclr-57-frames-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--allow-file-access-from-files', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
const report = { hold: [], scenarios: [], errors: [] };
try {
  await mkdir(out, { recursive: true });
  let devtools;
  for (let i = 0; i < 80 && !devtools; i++) { devtools = await readFile(`${profile}/DevToolsActivePort`, 'utf8').catch(() => null); if (!devtools) await wait(100); }
  assert.ok(devtools, 'Chrome started');
  const target = await fetch(`http://127.0.0.1:${devtools.split('\n')[0]}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  ws = new WebSocket(target.webSocketDebuggerUrl); await once(ws, 'open');
  let seq = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++seq; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data); const p = pending.get(m.id);
    if (p) { pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') report.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') report.errors.push(`${m.params.entry.text} ${m.params.entry.url || ''}`);
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, `evaluate failed: ${expression.slice(0, 100)}`);
    return result.result.value;
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  // Wide enough that the 1920×1080 canvas renders at scale 1 beside the panel.
  await send('Emulation.setDeviceMetricsOverride', { width: 2380, height: 1172, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/showcase?cover-demo=1` });
  await wait(1500);
  await evaluate('document.fonts.ready.then(() => true)');
  const transform = await evaluate(`getComputedStyle(document.querySelector('[data-showcase-canvas]')).transform`);
  assert.match(transform, /^matrix\(1, 0, 0, 1,/, `canvas renders at scale 1 (${transform})`);

  const click = async (label, times = 1) => {
    for (let i = 0; i < times; i++) await evaluate(`(() => { const b = [...document.querySelectorAll('.showcase-controls button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) throw new Error('no button ' + ${JSON.stringify(label)}); b.click(); return true; })()`);
    await wait(60);
  };
  const choose = (label, value) => evaluate(`(() => { const f = [...document.querySelectorAll('.cover-demo-field')].find(x => x.textContent.trim().startsWith(${JSON.stringify(label)})); const el = f.querySelector('select'); el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('change')); return true; })()`);
  const seekTo = ms => evaluate(`(() => { const el = document.querySelector('.cover-demo-field input[type=range]'); el.value = ${JSON.stringify(String(ms))}; el.dispatchEvent(new Event('input')); return Number(el.value); })()`);
  const toggle = (label, on) => evaluate(`(() => { const l = [...document.querySelectorAll('.cover-demo-check')].find(x => x.textContent.includes(${JSON.stringify(label)})); const i = l.querySelector('input'); if (i.checked !== ${on}) i.click(); return true; })()`);
  const coverStage = () => evaluate(`document.querySelector('.showcase-cover').dataset.stage`);
  const status = () => evaluate(`document.querySelector('.cover-demo-state').textContent.replace(/\\s+/g, ' ').trim()`);
  const clip = () => evaluate(`(() => { const r = document.querySelector('[data-showcase-canvas]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const shoot = async (file, scale = 1) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...(await clip()), scale } });
    await writeFile(file, Buffer.from(data, 'base64'));
    return data;
  };
  // Count leak-stripe yellow (#f5c400) pixels inside the 1600×800 replay area.
// Tight enough to exclude the HD amber (#f8b551) used by the cover itself.
  const leakPixels = data => evaluate(`new Promise(resolve => { const img = new Image(); img.onload = () => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 800; const g = c.getContext('2d');
    g.drawImage(img, 160, 100, 1600, 800, 0, 0, 1600, 800); const px = g.getImageData(0, 0, 1600, 800).data; let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] > 235 && px[i + 1] > 185 && px[i + 1] < 210 && px[i + 2] < 30) n++;
    resolve(n); }; img.src = 'data:image/png;base64,${'@DATA@'}'; })`.replace('@DATA@', data));
  const hold = async name => {
    await click('下一份成绩页');
    await wait(500);
    assert.equal(await coverStage(), 'holding', `${name}: holding`);
    const leak = await leakPixels(await shoot(`${out}${name}.png`));
    report.hold.push({ name, leak });
    assert.equal(leak, 0, `${name}: no leak-stripe pixel inside the replay area`);
  };
  const leave = async () => { await click('揭开'); await wait(1100); };

  // Pool order (18): NM1–5, HD1–3, HR1–3, DT1–3, FM1–3, TB. Titles cycle
  // every five slots: plain, long, Chinese, Japanese, short.
  // Positive control: uncovered leak stripes must be detected.
  await click('重置进度'); await click('下一份成绩页'); await wait(300);
  report.control = await leakPixels(await shoot(`${frames}/control.png`));
  assert.ok(report.control > 100000, `leak detector sees uncovered stripes (${report.control})`);
  await click('重置进度');
  for (let i = 0; i < 3; i++) { await click('成绩页'); await click('下一张'); }
  await click('上一张'); await click('斜幕遮挡'); await wait(900); await click('下一张');
  await hold('hold-next-art');                 // NM4, NM1–3 shown
  await click('上一张', 2);
  await hold('hold-long-title');               // NM2
  await toggle('有封面', false);
  await click('下一张', 6);
  await hold('hold-cjk-no-art');               // HD3, slot colour block
  await toggle('有封面', true);
  await click('下一张', 10);
  await hold('hold-tb');                       // TB
  await leave(); await click('斜幕遮挡'); await wait(900);
  await hold('hold-brand');                    // same map: brand idle
  await choose('图池张数', 24); await wait(400);
  await hold('hold-pool-24');
  await choose('图池张数', 13); await wait(400);
  await hold('hold-pool-13');
  await choose('图池张数', 18);
  await toggle('减少动态效果', true); await leave(); await click('下一张'); await click('斜幕遮挡'); await wait(400);
  await hold('hold-reduced');
  await toggle('减少动态效果', false);

  // Frozen frames: entry over the current map's results (allowed to air),
  // exit over the next replay.
  const sheet = async (name, stage, list, setup) => {
    await leave(); await setup();
    await choose('定格检查', stage); await wait(200);
    const shots = [];
    for (const ms of list) {
      await seekTo(ms); await wait(150);
      const file = `${frames}/${name}-${ms}.png`;
      await shoot(file, .5);
      shots.push({ ms, file });
    }
    await choose('定格检查', 'off');
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0c0718;color:#ddd;font:20px sans-serif}
      main{display:grid;grid-template-columns:repeat(3,960px);gap:12px;padding:12px}figure{margin:0}img{display:block;width:960px;height:540px}figcaption{padding:4px 0}</style>
      <main>${shots.map(s => `<figure><img src="${pathToFileURL(s.file)}"><figcaption>${name === 'enter' ? '进入' : '揭开'} · ${s.ms} ms</figcaption></figure>`).join('')}</main>`;
    const page = `${frames}/${name}.html`;
    await writeFile(page, html);
    await send('Page.navigate', { url: pathToFileURL(page).href }); await wait(800);
    const rows = Math.ceil(shots.length / 3);
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 12 + 3 * 972, height: 12 + rows * (540 + 12 + 34), scale: .5 } });
    await writeFile(`${out}${name}-frames.png`, Buffer.from(data, 'base64'));
    await send('Page.navigate', { url: `${base}/showcase?cover-demo=1` }); await wait(1500);
  };
  await sheet('enter', 'entering', [0, 80, 160, 240, 320, 420, 560, 700, 830], async () => {
    await click('重置进度'); await click('成绩页'); await click('斜幕遮挡'); await wait(900);
  });
  await sheet('leave', 'leaving', [0, 60, 120, 200, 280, 360, 440, 540, 680], async () => {
    await click('重置进度'); await click('成绩页'); await click('斜幕遮挡'); await wait(900); await click('下一张'); await click('回放中');
  });

  // Scripted flows at normal speed: the leak counter must stay at zero.
  for (const flow of ['正常换图', '同图重播', '提前打开 rep']) {
    await click('重置进度');
    await click(flow);
    await wait(15500);
    const text = await status();
    report.scenarios.push({ flow, status: text });
    assert.ok(!/露出/.test(text), `${flow}: ${text}`);
  }
  await writeFile(`${out}browser-checks.json`, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  ws?.close();
  chrome.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await rm(frames, { recursive: true, force: true }).catch(() => {});
}
console.log(JSON.stringify(report, null, 2));
