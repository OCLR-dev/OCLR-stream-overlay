import { createHash, randomUUID } from 'node:crypto';

export class ObsError extends Error {}

const unavailable = 'OBS 连接中断，请打开 OBS 并核对 WebSocket 端口。';
const sha256 = value => createHash('sha256').update(value).digest('base64');

// One transport owns its pending RPCs. A timed-out write may already have run
// in OBS, so discard the transport and read Program again on a new connection.
export class ObsSocket {
  constructor({ port, password, onEvent, onClose, WebSocketImpl = WebSocket }) {
    this.pending = new Map();
    this.closed = false;
    this.socket = new WebSocketImpl(`ws://127.0.0.1:${port}`, 'obswebsocket.json');
    this.ready = new Promise((resolve, reject) => {
      this.identified = resolve;
      this.failed = reject;
    });
    this.onClose = onClose;
    this.handshake = setTimeout(() => this.close(), 6000);
    this.socket.addEventListener('message', event => {
      try {
        const { op, d } = JSON.parse(event.data);
        if (this.closed) return;
        if (op === 0) {
          const identify = { rpcVersion: 1, eventSubscriptions: 6 }; // Config and Scenes
          if (d.authentication) {
            identify.authentication = sha256(sha256(password + d.authentication.salt) + d.authentication.challenge);
          }
          this.send(1, identify);
        } else if (op === 2) {
          clearTimeout(this.handshake);
          this.identified();
        } else if (op === 5) {
          onEvent(d.eventType, d.eventData || {});
        } else if (op === 7) {
          const request = this.pending.get(d.requestId);
          if (!request) return;
          this.pending.delete(d.requestId);
          clearTimeout(request.timeout);
          if (d.requestStatus.result) request.resolve(d.responseData || {});
          else request.reject(new ObsError(`OBS 未能完成 ${d.requestType}，请核对场景、来源或连接后重试。`));
        }
      } catch { this.close(); }
    });
    // Node can dispatch error synchronously inside close() during a failed
    // upgrade. The transport is already failing; only settle our listeners.
    this.socket.addEventListener('error', () => this.finish(
      `未能连接本机 OBS，请在 OBS 的「工具 → WebSocket 服务器设置」中启用服务，并核对端口 ${port}。`));
    this.socket.addEventListener('close', event => this.finish(event.code === 4009
      ? 'OBS 密码不正确，请重新输入 WebSocket 服务器密码。' : unavailable));
  }

  send(op, d) { this.socket.send(JSON.stringify({ op, d })); }

  request(requestType, requestData = {}) {
    if (this.closed) return Promise.reject(new ObsError(unavailable));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.close(), 6000);
      this.pending.set(requestId, { resolve, reject, timeout });
      try { this.send(6, { requestType, requestId, requestData }); }
      catch { this.close(); }
    });
  }

  finish(message) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.handshake);
    const error = new ObsError(message);
    this.failed(error);
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
    this.onClose(message);
  }

  close() {
    if (this.closed) return;
    this.finish(unavailable);
    this.socket.close();
  }
}
