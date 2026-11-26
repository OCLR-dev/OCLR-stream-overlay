import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ShowcaseStore } from '../server/showcase.js';
import { ShowcaseReplayList } from '../server/showcase-replay-list.js';
import { replayFixture } from './showcase-replay-fixture.js';
import { setTimeout as delay } from 'node:timers/promises';
import { ObsController } from '../server/obs/controller.js';
import { showcaseArtwork, showcaseBrowser, showcaseCapture, showcaseCover, showcaseScene } from '../server/obs/showcase.js';
import { ordinaryClient, ShowcaseReplay } from '../server/obs/showcase-replay.js';
import { TosuClient } from '../src/tosu.js';

import { presetScenes } from '../server/obs/presets.js';
import { newCustomSession } from '../server/session/model.js';
import { SessionStore } from '../server/session/store.js';
import { Studio } from './obs-fixture.js';

async function setup(t, options = {}) {
  const studio = new Studio();
  studio.useUuids = true;
  const session = new SessionStore(options.sessionTosu ? { state: newCustomSession() } : {});
  const obs = await new ObsController({ overlayUrl: () => 'http://127.0.0.1:3010/overlay', Socket: studio.Socket, scanMs: 20000, ...options }).start(session);
  t.after(() => { obs.close(); session.close(); });
  await obs.command({ action: 'connect', port: 4455, password: 'test-password' });
  for (let n = 0; obs.phase !== 'ready' && n < 100; n++) await delay(5);
  assert.equal(obs.phase, 'ready');
  return { studio, session, obs };
}
const writes = studio => studio.log.filter(call => /^(?:Create|Set)/.test(call.type));

const stableWindow = { itemName: '[osu!.exe]: osu!', itemValue: 'osu!:WindowsForms10.Window:osu!.exe', itemEnabled: true };

test('standalone Showcase creates a full browser and centered Stable capture, leaves Program and competition untouched', async t => {
  const { studio, session, obs } = await setup(t);
  const original = structuredClone(session.state);
  studio.windows.push(stableWindow);
  await obs.command({ action: 'create-showcase' });
  assert.equal(obs.snapshot().showcase, true);
  assert.equal(studio.program, '休息');
  assert.equal(obs.profile.regular, '');
  assert.equal(obs.profile.ex, '');
  assert.equal(obs.profile.follow, false);
  assert.deepEqual(session.state, original);
  assert.deepEqual([...studio.inputs.keys()], [showcaseBrowser, showcaseCapture]);
  const input = studio.inputs.get(showcaseBrowser);
  assert.equal(input.inputKind, 'browser_source');
  assert.deepEqual(input.inputSettings, { url: 'http://127.0.0.1:3010/showcase?clean=1', width: 1920, height: 1080, shutdown: false, restart_when_active: false });
  const item = studio.scenes.get(showcaseScene)[0];
  assert.equal(item.sceneItemEnabled, true);
  assert.equal(item.sceneItemLocked, true);
  assert.deepEqual(item.transform, { alignment: 5, positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, boundsType: 'OBS_BOUNDS_NONE' });
  const capture = studio.scenes.get(showcaseScene)[1];
  const game = studio.inputs.get(showcaseCapture);
  assert.equal(game.inputKind, 'game_capture');
  assert.equal(game.inputSettings.window, stableWindow.itemValue);
  assert.equal(game.inputSettings.priority, 1);
  assert.equal(game.inputSettings.capture_mode, 'window');
  assert.equal(game.inputSettings.capture_audio, false);
  assert.equal(capture.sceneItemEnabled, true);
  assert.deepEqual(capture.transform, { alignment: 5, positionX: 160, positionY: 100, scaleX: 1, scaleY: 1,
    boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsAlignment: 0, boundsWidth: 1600, boundsHeight: 800 });
  assert.equal(obs.snapshot().showcaseCapture, 'bound');
  capture.transform.positionX = 222;
  item.transform.positionX = 23;
  item.sceneItemLocked = false;
  const before = writes(studio).length;
  await obs.command({ action: 'create-showcase' });
  assert.equal(writes(studio).length, before);
  assert.equal(item.transform.positionX, 23);
  assert.equal(capture.transform.positionX, 222);
  assert.equal(item.sceneItemLocked, false);
});

test('Showcase only auto-binds a unique ordinary osu! window and keeps an operator binding', async t => {
  const { studio, obs } = await setup(t);
  studio.kinds = ['browser_source', 'window_capture'];
  const create = () => obs.command({ action: 'create-showcase' });
  await create();
  const game = studio.inputs.get(showcaseCapture);
  assert.equal(game.inputKind, 'window_capture');
  assert.equal(game.inputSettings.window, '');
  assert.equal(obs.snapshot().showcaseCapture, 'missing');

  studio.windows.push(stableWindow, { ...stableWindow, itemValue: 'osu!:DifferentClass:osu!.exe' });
  await create();
  assert.equal(game.inputSettings.window, '');
  assert.equal(obs.snapshot().showcaseCapture, 'ambiguous');
  studio.windows.pop();
  await create();
  assert.equal(game.inputSettings.window, stableWindow.itemValue);
  assert.equal(obs.snapshot().showcaseCapture, 'bound');

  game.inputSettings.window = 'Custom title:WindowsForms10.Window:osu!.exe';
  await create();
  assert.equal(game.inputSettings.window, 'Custom title:WindowsForms10.Window:osu!.exe');
  assert.equal(obs.snapshot().showcaseCapture, 'manual');
});

test('Showcase preserves the existing capture and transition order when adding a managed source to an older scene', async t => {
  const { studio, obs } = await setup(t);
  studio.kinds = ['browser_source', 'color_source_v3'];
  await obs.command({ action: 'create-showcase' });
  assert.equal(obs.snapshot().showcaseCapture, 'unsupported');
  studio.inputs.set('manual capture', { inputName: 'manual capture', inputKind: 'game_capture' });
  studio.addItem(showcaseScene, 'manual capture', true);
  await obs.command({ action: 'setup-showcase-transition' });
  const items = studio.scenes.get(showcaseScene);
  const manual = structuredClone(items.find(item => item.sourceName === 'manual capture'));
  studio.kinds.push('game_capture');
  studio.windows.push(stableWindow);
  await obs.command({ action: 'create-showcase' });
  assert.deepEqual(items.map(item => item.sourceName), [showcaseBrowser, showcaseCapture, 'manual capture', showcaseCover, showcaseArtwork]);
  assert.deepEqual(items[2], manual);
});

test('an idle Tourney manager cannot match the normal-client replay feed', () => {
  const frame = { state: { number: 22, name: 'tourney' }, beatmap: { id: 371 }, tourney: { teams: {}, players: [] } };
  assert.equal(ordinaryClient(frame, '371'), false);
  assert.equal(ordinaryClient({ ...frame, state: { number: 2, name: 'play' } }, '371'), true);
});

test('Showcase shares the existing Stream Chat input and leaves EX following disabled', async t => {
  const { studio, obs } = await setup(t);
  await obs.command({ action: 'stream-chat', code: '0123456789AB' });
  assert.equal(obs.snapshot().streamChat, 'pending');
  await obs.command({ action: 'create-showcase' });
  const chat = studio.scenes.get(showcaseScene).find(item => item.sourceName === 'OCLR · 直播间弹幕');
  assert.ok(chat);
  assert.equal(chat.sceneItemEnabled, true);
  assert.equal(chat.transform.positionX, 1481);
  assert.equal(chat.transform.positionY, 950);
  assert.equal(obs.snapshot().streamChat, 'configured');
  assert.equal(studio.inputs.size, 3);
  await obs.command({ action: 'create' });
  await obs.tail;
  for (const name of Object.values(presetScenes)) {
    assert.equal(studio.scenes.get(name).find(item => item.sourceName === chat.sourceName).sourceUuid, chat.sourceUuid);
  }
  studio.cut(showcaseScene);
  obs.target = 'ex';
  await obs.sync(obs.caller(obs.epoch), false);
  assert.equal(studio.program, showcaseScene);
});

test('existing competition preset and operator capture transforms survive Showcase creation', async t => {
  const { studio, obs } = await setup(t);
  await obs.command({ action: 'create' });
  await obs.tail;
  const regular = structuredClone(studio.scenes.get(presetScenes.regular));
  const ex = structuredClone(studio.scenes.get(presetScenes.ex));
  const profile = structuredClone(obs.profile);
  const mark = studio.log.length;
  await obs.command({ action: 'create-showcase' });
  assert.deepEqual(studio.scenes.get(presetScenes.regular), regular);
  assert.deepEqual(studio.scenes.get(presetScenes.ex), ex);
  assert.deepEqual(obs.profile.preset, profile.preset);
  assert.equal(obs.profile.follow, profile.follow);
  assert.ok(!studio.log.slice(mark).some(call => (call.type === 'GetInputPropertiesListPropertyItems' && call.inputName !== showcaseCapture) || call.type === 'SetCurrentProgramScene'));
});

test('Showcase rejects occupied names and replacement scene IDs before changing OBS', async t => {
  const { studio, obs } = await setup(t);
  studio.scenes.set(showcaseScene, []);
  const before = writes(studio).length;
  await assert.rejects(obs.command({ action: 'create-showcase' }), /同名/);
  assert.equal(writes(studio).length, before);
  studio.scenes.delete(showcaseScene);
  await obs.command({ action: 'create-showcase' });
  studio.sceneIds.set(showcaseScene, crypto.randomUUID());
  const count = writes(studio).length;
  await assert.rejects(obs.command({ action: 'create-showcase' }), /同名/);
  assert.equal(writes(studio).length, count);
});

test('interrupted Showcase creation retries without duplicate inputs or scene items', async t => {
  for (const failAt of ['CreateScene', 'CreateInput', showcaseCapture, 'SetSceneItemLocked']) {
    const { studio, obs } = await setup(t);
    const request = studio.request.bind(studio);
    let failed = false;
    studio.request = async (type, args) => {
      const result = await request(type, args);
      if (!failed && (failAt === showcaseCapture ? type === 'CreateInput' && args.inputName === showcaseCapture : type === failAt)) {
        failed = true; throw new Error('response lost');
      }
      return result;
    };
    await assert.rejects(obs.command({ action: 'create-showcase' }));
    await obs.command({ action: 'create-showcase' });
    assert.equal(studio.scenes.get(showcaseScene).length, 2, failAt);
    assert.equal(studio.inputs.size, 2, failAt);
    assert.equal(studio.scenes.get(showcaseScene)[0].sceneItemEnabled, true, failAt);
    assert.equal(obs.snapshot().showcase, true);
  }
});

test('Showcase checks the OBS canvas before creation and leaves settings usable after failure', async t => {
  const { studio, obs } = await setup(t);
  studio.canvas.baseWidth = 1280;
  await assert.rejects(obs.command({ action: 'create-showcase' }), /1920/);
  assert.deepEqual(writes(studio), []);
  studio.canvas.baseWidth = 1920;
  await obs.command({ action: 'create-showcase' });
  assert.equal(obs.snapshot().showcase, true);
});

class ReplayFeed {
  constructor({ url, onFrame, onStatus, normalize }) { Object.assign(this, { url, onFrame, onStatus, normalize }); }
  start() { this.active = true; }
  stop() { this.active = false; }
  setUrl(url) { this.url = url; }
  status(status) { if (this.active) this.onStatus(status); }
  frame(status, mapid, time, rawStatus = status === 32 ? 7 : 2) {
    if (this.active) this.onFrame(this.normalize({ osuIsRunning: 1, status, rawStatus, mapid, time }));
  }
}

async function setupReplay(t, resultsMs = 3500) {
  const { studio, obs, session } = await setup(t, { ReplayClient: ReplayFeed, tosuUrl: 'ws://127.0.0.1:24050/websocket/v2', resultsMs });
  studio.kinds.push('color_source_v3');
  await obs.command({ action: 'create-showcase' });
  const outside = studio.scenes.get('休息');
  studio.inputs.set('game', { inputName: 'game', inputKind: 'game_capture' });
  studio.addItem(showcaseScene, 'game', true);
  await obs.command({ action: 'setup-showcase-transition' });
  const mask = () => studio.scenes.get(showcaseScene).find(item => item.sourceName === showcaseCover);
  const v2 = (number, id = 101, extra = {}) => {
    session.live.tosu = { status: 'live', updatedAt: new Date().toISOString(), data: { state: { number }, beatmap: { id }, ...extra } };
    session.emit();
  };
  const watch = async (id = 101) => {
    v2(2, id);
    obs.replayClient.frame(8, id, 0);
    obs.replayClient.frame(8, id, 0.2);
    await obs.tail;
  };
  return { studio, obs, mask, v2, watch, session, outside, feed: obs.replayClient };
}

test('Showcase uses an opaque OBS layer above the game and validates actual coverage before confirming', async t => {
  const { studio, obs, mask, v2, watch, session, outside, feed } = await setupReplay(t);
  const original = structuredClone(session.state);
  assert.equal(feed.url, 'ws://127.0.0.1:24050/tokens');
  assert.equal(feed.active, false);
  assert.equal(studio.program, '休息');
  assert.equal(studio.scenes.get(showcaseScene).at(-1).sourceName, showcaseArtwork);
  assert.equal(studio.scenes.get(showcaseScene).at(-2), mask());
  assert.deepEqual(studio.inputs.get(showcaseArtwork).inputSettings, {
    url: 'http://127.0.0.1:3010/showcase?clean=1&layer=cover', width: 1920, height: 1080, shutdown: false, restart_when_active: false,
  });
  assert.equal(obs.snapshot().showcaseTransition.artwork, true);
  assert.equal(mask().sceneItemEnabled, true);
  assert.equal(mask().sceneItemLocked, true);
  assert.deepEqual(studio.inputs.get(showcaseCover).inputSettings, { width: 1600, height: 800, color: 0xff281633 });
  assert.equal(mask().transform.positionX, 160);
  assert.equal(mask().transform.positionY, 100);

  studio.cut(showcaseScene);
  await obs.tail;
  assert.equal(feed.active, true);
  assert.equal(obs.snapshot().showcaseTransition.covered, true);
  v2(2);
  feed.frame(2, 101, 10);
  feed.frame(2, 101, 11);
  feed.frame(8, 101, 11);
  feed.frame(8, 101, 11);
  await obs.tail;
  assert.equal(mask().sceneItemEnabled, true, 'hands-on play and a frozen clock cannot reveal the capture');
  await watch(202);
  assert.equal(mask().sceneItemEnabled, false);
  assert.equal(obs.snapshot().showcaseTransition.phase, 'playing');
  studio.addItem(showcaseScene, 'game', true);
  await obs.command({ action: 'cover-showcase' });
  assert.equal(studio.scenes.get(showcaseScene).at(-1).sourceName, showcaseArtwork);
  assert.equal(studio.scenes.get(showcaseScene).at(-2), mask());
  assert.equal(mask().sceneItemEnabled, true);
  feed.frame(8, 202, 0.5);
  feed.frame(8, 202, 1);
  await obs.tail;
  assert.equal(mask().sceneItemEnabled, true, 'manual cover holds over an ongoing run');
  assert.deepEqual(session.state, original);
  assert.deepEqual(outside, []);
  assert.ok(!studio.log.some(call => call.type === 'SetCurrentProgramScene'));
});

test('confirmed results get one timer; stale results, a changed score, and same-map replay never reuse permission', async t => {
  assert.equal(new ShowcaseReplay(() => {}).resultsMs, 3500);
  const { studio, obs, mask, v2, watch, feed } = await setupReplay(t, 60);
  studio.cut(showcaseScene);
  await obs.tail;
  v2(7);
  feed.frame(32, 101, 120);
  assert.equal(obs.snapshot().showcaseTransition.phase, 'covered');
  await watch();
  assert.equal(mask().sceneItemEnabled, false);
  v2(7, 101, { resultIdentity: 'one' });
  feed.frame(32, 101, 120);
  assert.equal(obs.snapshot().showcaseTransition.phase, 'results');
  assert.equal(mask().sceneItemEnabled, false);
  const timer = obs.replay.timer;
  feed.frame(32, 101, 120.25);
  feed.frame(32, 101, 120.5);
  assert.equal(obs.replay.timer, timer);
  await delay(70);
  await obs.tail;
  assert.equal(mask().sceneItemEnabled, true);
  feed.frame(32, 101, 120);
  assert.equal(obs.snapshot().showcaseTransition.phase, 'covered');
  await watch();
  assert.equal(mask().sceneItemEnabled, false, 'same map can begin a new run');

  v2(7, 101, { resultIdentity: 'two' });
  feed.frame(32, 101, 120);
  v2(7, 101, { resultIdentity: 'next replay score' });
  await obs.tail;
  assert.equal(mask().sceneItemEnabled, true);
  await watch();
  v2(7);
  feed.frame(32, 101, 120);
  assert.equal(mask().sceneItemEnabled, false);
  v2(2);
  feed.frame(8, 101, 0);
  await obs.tail;
  assert.equal(mask().sceneItemEnabled, true, 'early start covers before allowing a new reveal');
  feed.frame(8, 101, 0.3);
  await obs.tail;
  assert.equal(mask().sceneItemEnabled, false);
  await delay(70);
  await obs.tail;
  assert.equal(mask().sceneItemEnabled, false, 'old timer did not interrupt the next run');
});

test('disconnect, cancellation, an external scene cut, and explicit recovery cannot expose an old score', async t => {
  const { studio, obs, mask, v2, watch, feed } = await setupReplay(t, 60);
  studio.cut(showcaseScene);
  await obs.tail;
  await watch();
  v2(7);
  feed.frame(32, 101, 120);
  feed.status('disconnected');
  await obs.tail;
  assert.equal(mask().sceneItemEnabled, true);
  feed.frame(32, 101, 120);
  await obs.tail;
  assert.equal(mask().sceneItemEnabled, true);
  v2(0);
  feed.frame(1, 101, 0, 0);
  await obs.command({ action: 'reveal-showcase' });
  assert.equal(mask().sceneItemEnabled, false);
  feed.status('disconnected');
  assert.equal(obs.snapshot().showcaseTransition.phase, 'manual');
  await obs.command({ action: 'cover-showcase' });
  assert.equal(mask().sceneItemEnabled, true);
  await watch();
  v2(7);
  feed.frame(32, 101, 120);
  studio.cut('休息');
  await obs.tail;
  assert.equal(feed.active, false);
  assert.equal(mask().sceneItemEnabled, true, 'prepares the mask while Showcase is off air');
  await delay(70);
  await obs.tail;
  assert.equal(studio.program, '休息');
  await assert.rejects(obs.command({ action: 'reveal-showcase' }), /切到 OBS 播出/);
  studio.cut(showcaseScene);
  await obs.tail;
  v2(7);
  feed.frame(32, 101, 120);
  await obs.tail;
  assert.equal(mask().sceneItemEnabled, true);
  assert.equal(obs.snapshot().showcaseTransition.phase, 'covered');
});

test('an in-flight reveal is discarded after a cut, and altered mask geometry is not confirmed', async t => {
  const { studio, obs, mask, v2, feed } = await setupReplay(t);
  studio.cut(showcaseScene);
  await obs.tail;
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  studio.before = async type => {
    if (type === 'GetSceneItemList') { entered.resolve(); await release.promise; }
  };
  v2(2);
  feed.frame(8, 101, 0);
  feed.frame(8, 101, 0.3);
  await entered.promise;
  studio.cut('休息');
  release.resolve();
  await obs.tail;
  assert.equal(mask().sceneItemEnabled, true);
  assert.ok(!studio.log.some(call => call.type === 'SetSceneItemEnabled' && call.sceneItemId === mask().sceneItemId && !call.sceneItemEnabled));
  studio.before = null;
  mask().transform.positionX = 50;
  studio.cut(showcaseScene);
  await obs.tail;
  await delay(0);
  assert.equal(obs.snapshot().showcaseTransition.covered, null);
  assert.match(obs.snapshot().showcaseTransition.error, /未确认/);
  await obs.command({ action: 'setup-showcase-transition' });
  assert.equal(mask().transform.positionX, 160);
  assert.equal(mask().sceneItemEnabled, true);
});

test('the replay feed opens /tokens only on Program and drops frames from a replaced tosu connection', async t => {
  const sockets = [];
  class Wire {
    constructor(url) { this.url = url; sockets.push(this); }
    sendFrame(status, time) {
      this.onmessage?.({ data: JSON.stringify({ osuIsRunning: 1, status, rawStatus: 2, mapid: 101, time }) });
    }
    close() { this.closed = true; }
  }
  const { studio, obs, session } = await setup(t, {
    ReplayClient: class extends TosuClient { constructor(options) { super({ ...options, WebSocketImpl: Wire }); } },
    tosuUrl: 'ws://127.0.0.1:24050/websocket/v2',
  });
  studio.kinds.push('color_source_v3');
  await obs.command({ action: 'create-showcase' });
  await obs.command({ action: 'setup-showcase-transition' });
  assert.equal(sockets.length, 0);
  studio.cut(showcaseScene);
  await obs.tail;
  const first = sockets[0];
  assert.equal(first.url, 'ws://127.0.0.1:24050/tokens');
  session.live.tosu = { status: 'live', updatedAt: new Date().toISOString(), data: { state: { number: 2 }, beatmap: { id: 101 } } };
  session.emit();
  first.sendFrame(8, 1);
  first.sendFrame(8, 1.2);
  await obs.tail;
  assert.equal(obs.snapshot().showcaseTransition.covered, false);
  const stale = first.onmessage;
  obs.setTosuUrl('ws://127.0.0.1:24051/websocket/v2');
  stale({ data: JSON.stringify({ osuIsRunning: 1, status: 8, rawStatus: 2, mapid: 101, time: 2 }) });
  await obs.tail;
  assert.equal(obs.snapshot().showcaseTransition.covered, true);
  assert.equal(first.closed, true);
  assert.equal(sockets[1].url, 'ws://127.0.0.1:24051/tokens');
  studio.cut('休息');
  await obs.tail;
  assert.equal(sockets[1].closed, true);
});

test('legacy masks upgrade to full-frame artwork without duplicate sources or changed captures', async t => {
  const { studio, obs, mask } = await setupReplay(t);
  const art = studio.scenes.get(showcaseScene).find(item => item.sourceName === showcaseArtwork);
  studio.scenes.get(showcaseScene).splice(studio.scenes.get(showcaseScene).indexOf(art), 1);
  studio.inputs.delete(showcaseArtwork);
  delete obs.profile.showcase.transition.artwork;
  const capture = structuredClone(studio.scenes.get(showcaseScene).find(item => item.sourceName === 'game'));
  const maskId = mask().sceneItemId;
  assert.equal(obs.snapshot().showcaseTransition.artwork, false);
  await obs.command({ action: 'setup-showcase-transition' });
  await obs.command({ action: 'setup-showcase-transition' });
  assert.equal(mask().sceneItemId, maskId);
  assert.equal(studio.scenes.get(showcaseScene).filter(item => item.sourceName === showcaseArtwork).length, 1);
  assert.deepEqual(studio.scenes.get(showcaseScene).find(item => item.sourceName === 'game'), capture);
  assert.equal(studio.program, '休息');
});

test('artwork interrupted after creation retries, and wrong artwork geometry cannot reveal the fallback', async t => {
  const { studio, obs } = await setup(t);
  studio.kinds.push('color_source_v3');
  await obs.command({ action: 'create-showcase' });
  const request = studio.request.bind(studio);
  let fail = true;
  studio.request = async (type, args) => {
    const result = await request(type, args);
    if (fail && type === 'CreateInput' && args.inputName === showcaseArtwork) { fail = false; throw new Error('lost response'); }
    return result;
  };
  await assert.rejects(obs.command({ action: 'setup-showcase-transition' }));
  await obs.command({ action: 'setup-showcase-transition' });
  assert.equal(studio.scenes.get(showcaseScene).filter(item => item.sourceName === showcaseArtwork).length, 1);
  studio.cut(showcaseScene);
  await obs.tail;
  const art = studio.scenes.get(showcaseScene).at(-1);
  art.transform.scaleX = .5;
  await assert.rejects(obs.command({ action: 'reveal-showcase' }), /未确认/);
  assert.equal(studio.scenes.get(showcaseScene).find(item => item.sourceName === showcaseCover).sceneItemEnabled, true);
  await obs.command({ action: 'setup-showcase-transition' });
  assert.equal(art.transform.scaleX, 1);
});

test('only the results timeout animates entry; early changes cover instantly', async t => {
  const { studio, obs, v2, watch, feed } = await setupReplay(t, 25);
  studio.cut(showcaseScene);
  await obs.tail;
  await watch();
  v2(7);
  feed.frame(32, 101, 120);
  assert.equal(obs.coverSnapshot().completed.map, '101');
  await delay(40);
  await obs.tail;
  assert.equal(obs.coverSnapshot().instant, false);
  await watch(202);
  v2(0, 202);
  await obs.tail;
  assert.equal(obs.coverSnapshot().covered, true);
  assert.equal(obs.coverSnapshot().instant, true);
  assert.equal(obs.coverSnapshot().completed.serial, 1, 'cancellation does not invent a completed map');
});

test('replay list rechecks Program after download, opens once under the actual cover, retries and counts same-map completion once', async t => {
  const { studio, obs, session, mask, v2, feed } = await setupReplay(t, 30);
  const store = new ShowcaseStore(session, { obs: () => obs });
  await store.command({ type: 'pool-text', text: 'NM1 101\nHD1 202', poolToken: store.currentPoolToken() });
  const source = { edition: 's11', pool: { id: 'pool', version: 7 },
    entriesById: [{ slot: 'NM1', entryId: 'a' }, { slot: 'HD1', entryId: 'b' }], covers: [] };
  store.state.website = source;
  const entered = Promise.withResolvers();
  const download = Promise.withResolvers();
  const option = { id: 'r1', filename: 'HD1.osr', playerName: 'Example', mods: 8 };
  let failOpen = false;
  let delayFile = true;
  let fileStatus = 200;
  let launches = 0;
  const list = new ShowcaseReplayList(store, {
    showcaseConnection: () => ({ connection: 'connected' }),
    async readShowcase(input) {
      assert.equal(input.version, 7);
      assert.equal(input.connection, 'connected');
      if (input.replays) return { isCurrent: () => true, data: new Map([
        ['a', { slot: 'NM1', replays: [] }], ['b', { slot: 'HD1', replays: [option] }],
      ]) };
      assert.equal(input.replayId, option.id);
      if (fileStatus !== 200) throw Object.assign(new Error('stale'), { status: fileStatus });
      entered.resolve();
      if (delayFile) await download.promise;
      return { isCurrent: () => true, data: replayFixture() };
    },
  }, async path => {
    assert.deepEqual(await readFile(path), replayFixture());
    return async () => {
      assert.equal(studio.program, showcaseScene);
      assert.equal(mask().sceneItemEnabled, true);
      launches++;
      if (failOpen) throw new Error('打开失败');
    };
  });
  t.after(() => list.close());
  const command = (action, fields = {}, bytes) => list.command({ action, poolToken: store.currentPoolToken(), ...fields }, bytes);
  const play = (action = 'play') => {
    const { generation, nextSlot, playback, rows } = list.snapshot();
    const slotId = action === 'repeat' ? playback.slotId : nextSlot;
    return command(action, { generation, slotId, replayId: rows.find(row => row.slotId === slotId)?.selectedId });
  };
  await command('refresh');
  studio.cut(showcaseScene);
  await obs.tail;
  await assert.rejects(play(), /NM1 尚未上传/);
  await command('attach', { slotId: 'NM1', filename: 'NM1.osr' }, replayFixture());
  await command('next', { slotId: 'HD1' });
  const underway = play();
  await entered.promise;
  await assert.rejects(play(), /正在处理/);
  studio.cut('休息');
  download.resolve();
  assert.match((await underway).playback.message, /节目场景已变化/);
  assert.equal(launches, 0);
  assert.equal(obs.coverSnapshot().covered, true, 'the rendering cover fallback alone cannot start a file');
  delayFile = false;
  studio.cut(showcaseScene);
  await obs.tail;
  failOpen = true;
  assert.equal((await play()).playback.phase, 'failed');
  assert.equal(mask().sceneItemEnabled, true);
  failOpen = false;

  assert.equal((await play()).playback.phase, 'waiting');
  v2(2, 101);
  feed.frame(8, 101, 0);
  feed.frame(8, 101, 0.2);
  assert.match(list.snapshot().playback.message, /其他谱面/);
  await obs.tail;
  assert.equal(mask().sceneItemEnabled, true);
  assert.deepEqual(store.snapshot().transition.shown, []);

  for (const action of ['play', 'repeat']) {
    assert.equal((await play(action)).playback.phase, 'waiting');
    v2(7, 202);
    feed.frame(32, 202, 60);
    assert.equal(list.snapshot().playback.phase, 'waiting', 'prior results cannot complete a launched replay');
    assert.equal(mask().sceneItemEnabled, true);
    v2(2, 202);
    feed.frame(8, 202, 0);
    feed.frame(8, 202, 0);
    assert.equal(list.snapshot().playback.phase, 'waiting', 'frozen replay clock cannot reveal');
    feed.frame(8, 202, 0.2);
    await obs.tail;
    assert.equal(mask().sceneItemEnabled, false);
    assert.deepEqual(store.snapshot().transition.shown, action === 'play' ? [] : ['HD1']);
    v2(7, 202);
    feed.frame(32, 202, 60);
    assert.equal(list.snapshot().playback.phase, 'completed');
    assert.equal(list.snapshot().nextSlot, null);
    assert.deepEqual(store.snapshot().transition.shown, ['HD1']);
    await delay(45);
    await obs.tail;
  }
  await assert.rejects(play(), /已到清单末尾/);
  assert.equal(launches, 4);
  fileStatus = 404;
  const stale = await play('repeat');
  assert.equal(stale.status, 'stale');
  assert.equal(stale.rows[1].selectedId, null);
  assert.equal(stale.rows[0].options[0].local, true);
  assert.equal(launches, 4);
});

test('Showcase updates its ordinary client token endpoint when the game source changes', async t => {
  const { obs } = await setup(t, { ReplayClient: ReplayFeed });
  obs.setTosuUrl('ws://127.0.0.1:4010/websocket/v2');
  assert.equal(obs.replayClient.url, 'ws://127.0.0.1:4010/tokens');
  obs.setTosuUrl('ws://127.0.0.1:4011/websocket/v2');
  assert.equal(obs.replayClient.url, 'ws://127.0.0.1:4011/tokens');
  obs.setTosuUrl('');
  assert.equal(obs.replayClient.url, null);
});
