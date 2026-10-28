import { createHash } from 'node:crypto';

// Small send-only development endpoint, not a general-purpose production server.
// RFC 6455 handshake, unmasked server frames, masked client close/ping/pong.
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function packet(opcode, data) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const length = payload.length;
  const header = Buffer.alloc(length < 126 ? 2 : length <= 65535 ? 4 : 10);
  header[0] = 0x80 | opcode;
  if (length < 126) header[1] = length;
  else if (length <= 65535) { header[1] = 126; header.writeUInt16BE(length, 2); }
  else { header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); }
  return Buffer.concat([header, payload]);
}

export function acceptSocket(req, socket, head, clients) {
  const key = req.headers['sec-websocket-key'];
  if (req.method !== 'GET' || req.headers['sec-websocket-version'] !== '13' ||
      typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)) { socket.destroy(); return null; }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const peer = {
    send(text) { if (!socket.destroyed && socket.writableLength < 256 * 1024) socket.write(packet(1, text)); else socket.destroy(); },
    drop() { socket.destroy(); },
  };
  clients.add(peer);
  let buffer = Buffer.alloc(0);
  const receive = chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 128 * 1024) { socket.destroy(); return; }
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const control = opcode >= 8;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (!(buffer[1] & 0x80) || (buffer[0] & 0x70) || (control && (!(buffer[0] & 0x80) || length > 125))) { socket.destroy(); return; }
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      if (length === 127) { socket.destroy(); return; } // No large client messages are needed.
      if (buffer.length < offset + 4 + length) return;
      const mask = buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      buffer = buffer.subarray(offset + 4 + length);
      if (opcode === 8) { socket.end(packet(8, payload)); return; }
      if (opcode === 9) socket.write(packet(10, payload));
      else if (opcode !== 10) { socket.destroy(); return; }
    }
  };
  socket.on('data', receive);
  socket.on('error', () => socket.destroy());
  socket.on('close', () => clients.delete(peer));
  if (head?.length) receive(head);
  return peer;
}
