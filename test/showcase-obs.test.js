import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ObsController } from '../server/obs/controller.js';
import { showcaseBrowser, showcaseCover, showcaseScene } from '../server/obs/showcase.js';
import { ShowcaseReplay } from '../server/obs/showcase-replay.js';
import { TosuClient } from '../src/tosu.js';

import { presetScenes } from '../server/obs/presets.js';
import { SessionStore } from '../server/session/store.js';
import { Studio } from './obs-fixture.js';

async function setup(t, options = {}) {
  const studio = new Studio();
  studio.useUuids = true;
  const session = new SessionStore();
  const obs = await new ObsController({ overlayUrl: () => 'http://127.0.0.1:3010/overlay', Socket: studio.Socket, scanMs: 20000, ...options }).start(session);
  t.after(() => { obs.close(); session.close(); });
  await obs.command({ action: 'connect', port: 4455, password: 'test-password' });
  for (let n = 0; obs.phase !== 'ready' && n < 100; n++) await delay(5);
  assert.equal(obs.phase, 'ready');
  return { studio, session, obs };
}
const writes = studio => studio.log.filter(call => /^(?:Create|Set)/.test(call.type));

test('standalone Showcase creates only its own 1080p browser source, leaves Program and competition untouched', async t => {
  const { studio, session, obs } = await setup(t);
  const original = structuredClone(session.state);
  await obs.command({ action: 'create-showcase' });
  assert.equal(obs.snapshot().showcase, true);
  assert.equal(studio.program, '休息');
  assert.equal(obs.profile.regular, '');
  assert.equal(obs.profile.ex, '');
  assert.equal(obs.profile.follow, false);
  assert.deepEqual(session.state, original);
  assert.deepEqual([...studio.inputs.keys()], [showcaseBrowser]);
  const input = studio.inputs.get(showcaseBrowser);
  assert.equal(input.inputKind, 'browser_source');
  assert.deepEqual(input.inputSettings, { url: 'http://127.0.0.1:3010/showcase?clean=1', width: 1920, height: 1080, shutdown: false, restart_when_active: false });
  const item = studio.scenes.get(showcaseScene)[0];
  assert.equal(item.sceneItemEnabled, true);
  assert.equal(item.sceneItemLocked, true);
  assert.deepEqual(item.transform, { alignment: 5, positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, boundsType: 'OBS_BOUNDS_NONE' });
  item.transform.positionX = 23;
  item.sceneItemLocked = false;
  const before = writes(studio).length;
  await obs.command({ action: 'create-showcase' });
  assert.equal(writes(studio).length, before);
  assert.equal(item.transform.positionX, 23);
  assert.equal(item.sceneItemLocked, false);
});

test('Showcase shares the existing Stream Chat input without adding captures or enabling EX following', async t => {
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
  assert.equal(studio.inputs.size, 2);
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
  assert.ok(!studio.log.slice(mark).some(call => call.type === 'GetInputPropertiesListPropertyItems' || call.type === 'SetCurrentProgramScene'));
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
  for (const failAt of ['CreateScene', 'CreateInput', 'SetSceneItemLocked']) {
    const { studio, obs } = await setup(t);
    const request = studio.request.bind(studio);
    let failed = false;
    studio.request = async (type, args) => {
      const result = await request(type, args);
      if (!failed && type === failAt) { failed = true; throw new Error('response lost'); }
      return result;
    };
    await assert.rejects(obs.command({ action: 'create-showcase' }));
    await obs.command({ action: 'create-showcase' });
    assert.equal(studio.scenes.get(showcaseScene).length, 1, failAt);
    assert.equal(studio.inputs.size, 1, failAt);
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
  assert.equal(studio.scenes.get(showcaseScene).at(-1), mask());
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
  assert.equal(studio.scenes.get(showcaseScene).at(-1), mask());
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
