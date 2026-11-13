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
  assert.deepEqual(wire.sent[0], { op: 1, d: { rpcVersion: 1, eventSubscriptions: 6, authentication: '1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=' } });
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
  const unavailable = createServer();
  unavailable.on('upgrade', (_req, socket) => {
    attempts++;
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
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
  const { obs, store } = await setup(t);
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
  assert.doesNotMatch(await (await fetch(url)).text(), /test-only-password/);
});
