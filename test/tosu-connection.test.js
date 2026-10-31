import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { TosuClient } from '../src/tosu.js';
import { SessionStore } from '../server/session/store.js';
import { newSession } from '../server/session/model.js';
import { TosuSimulator } from '../tools/tosu-simulator/server.js';

async function until(check, message) {
  for (let i = 0; i < 200; i++) { if (check()) return; await delay(10); }
  assert.fail(message);
}

class ReentrantSocket {
  static instances = [];
  constructor() { this.closeCalls = 0; ReentrantSocket.instances.push(this); }
  close() { this.closeCalls++; this.onerror?.(); this.onclose?.(); }
}

test('failed CONNECTING close may dispatch error synchronously without recursion or duplicate retry', async t => {
  ReentrantSocket.instances = [];
  const statuses = []; const frames = [];
  const client = new TosuClient({ url: 'ws://test', WebSocketImpl: ReentrantSocket, reconnectMs: 10, staleMs: 1000,
    onStatus: value => statuses.push(value), onFrame: value => frames.push(value) });
  t.after(() => client.stop()); client.start();
  const failed = client.socket; const oldError = failed.onerror; const oldMessage = failed.onmessage;
  assert.doesNotThrow(() => failed.onerror());
  assert.equal(failed.closeCalls, 1); assert.equal(client.socket, null);
  assert.equal(statuses.filter(s => s === 'error').length, 1);
  await until(() => ReentrantSocket.instances.length === 2, 'one reconnect');
  const next = client.socket;
  oldError(); oldMessage({ data: JSON.stringify({ state: {}, beatmap: { id: 1 } }) });
  assert.equal(frames.length, 0); assert.equal(client.socket, next);
  next.onmessage({ data: JSON.stringify({ state: {}, beatmap: { id: 2 } }) });
  assert.equal(frames[0].beatmap.id, 2);
  await delay(25); assert.equal(ReentrantSocket.instances.length, 2);
  client.stop(); await delay(20); assert.equal(ReentrantSocket.instances.length, 2);
});

test('close failures during error cleanup and stop do not escape the transport', async () => {
  class BrokenClose { close() { throw new Error('already failed'); } }
  const statuses = [];
  const client = new TosuClient({ url: 'ws://test', WebSocketImpl: BrokenClose, reconnectMs: 1000,
    onStatus: value => statuses.push(value), onFrame() {} });
  client.start(); assert.doesNotThrow(() => client.socket.onerror());
  assert.doesNotThrow(() => client.stop()); assert.equal(statuses.at(-1), 'stopped');
  client.start(); assert.doesNotThrow(() => client.stop());
});

test('connection-unavailable hint preserves match and automation intent', async () => {
  const store = new SessionStore({ state: newSession() }); const before = structuredClone(store.state);
  for (const status of ['connecting', 'error', 'disconnected']) {
    await store.sourceStatus(status);
    assert.match(store.live.note, /tosu 已启动/); assert.match(store.live.note, /自动重连/);
    assert.deepEqual(store.state, before);
  }
});

test('native WebSocket can start before tosu and connect when an isolated tosu appears later', { timeout: 5000 }, async t => {
  const reservation = createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const simulator = new TosuSimulator({ port, offlineFixtures: true });
  const statuses = []; const frames = [];
  const client = new TosuClient({ url: `ws://127.0.0.1:${port}/websocket/v2`, reconnectMs: 20, staleMs: 1000,
    onStatus: value => statuses.push(value), onFrame: value => frames.push(value) });
  t.after(async () => { client.stop(); if (simulator.server.listening) await simulator.stop(); });
  client.start(); await until(() => statuses.includes('error'), 'closed port reports a recoverable error');
  assert.equal(frames.length, 0);
  await simulator.start(); await until(() => frames.length > 0, 'tosu started later is connected automatically');
  assert.ok(statuses.includes('live')); assert.equal(simulator.clients.size, 1);
});
