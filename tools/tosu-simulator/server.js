import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { SIM_POOL, WARMUP } from './fixture.js';
import { initialRoom, IPC_LABELS, makeV2Frame, MAP_PARAM_PRESETS } from './frames.js';
import { acceptSocket } from './websocket.js';

const FIELDS = ['mapId', 'ipcState', 'left', 'right', 'growing', 'silent', 'invalid', 'wrongRoom', 'mapParams'];
const reply = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
};

export class TosuSimulator {
  constructor({ port = 24051, tickMs = 100, onReset = null } = {}) {
    this.port = port; this.tickMs = tickMs; this.onReset = onReset;
    this.room = initialRoom(); this.clients = new Set(); this.framesSent = 0; this.connections = 0;
    this.scenario = '手动模式 · 等待基线';
    this.resetTail = Promise.resolve();
    this.server = createServer((req, res) => { void this.http(req, res).catch(() => { if (!res.headersSent) reply(res, 400, { error: '模拟器请求失败' }); else res.destroy(); }); });
    this.server.on('upgrade', (req, socket, head) => {
      if (!this.allowed(req) || req.url !== '/websocket/v2') { socket.destroy(); return; }
      const peer = acceptSocket(req, socket, head, this.clients);
      if (peer) { this.connections++; if (!this.room.silent) peer.send(this.wire()); }
    });
  }
  allowed(req) {
    const navigation = req.method === 'GET' && req.url === '/' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    return [`127.0.0.1:${this.port}`, `localhost:${this.port}`].includes(req.headers.host) &&
      (!req.headers.origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin)) && (req.headers['sec-fetch-site'] !== 'cross-site' || navigation);
  }
  get wsUrl() { return `ws://127.0.0.1:${this.port}/websocket/v2`; }
  wire() { return JSON.stringify(this.room.invalid ? { error: 'SIMULATED_INVALID_DATA' } : makeV2Frame(this.room)); }
  broadcast() {
    if (this.room.silent) return;
    const payload = this.wire();
    for (const client of this.clients) { client.send(payload); this.framesSent++; }
  }
  snapshot() {
    return { simulation: true, room: this.room, ipcName: IPC_LABELS[this.room.ipcState],
      maps: [WARMUP, ...SIM_POOL], clients: this.clients.size, connections: this.connections, framesSent: this.framesSent,
      scenario: this.scenario, appUrl: this.appUrl || '', wsUrl: this.wsUrl, frame: JSON.parse(this.wire()) };
  }
  chat(message) {
    this.room.chat.push({ team: 'unknown', name: '裁判（模拟）', message, timestamp: new Date().toISOString() });
    this.room.chat = this.room.chat.slice(-20);
  }
  set(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !FIELDS.includes(key))) throw new Error('未知模拟字段');
    if ('mapId' in patch && (!Number.isSafeInteger(patch.mapId) || patch.mapId <= 0)) throw new Error('谱面 ID 无效');
    if ('ipcState' in patch && ![0, 1, 2, 3, 4].includes(patch.ipcState)) throw new Error('IPC 无效');
    if ('mapParams' in patch && !Object.hasOwn(MAP_PARAM_PRESETS, patch.mapParams)) throw new Error('参数样本无效');
    for (const key of ['left', 'right']) if (key in patch && patch[key] !== null && (!Number.isSafeInteger(patch[key]) || patch[key] < 0)) throw new Error('队分无效');
    for (const key of ['growing', 'silent', 'invalid', 'wrongRoom']) if (key in patch && typeof patch[key] !== 'boolean') throw new Error('开关无效');
    if ('mapId' in patch && patch.mapId !== this.room.mapId) {
      this.room.time = 0; this.room.left = 0; this.room.right = 0;
      this.chat(`模拟换图 ${[WARMUP, ...SIM_POOL].find(m => m.beatmapId === patch.mapId)?.label || patch.mapId}`);
    }
    if ('ipcState' in patch && patch.ipcState !== this.room.ipcState) this.chat(`模拟赛事状态 → ${IPC_LABELS[patch.ipcState]}`);
    Object.assign(this.room, patch); this.broadcast();
  }
  cancelDemo() { this.demo?.abort(); this.demo = null; }
  resetMatch() {
    const task = this.resetTail.then(() => this.onReset?.());
    this.resetTail = task.catch(() => {});
    return task;
  }
  async reset() {
    this.cancelDemo(); this.room = initialRoom(); this.scenario = '手动模式 · 等待基线';
    await this.resetMatch(); this.chat('已重置隔离模拟会话，当前为池外连接基线'); this.broadcast();
  }
  async demoRun() {
    this.cancelDemo(); this.room = initialRoom();
    const controller = new AbortController(); this.demo = controller;
    const steps = [
      ['池外基线', {}, 1200], ['红队 Ban HD1', { mapId: 720001 }, 1100],
      ['蓝队 Ban HR1', { mapId: 730001 }, 1100], ['红队 Pick NM1', { mapId: 710001 }, 1100],
      ['准备期改为 NM2', { mapId: 710002 }, 1100], ['Playing · 实时分数与聊天', { ipcState: 3 }, 8000],
      ['Ranking · 红队最终胜出', { ipcState: 4, left: 1234567, right: 1100000 }, 1200],
    ];
    try {
      await this.resetMatch();
      for (const [label, patch, ms] of steps) {
        if (controller.signal.aborted) return;
        this.scenario = label; this.set(patch); await delay(ms, undefined, { signal: controller.signal });
      }
      this.scenario = '完整一局已完成 · 保持结算，供直播员纠错';
    } catch (error) { if (error.name !== 'AbortError') this.scenario = '模拟序列失败'; }
    finally { if (this.demo === controller) this.demo = null; }
  }
  async http(req, res) {
    if (!this.allowed(req)) return reply(res, 403, { error: 'LOCAL_ORIGIN_REQUIRED' });
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && ['/', '/simulator.js', '/simulator.css'].includes(url.pathname)) {
      const name = { '/': 'index.html', '/simulator.js': 'panel.js', '/simulator.css': 'panel.css' }[url.pathname];
      const body = await readFile(new URL(name, import.meta.url));
      res.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(body);
    }
    if (req.method === 'GET' && url.pathname === '/json/v2') return reply(res, 200, JSON.parse(this.wire()));
    if (req.method === 'GET' && url.pathname === '/api/simulator') return reply(res, 200, this.snapshot());
    if (req.method !== 'POST' || url.pathname !== '/api/simulator/control') return reply(res, 404, { error: 'NOT_FOUND' });
    if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type']?.split(';')[0] !== 'application/json') return reply(res, 403, { error: 'SAME_ORIGIN_JSON_REQUIRED' });
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new Error('请求过大'); chunks.push(chunk); }
    const command = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (command.action === 'set') { this.cancelDemo(); this.scenario = '手动模式'; this.set(command.patch); }
    else if (command.action === 'disconnect') { for (const client of this.clients) client.drop(); }
    else if (command.action === 'reset') await this.reset();
    else if (command.action === 'demo') { if (this.demo) return reply(res, 409, { error: '模拟序列正在运行' }); void this.demoRun(); }
    else return reply(res, 400, { error: 'UNKNOWN_ACTION' });
    return reply(res, 200, this.snapshot());
  }
  async start() {
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port, '127.0.0.1', resolve); });
    this.port = this.server.address().port;
    this.chat('模拟 WebSocket 已启动；不会连接 osu! 或发送房间指令');
    this.timer = setInterval(() => {
      if (!this.room.silent && this.room.ipcState === 3 && this.room.growing) {
        this.room.time += this.tickMs;
        if (this.room.left !== null) this.room.left += 7000;
        if (this.room.right !== null) this.room.right += 6500;
        if (this.room.time % 3000 < this.tickMs) this.chat(`Playing 模拟帧 · ${Math.round(this.room.time / 1000)}s`);
      }
      this.broadcast();
    }, this.tickMs);
    return this;
  }
  async stop() {
    this.cancelDemo(); clearInterval(this.timer);
    await this.resetTail;
    for (const client of this.clients) client.drop();
    this.server.closeAllConnections();
    await new Promise(resolve => this.server.close(resolve));
  }
}
