import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { SIM_POOL, SIM_TEAMS, WARMUP } from './fixture.js';
import { initialRoom, IPC_LABELS, makeV2Frame, MAP_PARAM_PRESETS } from './frames.js';
import { acceptSocket } from './websocket.js';

const FIELDS = ['mapId', 'ipcState', 'left', 'right', 'leftName', 'rightName', 'growing', 'silent', 'invalid', 'wrongRoom', 'missingClient', 'clientsHidden', 'mapParams'];
const reply = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
};

export class TosuSimulator {
  constructor({ port = 24051, tickMs = 100, onReset = null, offlineFixtures = false, getPool = null } = {}) {
    this.port = port; this.tickMs = tickMs; this.onReset = onReset;
    this.offlineFixtures = offlineFixtures; this.getPool = getPool;
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
  get maps() { return [WARMUP, ...(this.getPool ? this.getPool() : SIM_POOL)]; }
  wire() { return JSON.stringify(this.room.invalid ? { error: 'SIMULATED_INVALID_DATA' } : makeV2Frame(this.room, this.maps)); }
  broadcast() {
    if (this.room.silent) return;
    const payload = this.wire();
    for (const client of this.clients) { client.send(payload); this.framesSent++; }
  }
  snapshot() {
    return { simulation: true, offlineFixtures: this.offlineFixtures,
      competitionSource: this.offlineFixtures ? 'offline-fixture' : 'remote-read-only',
      roomTeams: { left: this.room.leftName || SIM_TEAMS.left, right: this.room.rightName || SIM_TEAMS.right },
      room: this.room, ipcName: IPC_LABELS[this.room.ipcState],
      maps: this.maps, clients: this.clients.size, connections: this.connections, framesSent: this.framesSent,
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
    for (const key of ['leftName', 'rightName']) if (key in patch && (typeof patch[key] !== 'string' || !patch[key].trim() || patch[key].length > 80)) throw new Error('请填写模拟房间左右队名');
    for (const key of ['growing', 'silent', 'invalid', 'wrongRoom', 'missingClient', 'clientsHidden']) if (key in patch && typeof patch[key] !== 'boolean') throw new Error('开关无效');
    if ('mapId' in patch && patch.mapId !== this.room.mapId) {
      this.room.time = 0; this.room.left = 0; this.room.right = 0;
      this.chat(`模拟换图 ${this.maps.find(m => m.beatmapId === patch.mapId)?.label || patch.mapId}`);
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
    const teams = !this.offlineFixtures ? { leftName: this.room.leftName, rightName: this.room.rightName } : {};
    this.cancelDemo(); this.room = { ...initialRoom(), ...teams }; this.scenario = '手动模式 · 等待基线';
    await this.resetMatch(); this.chat(this.offlineFixtures ? '已重置隔离模拟会话，当前为池外连接基线' : '已重置 tosu 模拟信号，赛事资料和比赛记录保留'); this.broadcast();
  }
  async demoRun() {
    this.cancelDemo();
    if (this.offlineFixtures) this.room = initialRoom();
    const controller = new AbortController(); this.demo = controller;
    const steps = this.offlineFixtures ? [
      ['池外基线', {}, 1200], ['红队 Ban HD1', { mapId: 720001 }, 1100],
      ['蓝队 Ban HR1', { mapId: 730001 }, 1100], ['红队 Pick NM1', { mapId: 710001 }, 1100],
      ['准备期改为 NM2', { mapId: 710002 }, 1100], ['Playing · 实时分数与聊天', { ipcState: 3 }, 8000],
      ['Ranking · 红队最终胜出', { ipcState: 4, left: 1234567, right: 1100000 }, 1200],
    ] : [
      ['本图 Playing · 不编排 BP、不重置比赛', { ipcState: 3, left: 0, right: 0 }, 8000],
      ['本图 Ranking · 模拟左队胜出', { ipcState: 4, left: 1234567, right: 1100000 }, 1200],
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
  async panicRun() {
    this.cancelDemo();
    const controller = new AbortController(); this.demo = controller;
    const previous = { ipcState: this.room.ipcState, clientsHidden: this.room.clientsHidden || false };
    const room = this.room;
    this.scenario = '模拟观战重建 · 比赛记录不变（非真实 Panic 时序）';
    this.set({ ipcState: 0, clientsHidden: true });
    try {
      await delay(1200, undefined, { signal: controller.signal });
      this.set(previous); this.scenario = '观战已恢复 · 在控制台核对继续当前局';
    } catch (error) { if (error.name !== 'AbortError') this.scenario = '模拟观战恢复失败'; }
    finally {
      if (controller.signal.aborted && this.room === room) this.set({ clientsHidden: previous.clientsHidden });
      if (this.demo === controller) this.demo = null;
    }
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
    else if (command.action === 'demo') {
      if (this.demo) return reply(res, 409, { error: '模拟序列正在运行' });
      if (!this.offlineFixtures && !this.maps.some(m => m.id !== WARMUP.id && m.beatmapId === this.room.mapId)) return reply(res, 409, { error: '请先选择本场图池中的谱面，并在控制台准备本图或配置明确 BP 动作' });
      void this.demoRun();
    }
    else if (command.action === 'panic') { if (this.demo) return reply(res, 409, { error: '模拟序列正在运行' }); void this.panicRun(); }
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
