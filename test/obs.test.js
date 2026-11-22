import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { ObsController } from '../server/obs/controller.js';
import { ObsSocket } from '../server/obs/socket.js';
import { capture, exPositions, presetScenes, slots } from '../server/obs/presets.js';
import { createOverlayServer } from '../server/app.js';
import { SessionStore } from '../server/session/store.js';
import { clientWindow, Studio } from './obs-fixture.js';

const { regular, ex } = presetScenes;
const desktop = 'OCLR · 桌面音频';
const connect = { action: 'connect', port: 4455, password: 'test-only-password' };
const overlayUrl = () => 'http://127.0.0.1:3010/overlay';
const cuts = studio => studio.log.filter(x => x.type === 'SetCurrentProgramScene').map(x => x.sceneName);
const writes = studio => studio.log.filter(x => /^(?:Set|Create)/.test(x.type));
async function until(predicate) {
  for (let i = 0; i < 150; i++) { if (predicate()) return; await delay(5); }
  assert.fail('OBS fixture did not reach the expected state');
}
async function setup(t, { file, studio = new Studio(), store = new SessionStore() } = {}) {
  const obs = new ObsController({ file, overlayUrl, Socket: studio.Socket, retryMs: 15, scanMs: 20000 });
  await obs.start(store);
  t.after(() => { obs.close(); store.close(); });
  return { obs, store, studio, act: (type, payload = {}) => store.command({ id: crypto.randomUUID(), version: store.state.version, type, payload }) };
}
async function ready(obs) { await obs.command(connect); await until(() => obs.phase === 'ready'); }
const current = (studio, layout, slot) => studio.scenes.get(layout).find(item => item.sourceName === capture(slot));

test('OBS WebSocket identifies using the v5 challenge, correlates RPCs and discards pending requests on close', async () => {
  let wire;
  class Transport extends EventTarget {
    sent = [];
    constructor(url, protocol) { super(); assert.equal(url, 'ws://127.0.0.1:4455'); assert.equal(protocol, 'obswebsocket.json'); wire = this; }
    send(value) { this.sent.push(JSON.parse(value)); }
    push(op, d) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ op, d }) })); }
    close() { this.dispatchEvent(new Event('close')); }
  }
  const events = [];
  const socket = new ObsSocket({ port: 4455, password: 'supersecretpassword', WebSocketImpl: Transport,
    onEvent: (...args) => events.push(args), onClose() {} });
  wire.push(0, { authentication: { salt: 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=', challenge: '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=' } });
  assert.deepEqual(wire.sent[0], { op: 1, d: { rpcVersion: 1, eventSubscriptions: 198, authentication: '1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=' } });
  wire.push(2, { negotiatedRpcVersion: 1 }); await socket.ready;
  const one = socket.request('GetSceneList'), two = socket.request('GetCurrentProgramScene');
  const reply = (index, data) => wire.push(7, { requestId: wire.sent[index].d.requestId, requestStatus: { result: true }, responseData: data });
  reply(2, { sceneName: 'Program' }); reply(1, { scenes: [] });
  assert.deepEqual(await one, { scenes: [] }); assert.deepEqual(await two, { sceneName: 'Program' });
  wire.push(5, { eventType: 'CurrentProgramSceneChanged', eventData: { sceneName: '广告' } });
  assert.deepEqual(events, [['CurrentProgramSceneChanged', { sceneName: '广告' }]]);
  const pending = socket.request('GetVideoSettings'); socket.close();
  await assert.rejects(pending, /中断/);
});

test('cancelling an OBS handshake settles once even when the native close emits a synchronous error', async () => {
  let wire, closes = 0, notifications = 0;
  class ConnectingSocket extends EventTarget {
    constructor() { super(); wire = this; }
    close() {
      closes++;
      if (closes === 1) this.dispatchEvent(new Event('error'));
    }
  }
  const socket = new ObsSocket({ port: 4455, password: '', WebSocketImpl: ConnectingSocket,
    onEvent() {}, onClose() { notifications++; } });
  const failedHandshake = assert.rejects(socket.ready, /中断/);
  socket.close();
  wire.dispatchEvent(new Event('close'));
  socket.close();
  await failedHandshake;
  assert.equal(closes, 1);
  assert.equal(notifications, 1);
});

test('a saved, unreachable OBS connection can retry after startup while the match service stays usable', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-obs-unavailable-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let attempts = 0;
  const unavailable = createServer((_req, response) => {
    attempts++;
    response.writeHead(503, { Connection: 'close', 'Content-Length': '0' });
    response.end();
  });
  await new Promise(resolve => unavailable.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => unavailable.close(resolve)));
  const port = unavailable.address().port;
  const file = join(dir, 'obs-settings.json');
  await writeFile(file, JSON.stringify({ enabled: true, port, password: '', profiles: [] }));
  const store = new SessionStore();
  const version = store.state.version;
  const obs = await new ObsController({ file, overlayUrl, retryMs: 25 }).start(store);
  const config = { port: 0, obs };
  const server = createOverlayServer(config, undefined, undefined, store);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.port = server.address().port;
  const base = 'http://127.0.0.1:' + config.port;
  t.after(() => new Promise(resolve => server.close(resolve)));
  await until(() => attempts >= 2 && obs.phase === 'offline');
  const status = await (await fetch(base + '/api/obs')).json();
  assert.match(status.error, new RegExp(String(port)));
  const session = await (await fetch(base + '/api/session')).json();
  assert.equal(session.session.version, version);
  const response = await fetch(base + '/api/obs', { method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'disconnect' }) });
  assert.equal((await response.json()).phase, 'off');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).enabled, false);
});

test('presets share inputs, exactly match both capture aspects, and preserve adjusted scenes on repeated create', async t => {
  const { obs, studio, act } = await setup(t);
  assert.equal(studio.connections, 0);
  await ready(obs);
  await obs.command({ action: 'create' }); await obs.tail;
  assert.equal(studio.scenes.size, 3); assert.equal(studio.inputs.size, 10);
  assert.equal(studio.inputs.get(desktop).inputKind, 'wasapi_output_capture');
  assert.deepEqual(studio.inputs.get(desktop).inputSettings, { device_id: 'default' });
  assert.equal(studio.log.filter(r => r.type === 'CreateInput' && r.inputName === desktop).length, 1);
  for (const scene of [regular, ex]) {
    const [item] = studio.scenes.get(scene);
    assert.equal(item.sourceName, desktop); assert.equal(item.sceneItemEnabled, true);
    assert.ok(studio.scenes.get(scene).every(item => item.sceneItemLocked));
  }
  for (const slot of slots) assert.equal(studio.inputs.get(capture(slot)).inputSettings.capture_audio, false);
  const browser = studio.scenes.get(regular).at(-1).sourceName;
  assert.equal(browser, studio.scenes.get(ex).at(-1).sourceName);
  assert.equal(studio.inputs.get(browser).inputSettings.url, overlayUrl());
  assert.equal(studio.inputs.get(browser).inputSettings.width, 1920);
  assert.deepEqual(obs.snapshot().rows.map(r => r.status), slots.map(() => '已绑定'));
  for (const [aspect, offset, height] of [['4x3', 0, 360], ['16x9', 45, 270]]) {
    await act('setting', { field: 'source', value: aspect }); await obs.tail;
    for (const [name, lineup, xs, ys] of [
      [regular, slots, [0,480,0,480,960,1440,960,1440], [180,180,540,540,180,180,540,540]],
      [ex, exPositions, [0,480,240,960,1440,1200], [180,180,540,180,180,540]],
    ]) {
      const visible = studio.scenes.get(name).filter(i => i.sceneItemEnabled && i.inputKind === 'game_capture');
      assert.deepEqual(visible.map(i => i.sourceName), lineup.map(capture));
      for (const [i, item] of visible.entries()) assert.deepEqual(item.transform, {
        alignment: 5, positionX: xs[i], positionY: ys[i] + offset, boundsType: 'OBS_BOUNDS_SCALE_INNER',
        boundsAlignment: 0, boundsWidth: 480, boundsHeight: height });
    }
  }
  await obs.command({ action: 'lineup', position: 'A2', slot: 'A4' });
  assert.equal(current(studio, ex, 'A2').sceneItemEnabled, false);
  assert.equal(current(studio, ex, 'A4').transform.positionX, 480);
  assert.equal(current(studio, regular, 'A4').transform.positionY, 585);
  await obs.command({ action: 'lineup', position: 'B1', slot: 'B3' });
  assert.deepEqual(obs.snapshot().lineup, ['A1', 'A4', 'A3', 'B3', 'B2', 'B1']);
  assert.deepEqual(cuts(studio), []);
  current(studio, ex, 'B3').transform.positionY = 226;
  current(studio, ex, 'B3').sceneItemLocked = false;
  const before = writes(studio).length; await obs.command({ action: 'create' }); await obs.tail;
  assert.equal(writes(studio).length, before); assert.equal(current(studio, ex, 'B3').transform.positionY, 226);
  assert.equal(current(studio, ex, 'B3').sceneItemLocked, false);
  const { measurements } = await obs.command({ action: 'measure' });
  assert.equal(measurements.filter(row => row.visible && row.scene === ex).length, 7);
  assert.equal(measurements.find(row => row.scene === ex && row.input === capture('B3')).y, 226);
});

test('desktop rendering preference persists offline and fits a shared 4K source in both 1080p layouts', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-obs-rendering-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'obs-settings.json');
  const { obs, studio } = await setup(t, { file });
  studio.useUuids = true;
  assert.deepEqual(obs.snapshot().overlayRendering, { highResolution: false, applied: false, error: '' });
  const pending = await obs.command({ action: 'overlay-rendering', highResolution: true });
  assert.deepEqual(pending.overlayRendering, { highResolution: true, applied: false, error: '' });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).overlayHighResolution, true);
  assert.equal(studio.connections, 0);
  await ready(obs);
  await obs.command({ action: 'create' });
  await obs.tail;

  const browser = 'OCLR · 比赛画面';
  const setting = studio.inputs.get(browser).inputSettings;
  assert.deepEqual([setting.width, setting.height], [3840, 2160]);
  for (const scene of [regular, ex]) {
    const { transform } = studio.scenes.get(scene).find(item => item.sourceName === browser);
    assert.deepEqual([transform.positionX, transform.positionY, transform.boundsWidth, transform.boundsHeight], [0, 0, 1920, 1080]);
    assert.equal(transform.boundsType, 'OBS_BOUNDS_SCALE_INNER');
  }
  const transform = structuredClone(current(studio, ex, 'B3').transform);
  const resized = studio.log.filter(item => item.type === 'SetInputSettings' && 'width' in item.inputSettings);
  assert.equal(resized.length, 1);
  assert.equal(resized[0].inputUuid, studio.inputs.get(browser).inputUuid);
  assert.deepEqual(obs.snapshot().overlayRendering, { highResolution: true, applied: true, error: '' });
  const saved = await obs.command({ action: 'overlay-rendering', highResolution: false });
  assert.deepEqual(saved.overlayRendering, { highResolution: false, applied: true, error: '' });
  assert.deepEqual([setting.width, setting.height], [1920, 1080]);
  assert.deepEqual(current(studio, ex, 'B3').transform, transform);
  assert.deepEqual([studio.canvas.baseWidth, studio.canvas.baseHeight], [1920, 1080]);
});

test('an interrupted resize can be reapplied after reconnect without touching an external browser source', async t => {
  const { obs, studio } = await setup(t);
  await ready(obs);
  await obs.command({ action: 'create' });
  await obs.tail;
  const browser = 'OCLR · 比赛画面';
  const unrelated = { width: 1920, height: 1080 };
  studio.inputs.set('导播独立源', { inputName: '导播独立源', inputKind: 'browser_source', inputSettings: unrelated });
  const item = studio.scenes.get(ex).find(item => item.sourceName === browser);
  item.transform.boundsWidth = 960;
  studio.failNext = 'SetSceneItemTransform';
  const failed = await obs.command({ action: 'overlay-rendering', highResolution: true });
  assert.equal(failed.overlayRendering.highResolution, true);
  assert.equal(failed.overlayRendering.applied, false);
  assert.ok(failed.overlayRendering.error);
  assert.equal(studio.inputs.get(browser).inputSettings.width, 1920);
  await obs.command({ action: 'disconnect' });
  await ready(obs); await obs.tail;
  assert.equal(item.transform.boundsWidth, 1920);
  assert.equal(studio.inputs.get(browser).inputSettings.width, 3840);
  assert.deepEqual(unrelated, { width: 1920, height: 1080 });
  assert.deepEqual(obs.snapshot().overlayRendering, { highResolution: true, applied: true, error: '' });
});

test('a saved video-only preset gains shared desktop audio on retry and yields to either global desktop slot', async t => {
  const { obs, studio } = await setup(t);
  studio.useUuids = true;
  studio.specialInputs.desktop2 = '导播声卡';
  studio.specialInputs.mic1 = '现场解说';
  await ready(obs); await obs.command({ action: 'create' });
  assert.equal(studio.inputs.has(desktop), false);

  const window = studio.inputs.get(capture('A1')).inputSettings;
  const originalWindow = window.window;
  window.capture_audio = true;
  current(studio, ex, 'B1').transform.positionX = 970;
  studio.specialInputs.desktop2 = null;
  studio.failNext = 'CreateSceneItem';
  await assert.rejects(obs.command({ action: 'create' }), /模拟请求失败/);
  const uuid = studio.inputs.get(desktop).inputUuid;
  assert.equal(obs.profile.preset.desktopAudio.uuid, uuid);
  const audioItems = scene => studio.scenes.get(scene).filter(item => item.sourceUuid === uuid);
  assert.equal(audioItems(regular).length, 1); assert.equal(audioItems(ex).length, 0);
  await obs.command({ action: 'create' });
  for (const scene of [regular, ex]) assert.deepEqual(audioItems(scene).map(i => i.sceneItemEnabled), [true]);
  assert.equal(window.capture_audio, false); assert.equal(window.window, originalWindow);
  assert.equal(current(studio, ex, 'B1').transform.positionX, 970);
  studio.specialInputs.desktop1 = '直播桌面';
  await obs.command({ action: 'create' });
  for (const scene of [regular, ex]) assert.deepEqual(audioItems(scene).map(i => i.sceneItemEnabled), [false]);
  studio.specialInputs.desktop1 = null;
  await obs.command({ action: 'create' });
  for (const scene of [regular, ex]) assert.deepEqual(audioItems(scene).map(i => i.sceneItemEnabled), [true]);
  assert.equal(studio.log.filter(r => r.type === 'CreateInput' && r.inputKind === 'wasapi_output_capture').length, 1);
  assert.equal(studio.program, '休息'); assert.deepEqual(studio.scenes.get('休息'), []);
});

test('an existing scene output is shared with the other preset using its original playback device', async t => {
  const { obs, studio } = await setup(t);
  studio.specialInputs.desktop1 = '桌面音频';
  await ready(obs); await obs.command({ action: 'create' });
  studio.specialInputs.desktop1 = null;
  const name = '比赛耳机';
  await studio.request('CreateInput', { sceneName: ex, inputName: name, inputKind: 'wasapi_output_capture',
    inputSettings: { device_id: 'USB headphones' }, sceneItemEnabled: true });
  await obs.command({ action: 'create' });
  for (const scene of [regular, ex]) {
    const outputs = studio.scenes.get(scene).filter(item => item.inputKind === 'wasapi_output_capture');
    assert.deepEqual(outputs.map(item => [item.sourceName, item.sceneItemEnabled]), [[name, true]]);
    assert.equal(outputs[0].sceneItemLocked, scene === regular); // Only the newly linked item was placed by the preset.
  }
  assert.equal(studio.inputs.get(name).inputSettings.device_id, 'USB headphones');
  assert.equal(studio.inputs.has(desktop), false);
});

const chatSource = 'OCLR · 直播间弹幕';
const testIdentity = 'TESTONLY000001';

test('a saved identity installs one transparent chat input above both presets and rotates in place', async t => {
  const { obs, studio, store } = await setup(t);
  studio.useUuids = true;
  await ready(obs);
  const configure = code => obs.command({ action: 'stream-chat', code });
  const pending = await configure('  ' + testIdentity + ' ');
  assert.equal(pending.streamChat, 'pending');
  assert.equal(studio.scenes.size, 1);
  assert.equal((await obs.command({ action: 'create' })).streamChat, 'configured');
  const input = studio.inputs.get(chatSource);
  assert.equal(input.inputKind, 'browser_source');
  assert.equal(input.inputSettings.url, `https://blive.chat/room/${testIdentity}?roomKeyType=2`);
  assert.deepEqual([input.inputSettings.width, input.inputSettings.height, input.inputSettings.shutdown, input.inputSettings.restart_when_active], [398, 112, false, false]);
  assert.match(input.inputSettings.css, /background: transparent/);
  for (const scene of [regular, ex]) {
    const item = studio.scenes.get(scene).at(-1);
    assert.equal(item.sourceUuid, input.inputUuid);
    assert.equal(item.sceneItemEnabled, true); assert.equal(item.sceneItemLocked, true);
    assert.deepEqual(item.transform, { alignment: 5, positionX: 1481, positionY: 950, scaleX: 1, scaleY: 1, boundsType: 'OBS_BOUNDS_NONE' });
  }
  const adjusted = studio.scenes.get(regular).at(-1);
  adjusted.sceneItemLocked = false; adjusted.transform.positionX += 5;
  const before = writes(studio).length;
  const next = 'TESTONLY000002';
  const response = await configure(next);
  assert.deepEqual(writes(studio).slice(before).map(call => call.type), ['SetInputSettings']);
  assert.equal(input.inputSettings.url, `https://blive.chat/room/${next}?roomKeyType=2`);
  await configure(next); await obs.command({ action: 'create' });
  assert.equal(writes(studio).length, before + 1);
  await studio.removeScene(ex);
  await obs.command({ action: 'create' });
  assert.equal(studio.scenes.get(ex).at(-1).sourceUuid, input.inputUuid);
  assert.equal(adjusted.sceneItemLocked, false); assert.equal(adjusted.transform.positionX, 1486);
  assert.equal(studio.log.filter(call => call.type === 'CreateInput' && call.inputName === chatSource).length, 1);
  assert.doesNotMatch(JSON.stringify([response, await obs.command({ action: 'measure' }), store.snapshot()]), /TESTONLY|blive\.chat\/room/);
  assert.equal(studio.program, '休息');
});

test('chat can target bound scenes and resume an interrupted placement after a restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-obs-chat-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'obs-settings.json');
  const { obs, studio, store } = await setup(t, { file });
  for (const scene of ['八路', '六路']) studio.scenes.set(scene, []);
  await ready(obs);
  await obs.command({ action: 'bind', layout: 'regular', name: '八路' });
  await obs.command({ action: 'bind', layout: 'ex', name: '六路' });
  studio.before = (type, data) => { if (type === 'SetSceneItemTransform' && data.sceneName === '六路') studio.failNext = type; };
  await assert.rejects(obs.command({ action: 'stream-chat', code: testIdentity }), /模拟请求失败/);
  assert.equal(obs.snapshot().streamChat, 'pending');
  const regularItem = studio.scenes.get('八路')[0];
  regularItem.sceneItemLocked = false; regularItem.transform.positionY = 945;
  studio.before = null; obs.close();
  const resumed = (await setup(t, { studio, store, file })).obs;
  await until(() => resumed.snapshot().streamChat === 'configured'); await resumed.tail;
  assert.equal(studio.scenes.get('六路').length, 1); assert.equal(studio.scenes.get('六路')[0].sceneItemLocked, true);
  assert.equal(regularItem.sceneItemLocked, false); assert.equal(regularItem.transform.positionY, 945);
  assert.equal(studio.inputs.size, 1); assert.deepEqual(studio.scenes.get('休息'), []);
  assert.doesNotMatch(JSON.stringify(resumed.snapshot()), /TESTONLY/);
});

test('chat rejects invalid identity codes and creates a distinct input when its name is occupied', async t => {
  const { obs, studio } = await setup(t); await ready(obs); await obs.command({ action: 'create' });
  for (const code of ['1234', 'TOOSHORT', 'https://blive.chat/room/123', 'A/B?CDEFGHIJ', '']) {
    await assert.rejects(obs.command({ action: 'stream-chat', code }), /身份码/);
  }
  assert.equal(obs.snapshot().streamChat, 'off');
  await studio.request('CreateInput', { sceneName: '休息', inputName: chatSource, inputKind: 'browser_source',
    inputSettings: { url: 'about:blank' }, sceneItemEnabled: true });
  const foreign = structuredClone(studio.inputs.get(chatSource));
  const before = writes(studio).length;
  assert.equal((await obs.command({ action: 'stream-chat', code: testIdentity })).streamChat, 'configured');
  assert.deepEqual(studio.inputs.get(chatSource), foreign);
  assert.equal(obs.profile.streamChat.name, chatSource + ' (2)');
  assert.equal(studio.inputs.get(chatSource + ' (2)').inputSettings.url, `https://blive.chat/room/${testIdentity}?roomKeyType=2`);
  assert.equal(writes(studio).slice(before).some(call => call.type === 'SetInputSettings' && call.inputName === chatSource), false);
  const done = writes(studio).length;
  await obs.command({ action: 'stream-chat', code: testIdentity });
  assert.equal(writes(studio).length, done);
  assert.equal(studio.inputs.get(chatSource).inputSettings.url, 'about:blank');
});

test('independent controllers in one collection reuse a matching chat source for Showcase', async t => {
  const { obs: owner, studio, store } = await setup(t);
  studio.useUuids = true;
  await ready(owner); await owner.command({ action: 'create' });
  await owner.command({ action: 'stream-chat', code: testIdentity });
  const source = studio.inputs.get(chatSource);
  source.inputSettings.css = '/* operator chat style */';
  const settings = structuredClone(source.inputSettings);
  const originalScenes = [regular, ex].map(name => structuredClone(studio.scenes.get(name)));
  const match = structuredClone(store.state);
  const { obs } = await setup(t, { studio });
  await ready(obs); await obs.command({ action: 'create-showcase' });
  const before = writes(studio).length;
  await obs.command({ action: 'stream-chat', code: testIdentity });
  assert.equal(obs.snapshot().streamChat, 'configured');
  assert.equal(obs.profile.streamChat.uuid, source.inputUuid);
  assert.deepEqual(source.inputSettings, settings);
  assert.equal(writes(studio).slice(before).some(call => ['CreateInput', 'SetInputSettings'].includes(call.type)), false);
  assert.equal(studio.scenes.get('OCLR · Showcase').at(-1).sourceUuid, source.inputUuid);
  assert.deepEqual([regular, ex].map(name => studio.scenes.get(name)), originalScenes);
  assert.deepEqual(store.state, match);
  assert.equal(studio.program, '休息');
  const done = writes(studio).length;
  await obs.command({ action: 'stream-chat', code: testIdentity });
  assert.equal(writes(studio).length, done);
});

test('chat discovers matching renamed inputs despite stale saved IDs and avoids scene/group names', async t => {
  const { obs, studio } = await setup(t); studio.useUuids = true;
  await ready(obs); await obs.command({ action: 'create-showcase' });
  await studio.request('CreateInput', { sceneName: '休息', inputName: '导播弹幕', inputKind: 'browser_source',
    inputSettings: { url: `https://blive.chat/room/${testIdentity}?roomKeyType=2`, css: 'custom' }, sceneItemEnabled: true });
  await obs.saveProfile({ ...obs.profile, streamChat: { code: testIdentity, name: chatSource, uuid: 'removed-input', items: {} } });
  await obs.command({ action: 'stream-chat', code: testIdentity });
  assert.equal(obs.profile.streamChat.name, '导播弹幕');
  assert.equal(obs.profile.streamChat.uuid, studio.inputs.get('导播弹幕').inputUuid);
  assert.equal(studio.inputs.has(chatSource), false);
  // The active collection has a same-name scene and group, but no chat for this identity.
  studio.scenes.set(chatSource, []);
  studio.scenes.set('八路', []); studio.scenes.set('六路', []);
  const request = studio.request.bind(studio);
  studio.request = (type, args) => type === 'GetGroupList' ? Promise.resolve({ groups: [chatSource + ' (2)'] }) : request(type, args);
  const { obs: other } = await setup(t, { studio }); await ready(other);
  await other.command({ action: 'bind', layout: 'regular', name: '八路' });
  await other.command({ action: 'bind', layout: 'ex', name: '六路' });
  await other.command({ action: 'stream-chat', code: 'TESTONLY000002' });
  assert.equal(other.profile.streamChat.name, chatSource + ' (3)');
  assert.equal(studio.inputs.get('导播弹幕').inputSettings.url, `https://blive.chat/room/${testIdentity}?roomKeyType=2`);
});

test('chat discovery stays within the active collection and saves independent bindings', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-obs-chat-collections-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'obs-settings.json');
  const { obs: first, studio: a } = await setup(t, { file }); a.useUuids = true;
  await ready(first); await first.command({ action: 'create-showcase' });
  await first.command({ action: 'stream-chat', code: testIdentity });
  const firstSource = structuredClone(a.inputs.get(chatSource));
  first.close();
  const b = new Studio(); b.useUuids = true; b.collection = '另一集合';
  const { obs: second } = await setup(t, { studio: b, file });
  await until(() => second.phase === 'ready');
  await second.command({ action: 'create-showcase' });
  await second.command({ action: 'stream-chat', code: testIdentity });
  assert.notEqual(b.inputs.get(chatSource).inputUuid, firstSource.inputUuid);
  assert.deepEqual(a.inputs.get(chatSource), firstSource);
  assert.equal(second.settings.profiles.find(p => p.name === a.collection).streamChat.uuid, firstSource.inputUuid);
  assert.equal(second.settings.profiles.find(p => p.name === b.collection).streamChat.uuid, b.inputs.get(chatSource).inputUuid);
});

test('rescanning binds padded osu!tourney titles by client number and writes their exact OBS identifiers', async t => {
  const { obs, studio } = await setup(t);
  studio.windows = [];
  await ready(obs);
  await obs.command({ action: 'create' });

  // Window titles, classes and enumeration order from the Windows operator's OBS list.
  const clientClass = 'WindowsForms10.Window.2b.app.0.1ca0192_r7_ad1';
  const windowItem = (title, windowClass) => ({
    itemEnabled: true, itemName: `[osu!.exe]: ${title}`, itemValue: `${title}:${windowClass}:osu!.exe`,
  });
  studio.windows = [7, 6, 5, 0, 4, 3, 2, 1].map(n => windowItem(` Tournament Client ${n}`, clientClass));
  studio.windows.push(windowItem(' Tournament Manager', 'WindowsForms10.Window.2b.app.0.34f5582_r7_ad1'));
  const { rows } = await obs.command({ action: 'scan' });
  for (const [n, slot] of slots.entries()) {
    const value = ` Tournament Client ${n}:${clientClass}:osu!.exe`;
    const row = rows.find(row => row.slot === slot);
    assert.equal(row.status, '已绑定');
    assert.equal(row.value, value);
    assert.equal(studio.inputs.get(capture(slot)).inputSettings.window, value);
  }
  await obs.command({ action: 'scan' });
  assert.equal(studio.log.filter(entry => entry.type === 'SetInputSettings').length, 8);
});

test('unmatched, ambiguous and duplicate OBS windows need explicit selection and retain manual bindings', async t => {
  const { obs, studio } = await setup(t);
  const alternative = 'osu!tourney Client 0:OtherClass:osu!.exe';
  studio.windows = [clientWindow(0), { ...clientWindow(0), itemValue: alternative }, clientWindow(2), clientWindow(2, 'OtherClass'), clientWindow(4),
    { ...clientWindow(3), itemEnabled: false }, { ...clientWindow(6), itemValue: 'Tournament Client 6:Other:other.exe' }];
  await ready(obs); await obs.command({ action: 'create' });
  const row = slot => obs.snapshot().rows.find(r => r.slot === slot);
  assert.match(row('A1').status, /重名/); assert.match(row('A2').status, /未找到/); assert.match(row('A3').status, /重名/);
  assert.equal(row('B1').status, '已绑定'); assert.equal(row('B3').value, '');
  assert.equal(obs.snapshot().windows.length, 3);
  await assert.rejects(obs.command({ action: 'window', slot: 'A3', value: clientWindow(2).itemValue }), /重新识别/);
  await obs.command({ action: 'window', slot: 'A1', value: alternative });
  await assert.rejects(obs.command({ action: 'window', slot: 'A2', value: row('A1').value }), /其他槽位/);
  studio.windows.push(clientWindow(1));
  await obs.command({ action: 'scan' });
  assert.equal(row('A1').value, alternative); assert.equal(row('A2').status, '已绑定');
  await obs.command({ action: 'window', slot: 'A2', value: '' });
  await obs.command({ action: 'scan' }); assert.equal(row('A2').status, '手动留空');
});

test('creation checks canvas, capture support and name collisions; interrupted creation can resume', async t => {
  const { obs, studio } = await setup(t); await ready(obs);
  studio.canvas.baseWidth = 1280;
  await assert.rejects(obs.command({ action: 'create' }), /1920×1080/);
  studio.canvas.baseWidth = 1920; studio.kinds = ['browser_source'];
  await assert.rejects(obs.command({ action: 'create' }), /Windows OBS/);
  studio.kinds.push('window_capture', 'wasapi_output_capture'); studio.scenes.set(regular, []);
  await assert.rejects(obs.command({ action: 'create' }), /已存在/);
  assert.equal(writes(studio).length, 0); studio.scenes.delete(regular);
  studio.failNext = 'SetSceneItemTransform';
  await assert.rejects(obs.command({ action: 'create' }), /模拟请求失败/);
  assert.equal(obs.snapshot().follow, false);
  await obs.command({ action: 'create' }); await obs.tail;
  assert.equal(studio.inputs.get(capture('A4')).inputKind, 'window_capture');
  assert.equal(studio.scenes.get(regular).length, 10); assert.equal(studio.scenes.get(ex).length, 10);
  for (const scene of [regular, ex]) assert.ok(studio.scenes.get(scene).every(item => item.sceneItemLocked));
});

test('a failed scene-item lock resumes only unfinished placement, including an added desktop audio item', async t => {
  const { obs, studio } = await setup(t);
  await ready(obs);
  studio.before = (type, args) => {
    if (type === 'SetSceneItemLocked' && args.sceneName === ex && args.sceneItemId === current(studio, ex, 'A2').sceneItemId) studio.failNext = type;
  };
  await assert.rejects(obs.command({ action: 'create' }), /模拟请求失败/);
  const unlockedInPartialScene = current(studio, ex, 'A1');
  assert.equal(unlockedInPartialScene.sceneItemLocked, true);
  unlockedInPartialScene.sceneItemLocked = false;
  const unlocked = current(studio, regular, 'A1');
  unlocked.sceneItemLocked = false;
  unlocked.transform.positionX = 123;
  studio.before = (type, args) => {
    const audio = studio.scenes.get(regular).find(i => i.sourceName === desktop);
    if (type === 'SetSceneItemLocked' && audio && args.sceneItemId === audio.sceneItemId) studio.failNext = type;
  };
  await assert.rejects(obs.command({ action: 'create' }), /模拟请求失败/);
  assert.equal(studio.scenes.get(regular).find(i => i.sourceName === desktop).sceneItemLocked, false);
  studio.before = undefined;
  await obs.command({ action: 'create' }); await obs.tail;
  assert.equal(unlocked.sceneItemLocked, false);
  assert.equal(unlocked.transform.positionX, 123);
  assert.equal(unlockedInPartialScene.sceneItemLocked, false);
  assert.ok(studio.scenes.get(ex).filter(item => item !== unlockedInPartialScene).every(item => item.sceneItemLocked));
  assert.equal(studio.scenes.get(regular)[0].sceneItemLocked, true);
  assert.equal(studio.log.filter(r => r.type === 'CreateInput' && r.inputName === desktop).length, 1);
});

for (const [removed, kept] of [[regular, ex], [ex, regular]]) {
  test(`creating after deleting ${removed} reuses shared inputs and preserves the other layout`, async t => {
    const { obs, studio } = await setup(t);
    studio.useUuids = true;
    await ready(obs); await obs.command({ action: 'create' });
    await obs.command({ action: 'lineup', position: 'A2', slot: 'A4' });
    await obs.command({ action: 'follow', enabled: false });
    current(studio, kept, 'A1').transform.positionX = 97;
    current(studio, kept, 'A1').sceneItemLocked = false;
    studio.scenes.get(kept).at(-1).sceneItemLocked = false;
    studio.scenes.get(kept)[0].sceneItemLocked = false;
    const keptItems = structuredClone(studio.scenes.get(kept));
    const beforeIds = new Map(studio.sceneIds);
    const beforeInputs = structuredClone(studio.inputs);
    delete obs.profile.preset.inputIds; // Existing Windows packages only saved scene IDs.
    await studio.removeScene(removed);
    assert.match(obs.snapshot().error, /创建比赛场景/);
    assert.equal(cuts(studio).length, 0);
    const before = writes(studio).length;
    const repaired = await obs.command({ action: 'create' }); await obs.tail;
    assert.equal(repaired.managed, true); assert.equal(repaired.error, ''); assert.equal(repaired.follow, false);
    assert.equal(repaired.lineup[1], 'A4');
    assert.deepEqual(studio.inputs, beforeInputs);
    assert.deepEqual(studio.scenes.get(kept), keptItems);
    assert.equal(studio.sceneIds.get(kept), beforeIds.get(kept));
    assert.notEqual(studio.sceneIds.get(removed), beforeIds.get(removed));
    assert.equal(studio.scenes.get(removed).length, 10);
    assert.ok(studio.scenes.get(removed).every(item => item.sceneItemLocked));
    assert.equal(studio.scenes.get(removed).filter(item => item.sceneItemEnabled).length, removed === ex ? 8 : 10);
    const mutations = writes(studio).slice(before);
    assert.deepEqual(mutations.filter(call => call.type === 'CreateScene').map(call => call.sceneName), [removed]);
    assert.equal(mutations.filter(call => call.type === 'CreateInput').length, 0);
    assert.equal(mutations.filter(call => call.type === 'CreateSceneItem').length, 10);
    assert.equal(studio.program, '休息');
    const done = writes(studio).length; await obs.command({ action: 'create' });
    assert.equal(writes(studio).length, done);
  });
}

test('a rebuild of both deleted scenes resumes after restart, keeping a source used in a third scene', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-obs-rebuild-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'obs-settings.json');
  const { obs, studio, store } = await setup(t, { file }); studio.useUuids = true;
  await ready(obs); await obs.command({ action: 'create' });
  await obs.command({ action: 'window', slot: 'B4', value: '' });
  const shared = capture('A1'), originalInput = studio.inputs.get(shared);
  studio.addItem('休息', shared, true);
  await studio.removeScene(regular, false); await studio.removeScene(ex, false); // Missed OBS notifications.
  assert.equal(studio.inputs.size, 1);
  studio.failNext = 'SetSceneItemTransform';
  await assert.rejects(obs.command({ action: 'create' }), /模拟请求失败/);
  const partialId = studio.sceneIds.get(regular);
  assert.ok(partialId);
  obs.close();
  const resumed = (await setup(t, { file, studio, store })).obs;
  await until(() => resumed.phase === 'ready');
  const repaired = await resumed.command({ action: 'create' }); await resumed.tail;
  assert.equal(repaired.managed, true); assert.equal(repaired.error, ''); assert.equal(repaired.follow, true);
  assert.equal(studio.sceneIds.get(regular), partialId);
  assert.equal(studio.scenes.size, 3); assert.equal(studio.inputs.size, 10);
  assert.equal(studio.scenes.get(regular).length, 10); assert.equal(studio.scenes.get(ex).length, 10);
  assert.equal(studio.inputs.get(shared), originalInput);
  assert.equal(repaired.rows.find(r => r.slot === 'B4').status, '手动留空');
  assert.deepEqual(cuts(studio), []);
});

test('upgrading an old preset recovers both scenes and reuses a capture still referenced elsewhere', async t => {
  const { obs, studio } = await setup(t);
  await ready(obs); await obs.command({ action: 'create' });
  const preset = obs.profile.preset;
  delete preset.inputIds; delete preset.pendingLayouts;
  const name = capture('B2'), savedInput = studio.inputs.get(name);
  savedInput.inputSettings.window = '替补:WindowsForms10.Window:osu!.exe';
  studio.addItem('休息', name, true);
  await studio.removeScene(regular); await studio.removeScene(ex);
  const repaired = await obs.command({ action: 'create' });
  assert.equal(repaired.managed, true); assert.equal(repaired.error, '');
  assert.equal(studio.inputs.get(name), savedInput);
  assert.equal(repaired.rows.find(row => row.slot === 'B2').value, '替补:WindowsForms10.Window:osu!.exe');
  for (const scene of [regular, ex]) assert.equal(studio.scenes.get(scene).length, 10);
});

test('a foreign source with the old name cannot be taken over while rebuilding deleted scenes', async t => {
  const { obs, studio } = await setup(t); studio.useUuids = true;
  await ready(obs); await obs.command({ action: 'create' });
  await studio.removeScene(regular); await studio.removeScene(ex);
  const name = capture('A1');
  studio.inputs.set(name, { inputName: name, inputUuid: crypto.randomUUID(), inputKind: 'game_capture', inputSettings: { window: '用户窗口' } });
  studio.addItem('休息', name, true);
  const before = writes(studio).length;
  await assert.rejects(obs.command({ action: 'create' }), /来源不符/);
  assert.equal(writes(studio).length, before);
  assert.equal(studio.inputs.get(name).inputSettings.window, '用户窗口');
});

test('actual match commands drive Program independently of Preview, scene displays, wins and EX counts', async t => {
  const { obs, studio, store, act } = await setup(t);
  await act('setting', { field: 'pool', value: [{ id: 'nm', mod: 'NM', label: 'NM1', beatmapId: 101 }, { id: 'tb', mod: 'TB', label: 'TB', beatmapId: 102 }] });
  await act('prepare-round', { entryId: 'nm', pickedBy: 'a' });
  await ready(obs); await obs.command({ action: 'create' }); await obs.command({ action: 'return' });
  current(studio, regular, 'A1').sceneItemLocked = false;
  const lockCount = studio.log.filter(r => r.type === 'SetSceneItemLocked').length;
  const setEx = async team => { await act('ex', { team, remaining: { a: 2, b: 2 } }); await obs.tail; };
  await setEx('a'); await act('undo'); await obs.tail;
  await setEx('a'); await setEx('b');
  await act('display', { scene: 'playing' }); await obs.tail;
  await setEx(null); await setEx('b');
  assert.deepEqual(cuts(studio), [regular, ex, regular, ex, regular, ex]);
  studio.socket.close(); await until(() => obs.phase === 'ready'); await obs.tail;
  assert.equal(studio.log.filter(r => r.type === 'SetSceneItemLocked').length, lockCount);
  assert.equal(current(studio, regular, 'A1').sceneItemLocked, false);
  assert.equal(current(studio, ex, 'A1').sceneItemLocked, true);
  assert.equal(studio.preview, '预览');
  assert.deepEqual(store.snapshot().session.series, { a: 0, b: 0 }); assert.deepEqual(store.state.ex.remaining, { a: 2, b: 2 });
  await act('set-series', { a: 5, b: 5, reason: '已核对' });
  await act('void-round', { reason: '已核对' }); await obs.tail;
  await act('prepare-round', { entryId: 'tb', tiebreaker: true }); await obs.tail;
  assert.equal(obs.snapshot().target, 'regular'); assert.equal(studio.program, regular);
  assert.deepEqual(store.snapshot().session.series, { a: 5, b: 5 });
  studio.cut('休息'); store.emit(); await obs.tail;
  assert.equal(obs.snapshot().program, '休息');
  await obs.command({ action: 'return' }); assert.equal(studio.program, regular);
});

test('reconnect/collection changes re-read Program; keep off-air, coalesce stale layouts, and preserve settings across restarts', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-obs-')); const file = join(dir, 'obs-settings.json');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { obs, studio, store } = await setup(t, { file });
  studio.scenes.set('八路', []); studio.scenes.set('六路', []);
  await ready(obs);
  for (const [layout, name] of [['regular','八路'], ['ex','六路']]) await obs.command({ action: 'bind', layout, name });
  await obs.command({ action: 'follow', enabled: true }); await obs.tail;
  assert.equal(writes(studio).length, 0);
  studio.cut('八路');
  const update = team => { store.state.ex.team = team; store.state.version++; store.emit(); };
  studio.socket.close(); update('a'); update(null);
  await until(() => obs.phase === 'ready'); await obs.tail;
  assert.deepEqual(cuts(studio), []);
  studio.cut('休息'); update('b'); await obs.tail; studio.socket.close();
  await until(() => obs.phase === 'ready'); await obs.tail;
  assert.equal(obs.snapshot().program, '休息'); assert.deepEqual(cuts(studio), []);
  await obs.command({ action: 'return' }); assert.deepEqual(cuts(studio), ['六路']);
  studio.event('CurrentSceneCollectionChanging', {}); studio.collection = '另一集合';
  studio.event('CurrentSceneCollectionChanged', {});
  await until(() => obs.phase === 'ready'); update(null); await obs.tail;
  assert.equal(obs.snapshot().follow, false); assert.equal(studio.program, '六路');
  obs.close(); studio.collection = '比赛集合'; studio.cut('休息');
  const second = (await setup(t, { file, studio, store })).obs;
  await until(() => second.phase === 'ready'); await second.tail;
  assert.equal(second.snapshot().ex, '六路'); assert.equal(second.snapshot().follow, true); assert.equal(studio.program, '休息');
  assert.doesNotMatch(JSON.stringify(second.snapshot()), /test-only-password/);
  assert.doesNotMatch(JSON.stringify(store.snapshot()), /test-only-password/);
  assert.equal(JSON.parse(await readFile(file)).password, connect.password);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  studio.scenes.delete('六路'); studio.event('SceneListChanged', await studio.request('GetSceneList'));
  await assert.rejects(second.command({ action: 'return' }), /找不到 EX/);
  await second.command({ action: 'disconnect' }); const before = studio.connections;
  update('a'); await delay(30); assert.equal(studio.connections, before);
});

test('an intervening manual break or a layout reversal cancels an automatic cut already awaiting Program', async t => {
  const { obs, studio, store } = await setup(t); await ready(obs); await obs.command({ action: 'create' });
  await obs.command({ action: 'return' });
  let resume, started;
  const read = new Promise(resolve => { started = resolve; });
  studio.before = async type => {
    if (type !== 'GetCurrentProgramScene') return;
    delete studio.before;
    await new Promise(resolve => { resume = resolve; started(); });
  };
  store.state.ex.team = 'a'; store.state.version++; store.emit();
  await read; studio.cut('休息'); resume(); await obs.tail;
  assert.deepEqual(cuts(studio), [regular]);
  studio.cut(regular);
  store.state.ex.team = null; store.state.version++; store.emit();
  store.state.ex.team = 'a'; store.state.version++; store.emit();
  store.state.ex.team = null; store.state.version++; store.emit();
  await obs.tail; assert.deepEqual(cuts(studio), [regular]);
  studio.failNext = 'SetCurrentProgramScene'; store.state.ex.team = 'b'; store.state.version++; store.emit();
  await obs.tail; assert.match(obs.snapshot().error, /手动切换/); assert.equal(obs.snapshot().program, regular);
  await obs.command({ action: 'return' }); assert.equal(obs.snapshot().program, ex);
});

test('modern OBS scene identities protect a manually replaced same-name scene until explicitly rebound', async t => {
  const { obs, studio } = await setup(t);
  studio.useUuids = true;
  await ready(obs); await obs.command({ action: 'create' }); await obs.command({ action: 'return' });
  assert.equal(studio.program, regular);
  const cut = studio.log.findLast(r => r.type === 'SetCurrentProgramScene');
  assert.equal(cut.sceneUuid, studio.sceneIds.get(regular));
  studio.cut('休息');
  studio.sceneIds.set(regular, crypto.randomUUID());
  studio.event('SceneListChanged', await studio.request('GetSceneList'));
  assert.equal(obs.snapshot().managed, false);
  await assert.rejects(obs.command({ action: 'return' }), /找不到常规/);
  await assert.rejects(obs.command({ action: 'create' }), /其他场景占用/);
  await obs.command({ action: 'bind', layout: 'regular', name: regular });
  assert.equal(obs.snapshot().managed, false);
  await obs.command({ action: 'return' }); assert.equal(studio.program, regular);
});

test('OBS controls accept same-origin JSON only and never return the configured password', async t => {
  const { obs, store, studio } = await setup(t);
  const config = { port: 0, obs };
  const server = createOverlayServer(config, undefined, undefined, store);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); config.port = server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + config.port, url = origin + '/api/obs';
  const options = { method: 'POST', body: JSON.stringify(connect), headers: { 'Content-Type': 'application/json' } };
  assert.equal((await fetch(url, options)).status, 403);
  assert.equal((await fetch(url, { ...options, headers: { ...options.headers, Origin: 'https://example.org' } })).status, 403);
  const response = await fetch(url, { ...options, headers: { ...options.headers, Origin: origin } });
  assert.equal(response.status, 200); assert.doesNotMatch(await response.text(), /test-only-password/);
  await until(() => obs.phase === 'ready');
  const status = await fetch(url);
  assert.doesNotMatch(await status.text(), /test-only-password|data:image/);
  assert.ok(!studio.log.some(request => request.type === 'GetSourceScreenshot'));
  const screenshot = await fetch(url + '/program');
  assert.equal(screenshot.headers.get('cache-control'), 'no-store');
  assert.match((await screenshot.json()).image, /^data:image\/jpeg;/);
  assert.equal((await fetch(url + '/program', { ...options, headers: { ...options.headers, Origin: origin } })).status, 405);
  assert.equal((await fetch(url + '/program?source=预览')).status, 400);
  assert.equal((await fetch(url + '/program', { headers: { Origin: 'https://example.org' } })).status, 403);
  assert.equal((await (await fetch(url + '/recording')).json()).matchId, store.state.id);
});

test('OBS reconnect and collection switches synchronize old ports without changing Program or scene layout', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-obs-port-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'obs-settings.json');
  const studio = new Studio();
  const store = new SessionStore();
  const add = url => studio.inputs.set('manual', { inputName: 'manual', inputKind: 'browser_source', inputSettings: { url, width: 1920 } });
  add('http://localhost:3001/overlay?custom=1');
  let obs = await new ObsController({ file, overlayUrl: () => 'http://127.0.0.1:3011/overlay', Socket: studio.Socket, retryMs: 10 }).start(store);
  t.after(() => { obs.close(); store.close(); });
  await ready(obs);
  assert.equal(studio.inputs.get('manual').inputSettings.url, 'http://localhost:3011/overlay?custom=1');
  obs.close();
  obs = await new ObsController({ file, overlayUrl: () => 'http://127.0.0.1:3022/overlay', Socket: studio.Socket, retryMs: 10 }).start(store);
  await until(() => obs.phase === 'ready');
  assert.equal(studio.inputs.get('manual').inputSettings.url, 'http://localhost:3022/overlay?custom=1');
  studio.event('CurrentSceneCollectionChanging', {});
  studio.collection = 'another';
  add('http://127.0.0.1:3011/showcase?clean=1');
  studio.event('CurrentSceneCollectionChanged', {});
  await until(() => obs.phase === 'ready');
  assert.equal(studio.inputs.get('manual').inputSettings.url, 'http://127.0.0.1:3022/showcase?clean=1');
  assert.equal(studio.program, '休息');
  assert.ok(writes(studio).every(x => x.type === 'SetInputSettings'));
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).overlayPorts, ['3011', '3022']);
});

test('Program screenshot names its scene and drops old captures after returning or disconnecting', async t => {
  const { obs, studio } = await setup(t);
  studio.scenes.set('比赛', []);
  studio.scenes.set('EX', []);
  studio.preview = '比赛';
  studio.stream.outputActive = true;
  await ready(obs);
  await obs.command({ action: 'bind', layout: 'regular', name: '比赛' });
  await obs.command({ action: 'bind', layout: 'ex', name: 'EX' });

  const frame = await obs.programFrame();
  const decode = frame => Buffer.from(frame.image.split(',')[1], 'base64').toString();
  assert.equal(frame.program, '休息');
  assert.equal(decode(frame), frame.program);
  studio.preview = 'EX';
  studio.event('CurrentPreviewSceneChanged', { sceneName: 'EX' });
  assert.equal((await obs.programFrame()).program, '休息');
  assert.equal(obs.snapshot().stream, 'active');
  assert.equal(obs.snapshot().record, 'off');
  assert.equal(obs.snapshot().image, undefined);
  studio.event('StreamStateChanged', { outputState: 'OBS_WEBSOCKET_OUTPUT_RECONNECTING' });
  assert.equal(obs.snapshot().stream, 'reconnecting');

  for (const action of ['return', 'disconnect']) {
    let release;
    studio.before = type => {
      if (type === 'GetSourceScreenshot') return new Promise(resolve => { release = resolve; });
    };
    const stale = obs.programFrame();
    await obs.command({ action });
    release();
    assert.equal(await stale, null);
    delete studio.before;
    if (action === 'return') {
      const current = await obs.programFrame();
      assert.equal(current.program, '比赛');
      assert.equal(decode(current), current.program);
      assert.ok(current.programRevision > frame.programRevision);
      assert.equal(studio.preview, 'EX');
      studio.failNext = 'GetSourceScreenshot';
      assert.deepEqual(await obs.programFrame(), { ...current, image: null });
    }
  }
  assert.equal(obs.snapshot().program, null);
  assert.equal(await obs.programFrame(), null);
});

const markers = obs => obs.recording.snapshot().groups.flatMap(group => group.markers.map(m => [m.time, m.label]));
const prepare = act => act('prepare-round', { entryId: 'hd2', pickedBy: 'a' });
const practicePool = [{ id: 'hd2', beatmapId: 102, label: 'HD2', mod: 'HD' }];
const practiceSetup = act => act('setup', { title: '录像测试', stage: 'group', mode: '4v4', source: '4x3', pool: practicePool,
  teams: { a: { name: '左队待设置', roster: [] }, b: { name: '右队待设置', roster: [] } } });
const practiceFrame = (store, ipcState) => store.frame({ beatmap: { id: 102 }, tourney: { ipcState,
  teams: { left: '左队待设置', right: '右队待设置' }, totalScore: { left: 0, right: 0 },
  players: [{ side: 'left', osuId: 1, score: 0 }, { side: 'right', osuId: 2, score: 0 }],
} });

test('recording uses OBS time for actual starts, replay and confirmation with the console closed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-obs-timeline-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'session.json');
  const { obs, store, studio, act } = await setup(t, { store: new SessionStore({ file }) });
  const matchId = store.state.id;
  await practiceSetup(act);
  await act('bp');
  await prepare(act);
  studio.record = { outputActive: true, outputPaused: false, outputDuration: 150000 };
  await ready(obs);
  await practiceFrame(store, 1);
  await act('display', { scene: 'playing' });
  await act('start');
  await obs.recording.tail;
  assert.deepEqual(markers(obs), []);
  studio.record.outputDuration = 198421;
  await practiceFrame(store, 3);
  store.emit();
  await obs.recording.tail;
  assert.deepEqual(markers(obs), [['00:03:18', 'HD2 开打']]);
  studio.record.outputDuration = 342300;
  await obs.command({ action: 'mark-recording', matchId });

  await act('referee-replay', { reason: '裁判要求重赛' });
  await obs.recording.tail;
  assert.equal(markers(obs).length, 2);
  await practiceFrame(store, 1);
  studio.record.outputDuration = 426897;
  await practiceFrame(store, 3);
  const originalRun = store.state.rounds.at(-1).runId;
  store.emit();
  await obs.recording.tail;
  assert.equal(store.state.rounds.at(-1).runId, originalRun);
  assert.deepEqual(markers(obs).at(-1), ['00:07:06', 'HD2 重赛开打']);

  await act('set-series', { a: 6, b: 4, reason: '核对比分' });
  await act('display', { scene: 'victory' });
  await act('winner-soon', { team: 'a' });
  await act('cancel-winner');
  await store.confirmWinnerNow();
  assert.equal(markers(obs).length, 3);

  studio.recording('PAUSED', 2900000);
  assert.equal(obs.snapshot().record, 'paused');
  await assert.rejects(obs.command({ action: 'mark-recording', matchId }), /录像未在进行/);
  await act('winner', { team: 'a' });
  studio.recording('RESUMED', 3020000);
  store.emit();
  await obs.recording.tail;
  assert.equal(markers(obs).length, 3);

  studio.recording('STOPPING');
  studio.recording('STOPPED');
  studio.recording('STARTING', 0);
  studio.recording('STARTED', 3500);
  await obs.command({ action: 'mark-recording', matchId });
  assert.deepEqual(obs.recording.snapshot().groups.map(g => g.title), ['录像 1', '录像 2']);
  assert.equal(obs.recording.snapshot().groups[1].markers[0].time, '00:00:03');

  studio.socket.close();
  await assert.rejects(obs.command({ action: 'mark-recording', matchId }), /录像未在进行/);
  await until(() => obs.phase === 'ready');
  studio.record.outputDuration = 9100;
  await obs.command({ action: 'mark-recording', matchId });
  assert.equal(obs.recording.snapshot().groups[2].title, '录像 3 · 重新接入');
  const beforeRestart = obs.recording.snapshot();
  obs.close();
  const reopened = await SessionStore.open(file);
  const restored = await setup(t, { store: reopened, studio });
  await restored.obs.recording.tail;
  assert.deepEqual(restored.obs.recording.snapshot(), beforeRestart);
  await restored.act('next-match');
  await restored.obs.recording.tail;
  assert.deepEqual(markers(restored.obs), []);
  assert.equal(JSON.parse(await readFile(join(dir, 'recording-timelines', matchId + '.json'))).groups.length, 3);
});

test('a newly observed room start and its later recorded run share a single marker', async t => {
  const { obs, store, studio, act } = await setup(t);
  await practiceSetup(act);
  studio.recording('STARTED', 10000);
  await ready(obs);
  const frame = ipcState => store.frame({ beatmap: { id: 102 }, tourney: { ipcState, teams: { left: '红', right: '蓝' },
    players: [], totalScore: { left: 0, right: 0 } } });
  await frame(3);
  store.emit();
  await store.sourceStatus('disconnected');
  await frame(3);
  await obs.recording.tail;
  assert.deepEqual(markers(obs), []);

  await frame(1);
  await frame(0);
  await frame(3);
  await frame(3);
  await act('bp');
  await prepare(act);
  await act('start');
  await obs.recording.tail;
  assert.deepEqual(markers(obs), [['00:00:10', 'HD2 开打']]);
});

test('Winner markers follow committed manual, deadline and exhibition draw events', async t => {
  const first = await setup(t);
  await ready(first.obs);
  first.studio.recording('STARTED', 3260333);
  await first.act('set-series', { a: 6, b: 4, reason: '核对比分' });
  await first.act('display', { scene: 'victory' });
  await first.act('winner-soon', { team: 'a' });
  await first.act('cancel-winner');
  await first.obs.recording.tail;
  assert.deepEqual(markers(first.obs), []);
  await first.act('winner-soon', { team: 'a' });
  first.store.state.winnerPending.endsAt = Date.now() - 1;
  await first.store.confirmWinnerNow();
  await first.act('winner', { team: 'a' });
  await first.obs.recording.tail;
  assert.deepEqual(markers(first.obs), [['00:54:20', 'Winner · 左队待设置 6–4']]);

  const draw = await setup(t);
  await draw.act('import-streaming', {
    title: '表演赛', stage: 'exhibition', mode: '1v1', source: '4x3', pool: practicePool,
    teams: { a: { name: '红', roster: [] }, b: { name: '蓝', roster: [] } },
    exhibition: { roundName: '表演赛', series: { type: 'fixed_maps', count: 4, allowDraw: true }, tiedMapPolicy: 'count_as_draw', autoResults: false },
  });
  await draw.act('set-series', { a: 2, b: 2, reason: '核对比分' });
  await ready(draw.obs);
  draw.studio.recording('STARTED', 30215);
  await draw.act('display', { scene: 'victory' });
  await draw.act('winner', { team: null });
  await draw.obs.recording.tail;
  assert.deepEqual(markers(draw.obs), [['00:00:30', '全场平局 2–2']]);
});

test('a delayed time read never labels a later recording or prevents continuing the match', async t => {
  const { obs, store, studio, act } = await setup(t);
  await ready(obs);
  await practiceSetup(act);
  await act('bp');
  await prepare(act);
  studio.recording('STARTED', 10000);
  await practiceFrame(store, 1);
  let release;
  studio.before = type => {
    if (type === 'GetRecordStatus') return new Promise(resolve => { release = resolve; });
  };
  await practiceFrame(store, 3);
  studio.recording('STOPPED');
  studio.recording('STARTED', 0);
  delete studio.before;
  release();
  await obs.recording.tail;
  assert.deepEqual(markers(obs), []);
  assert.equal(store.state.rounds.at(-1).status, 'playing');
  studio.failNext = 'GetRecordStatus';
  await assert.rejects(obs.command({ action: 'mark-recording', matchId: store.state.id }), /读不到 OBS 录像时间/);
});

test('a tosu replay earns one start marker, even when saving the timeline fails', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-obs-write-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { obs, store, studio, act } = await setup(t, { store: new SessionStore({ file: join(dir, 'session.json') }) });
  await practiceSetup(act);
  await act('bp');
  await prepare(act);
  await ready(obs);
  studio.recording('STARTED', 4123);
  const frame = ipc => practiceFrame(store, ipc);
  const directory = join(dir, 'recording-timelines');
  await writeFile(directory, '阻止写入');
  await frame(1);
  await frame(3);
  await obs.recording.tail;
  assert.equal(store.state.rounds.at(-1).status, 'playing');
  assert.deepEqual(markers(obs), []);
  assert.match(obs.snapshot().recordingError.message, /未保存/);
  await rm(directory);
  await act('referee-replay', { reason: '裁判要求重赛' });
  studio.record.outputDuration = 9750;
  await frame(1);
  await frame(3);
  await frame(3);
  await obs.recording.tail;
  assert.deepEqual(markers(obs), [['00:00:09', 'HD2 重赛开打']]);
  assert.equal(obs.snapshot().recordingError, null);
});

const applicationAudio = 'OCLR · osu!tourney 音频';
const applicationKind = 'wasapi_process_output_capture';
const gameAudio = studio => studio.inputs.get(applicationAudio);

test('Windows captures Client 0 through one shared application source and retains it when EX hides A1', async t => {
  const { obs, studio } = await setup(t);
  studio.kinds.push(applicationKind); studio.useUuids = true;
  await ready(obs); await obs.command({ action: 'create' });
  const input = gameAudio(studio);
  assert.equal(input.inputKind, applicationKind);
  assert.deepEqual(input.inputSettings, { window: clientWindow(0).itemValue, priority: 1 });
  assert.equal(studio.inputs.has(desktop), false);
  assert.equal(obs.snapshot().audio.bound, true);
  assert.match(obs.snapshot().audio.status, /Client 0/);
  for (const scene of [regular, ex]) {
    const items = studio.scenes.get(scene).filter(item => item.sourceUuid === input.inputUuid);
    assert.equal(items.length, 1); assert.equal(items[0].sceneItemEnabled, true); assert.equal(items[0].sceneItemLocked, true);
  }
  for (const slot of slots) assert.equal(studio.inputs.get(capture(slot)).inputSettings.capture_audio, false);
  await obs.command({ action: 'lineup', position: 'A1', slot: 'A4' });
  assert.equal(current(studio, ex, 'A1').sceneItemEnabled, false);
  assert.equal(studio.scenes.get(ex).find(item => item.sourceName === applicationAudio).sceneItemEnabled, true);
  const before = writes(studio).length;
  await obs.command({ action: 'scan' }); await obs.command({ action: 'create' });
  assert.equal(writes(studio).length, before);
  assert.equal((await obs.command({ action: 'measure' })).measurements.some(item => item.input === applicationAudio), false);
});

test('Windows migrates only its owned desktop items, leaves operator mixer sources intact and disables video audio', async t => {
  const { obs, studio } = await setup(t);
  studio.useUuids = true;
  await ready(obs); await obs.command({ action: 'create' });
  const oldAudio = studio.inputs.get(desktop);
  studio.kinds.push(applicationKind);
  studio.specialInputs.desktop1 = '导播桌面'; studio.specialInputs.mic1 = '解说';
  studio.inputs.get(capture('A1')).inputSettings.capture_audio = true;
  await studio.request('CreateSceneItem', { sceneName: '休息', sourceName: desktop, sceneItemEnabled: true });
  await studio.request('CreateInput', { sceneName: ex, inputName: '导播自选声卡', inputKind: 'wasapi_output_capture',
    inputSettings: { device_id: 'USB interface' }, sceneItemEnabled: true });
  await obs.command({ action: 'scan' });
  assert.equal(gameAudio(studio).inputSettings.window, clientWindow(0).itemValue);
  for (const scene of [regular, ex]) assert.equal(studio.scenes.get(scene).find(item => item.sourceUuid === oldAudio.inputUuid).sceneItemEnabled, false);
  assert.equal(studio.scenes.get('休息')[0].sceneItemEnabled, true);
  assert.equal(studio.scenes.get(ex).find(item => item.sourceName === '导播自选声卡').sceneItemEnabled, true);
  assert.equal(studio.specialInputs.desktop1, '导播桌面'); assert.equal(studio.specialInputs.mic1, '解说');
  assert.equal(studio.inputs.get(capture('A1')).inputSettings.capture_audio, false);
  assert.equal(obs.snapshot().audio.globalDesktop, true);
  const saved = structuredClone(obs.profile.preset.applicationAudio);
  await obs.command({ action: 'window', slot: 'B4', value: '' });
  assert.deepEqual(obs.profile.preset.applicationAudio, saved, 'manual video binding cannot discard audio ownership');
});

test('application audio stays enabled and waits silently for a unique Client 0', async t => {
  const { obs, studio } = await setup(t);
  studio.kinds.push(applicationKind);
  studio.windows = studio.windows.filter(window => window.itemValue !== clientWindow(0).itemValue);
  await ready(obs); await obs.command({ action: 'create' });
  const assertWaiting = () => {
    assert.deepEqual(gameAudio(studio).inputSettings, { window: '', priority: 2 });
    assert.equal(obs.snapshot().audio.bound, false);
    for (const scene of [regular, ex]) {
      assert.equal(studio.scenes.get(scene)[0].sourceName, applicationAudio);
      assert.equal(studio.scenes.get(scene)[0].sceneItemEnabled, true);
    }
  };
  assertWaiting();
  // A preset created by an older version may have disabled the unbound item.
  const oldItem = studio.scenes.get(regular)[0];
  await studio.request('SetSceneItemEnabled', { sceneName: regular, sceneItemId: oldItem.sceneItemId, sceneItemEnabled: false });
  gameAudio(studio).inputSettings.priority = 1;
  const before = studio.log.length;
  await obs.command({ action: 'scan' });
  assertWaiting();
  assert.deepEqual(studio.log.slice(before).filter(r => /^(SetInputSettings|SetSceneItemEnabled)$/.test(r.type))
    .map(r => r.type), ['SetInputSettings', 'SetSceneItemEnabled']);
  const repaired = writes(studio).length;
  await obs.command({ action: 'scan' });
  assert.equal(writes(studio).length, repaired);
  studio.windows.push(clientWindow(0));
  await obs.command({ action: 'scan' });
  assert.deepEqual(gameAudio(studio).inputSettings, { window: clientWindow(0).itemValue, priority: 1 });
  assert.equal(obs.snapshot().audio.bound, true);
  studio.windows.push(clientWindow(0, 'OtherClass'));
  await obs.command({ action: 'scan' }); assertWaiting();
  assert.match(obs.snapshot().audio.status, /重名/);
  studio.windows = [clientWindow(1), { ...clientWindow(0), itemValue: 'Tournament Manager:Window:osu!.exe' }];
  await obs.command({ action: 'scan' }); assertWaiting();
  const padded = { ...clientWindow(0), itemValue: ' Tournament Client 0:NewClass:osu!.exe' };
  studio.windows = [padded, clientWindow(1)];
  await obs.command({ action: 'scan' });
  assert.equal(gameAudio(studio).inputSettings.window, padded.itemValue);
  assert.equal(gameAudio(studio).inputSettings.priority, 1);
});

test('an interrupted application-audio placement retries without duplicates or resetting adjusted geometry', async t => {
  const { obs, studio } = await setup(t);
  studio.kinds.push(applicationKind); studio.useUuids = true;
  studio.before = (type, args) => {
    const audio = studio.scenes.get(regular)?.find(item => item.sourceName === applicationAudio);
    if (type === 'SetSceneItemLocked' && audio?.sceneItemId === args.sceneItemId) studio.failNext = type;
  };
  await ready(obs);
  await assert.rejects(obs.command({ action: 'create' }), /模拟请求失败/);
  const input = gameAudio(studio);
  studio.before = undefined;
  current(studio, ex, 'B2').transform.positionY = 333;
  await obs.command({ action: 'create' });
  assert.equal(gameAudio(studio).inputUuid, input.inputUuid);
  assert.equal(obs.profile.preset.applicationAudio.uuid, input.inputUuid);
  for (const scene of [regular, ex]) assert.equal(studio.scenes.get(scene).filter(item => item.sourceName === applicationAudio).length, 1);
  assert.equal(current(studio, ex, 'B2').transform.positionY, 333);
  const before = writes(studio).length;
  await obs.command({ action: 'create' });
  assert.equal(writes(studio).length, before);
});

test('reconnecting an older preset automatically adds Client 0 audio without a create or scan click', async t => {
  const { obs, studio } = await setup(t);
  await ready(obs); await obs.command({ action: 'create' });
  assert.equal(gameAudio(studio), undefined);
  studio.kinds.push(applicationKind);
  await obs.command({ action: 'disconnect' });
  await ready(obs);
  await until(() => obs.snapshot().audio?.bound);
  assert.equal(gameAudio(studio).inputSettings.window, clientWindow(0).itemValue);
  assert.deepEqual(cuts(studio), []);
});

test('an operator-owned application audio name collision is preserved and new preset audio uses a unique name', async t => {
  const { obs, studio } = await setup(t);
  studio.kinds.push(applicationKind); studio.useUuids = true;
  await studio.request('CreateInput', { sceneName: '休息', inputName: applicationAudio, inputKind: applicationKind,
    inputSettings: { window: 'Other game:Class:other.exe', priority: 2 }, sceneItemEnabled: true });
  const original = structuredClone(gameAudio(studio));
  await ready(obs); await obs.command({ action: 'create' });
  assert.deepEqual(gameAudio(studio), original);
  const own = obs.profile.preset.applicationAudio;
  assert.equal(own.name, applicationAudio + ' (2)');
  assert.equal(studio.inputs.get(own.name).inputSettings.window, clientWindow(0).itemValue);
  assert.deepEqual(studio.scenes.get('休息').map(item => item.sourceName), [applicationAudio]);
});
