import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ObsController } from '../server/obs/controller.js';
import { SessionStore } from '../server/session/store.js';
import { Studio } from './obs-fixture.js';

const source = 'OCLR · 直播间弹幕';
const connect = { action: 'connect', port: 4455, password: 'test-only' };

test('OBS reconnect migrates original chat CSS once and preserves custom CSS and scene adjustments', async t => {
  const studio = new Studio();
  const store = new SessionStore();
  const obs = new ObsController({ overlayUrl: () => 'http://127.0.0.1:3010/overlay', Socket: studio.Socket, scanMs: 20000 });
  t.after(() => { obs.close(); store.close(); });
  await obs.start(store);
  const reconnect = async () => {
    await obs.command({ action: 'disconnect' });
    await obs.command(connect);
    for (let i = 0; i < 150 && obs.phase !== 'ready'; i++) await delay(5);
    assert.equal(obs.phase, 'ready');
    await obs.tail;
  };
  await reconnect();
  await obs.command({ action: 'create' });
  await obs.command({ action: 'stream-chat', code: 'TESTONLY000001' });
  const input = studio.inputs.get(source);
  const css = input.inputSettings.css;
  const legacyCss = css.slice(0, css.indexOf('\nyt-live-chat-renderer { --scrollbar-width:'));
  assert.ok(legacyCss.length > 0 && legacyCss !== css);
  input.inputSettings.css = legacyCss;
  const items = [...studio.scenes.values()].flat().filter(item => item.sourceName === source);
  for (const item of items) { item.sceneItemLocked = false; item.transform.positionX += 7; }
  const adjusted = structuredClone(items);
  studio.log.length = 0;
  await reconnect();
  assert.equal(input.inputSettings.css, css);
  assert.deepEqual(items, adjusted);
  const writes = () => studio.log.filter(call => /^(Set|Create)/.test(call.type));
  assert.deepEqual(writes().map(call => call.type), ['SetInputSettings']);
  assert.deepEqual(Object.keys(writes()[0].inputSettings), ['css']);
  await reconnect();
  assert.equal(writes().length, 1);
  input.inputSettings.css = css.slice(0, css.indexOf('\nyt-live-chat-text-message-renderer { background:'));
  await reconnect();
  assert.equal(input.inputSettings.css, css);
  assert.equal(writes().length, 2);
  input.inputSettings.css = 'body { color: pink; }';
  await reconnect();
  assert.equal(input.inputSettings.css, 'body { color: pink; }');
  assert.equal(writes().length, 2);
});
