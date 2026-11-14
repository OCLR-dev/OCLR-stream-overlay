import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ObsController } from '../server/obs/controller.js';
import { showcaseBrowser, showcaseScene } from '../server/obs/showcase.js';
import { presetScenes } from '../server/obs/presets.js';
import { SessionStore } from '../server/session/store.js';
import { Studio } from './obs-fixture.js';

async function setup(t) {
  const studio = new Studio();
  studio.useUuids = true;
  const session = new SessionStore();
  const obs = await new ObsController({ overlayUrl: () => 'http://127.0.0.1:3010/overlay', Socket: studio.Socket, scanMs: 20000 }).start(session);
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
