import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncBrowserAddresses } from '../server/obs/browser-addresses.js';
import { Studio } from './obs-fixture.js';

test('OBS URL migration preserves settings and query/hash, recognizes loopback aliases and updates shared inputs once', async () => {
  const studio = new Studio();
  const urls = ['http://localhost:3001/overlay?mode=live#scene', 'http://127.0.0.1:3011/showcase?clean=1',
    'https://example.org/overlay', 'http://127.0.0.1:3001/control', 'http://localhost:9999/overlay',
    'http://localhost:3001.evil.example/overlay', 'http://localhost:3001/other', 'not a URL'];
  urls.forEach((url, i) => studio.inputs.set(String(i), { inputName: String(i), inputUuid: String(i), inputKind: 'browser_source', inputSettings: { url, width: 1920, css: 'custom' } }));
  const call = studio.request.bind(studio);
  await syncBrowserAddresses(call, 'http://127.0.0.1:3022/overlay', ['3011'], {});
  assert.equal(studio.inputs.get('0').inputSettings.url, 'http://localhost:3022/overlay?mode=live#scene');
  assert.equal(studio.inputs.get('1').inputSettings.url, 'http://127.0.0.1:3022/showcase?clean=1');
  for (let i = 2; i < urls.length; i++) assert.equal(studio.inputs.get(String(i)).inputSettings.url, urls[i]);
  assert.equal(studio.inputs.get('0').inputSettings.css, 'custom');
  await syncBrowserAddresses(call, 'http://127.0.0.1:3022/overlay', ['3011'], {});
  assert.equal(studio.log.filter(x => x.type === 'SetInputSettings').length, 2);
  assert.ok(studio.log.filter(x => x.type === 'SetInputSettings').every(x => x.overlay && Object.keys(x.inputSettings).join() === 'url'));
});

test('recorded browser identity migrates an older custom port and failed writes remain retryable', async () => {
  const studio = new Studio();
  studio.inputs.set('renamed', { inputName: 'renamed', inputUuid: 'owned', inputKind: 'browser_source', inputSettings: { url: 'http://localhost:8123/showcase?clean=1' } });
  const profile = { showcase: { inputUuid: 'owned' } };
  await assert.rejects(syncBrowserAddresses(async (type, args) => {
    if (type === 'SetInputSettings') throw new Error('offline');
    return studio.request(type, args);
  }, 'http://127.0.0.1:3022/overlay', [], profile), /offline/);
  await syncBrowserAddresses(studio.request.bind(studio), 'http://127.0.0.1:3022/overlay', [], profile);
  assert.equal(studio.inputs.get('renamed').inputSettings.url, 'http://localhost:3022/showcase?clean=1');
});
