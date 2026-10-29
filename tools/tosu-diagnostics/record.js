import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const hits = value => Object.fromEntries(['0', '50', '100', '300', 'geki', 'katu', 'sliderEndHits', 'smallTickHits', 'largeTickHits'].map(key => [key, numeric(value?.[key])]));

// Preserve observations, including nulls. Never invent a per-client finished
// flag, infer completion from time, or include environment files / chat / names.
export function projectFrame(raw) {
  if (!raw || typeof raw !== 'object' || raw.error) return { valid: false };
  const tourney = raw.tourney;
  return { valid: !!(raw.state && raw.beatmap), client: raw.client || null,
    selectedState: numeric(raw.state?.number), beatmapId: numeric(raw.beatmap?.id),
    time: { live: numeric(raw.beatmap?.time?.live), lastObject: numeric(raw.beatmap?.time?.lastObject) },
    ipcState: numeric(tourney?.ipcState), scoreVisible: typeof tourney?.scoreVisible === 'boolean' ? tourney.scoreVisible : null,
    totalScore: { left: numeric(tourney?.totalScore?.left), right: numeric(tourney?.totalScore?.right) },
    points: { left: numeric(tourney?.points?.left), right: numeric(tourney?.points?.right) },
    clients: Array.isArray(tourney?.clients) ? tourney.clients.map(client => ({
      ipcId: numeric(client.ipcId), side: ['left', 'right'].includes(client.team) ? client.team : null,
      osuId: numeric(client.user?.id), mode: numeric(client.play?.mode?.number), score: numeric(client.play?.score),
      failed: typeof client.play?.failed === 'boolean' ? client.play.failed : null,
      hits: hits(client.play?.hits), objects: numeric(client.beatmap?.stats?.objects?.total),
    })) : [],
  };
}

export async function record({ url, duration, output }) {
  await mkdir(dirname(output), { recursive: true });
  const stream = createWriteStream(output, { flags: 'wx', mode: 0o600 });
  await new Promise((resolveOpen, reject) => { stream.once('open', resolveOpen); stream.once('error', reject); });
  const started = performance.now();
  let stopped = false; let socket; let retry; let sequence = 0; let validFrames = 0; let deadline;
  let resolveDone;
  const done = new Promise(resolveStop => { resolveDone = resolveStop; });
  const write = (event, value = {}) => {
    if (!stopped) stream.write(JSON.stringify({ at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), event, ...value }) + '\n');
  };
  stream.on('error', error => { console.error(`记录写入失败：${error.code || 'WRITE_FAILED'}`); stop(); });
  function stop() {
    if (stopped) return;
    write('stop', { frames: sequence, validFrames }); stopped = true;
    clearTimeout(deadline); clearTimeout(retry); socket?.close();
    input.close(); stream.end(); resolveDone();
  }
  const input = createInterface({ input: process.stdin, terminal: false });
  input.on('line', line => { if (line.trim()) write('marker', { label: line.trim().slice(0, 200) }); });
  const connect = () => {
    if (stopped) return;
    write('connecting');
    const current = new WebSocket(url); socket = current;
    current.onopen = () => { if (!stopped && socket === current) write('connected'); };
    current.onmessage = event => {
      if (stopped || socket !== current) return;
      try {
        const projected = projectFrame(JSON.parse(event.data));
        if (projected.valid) validFrames++;
        write('frame', { sequence: ++sequence, ...projected });
      }
      catch { write('invalid-json'); }
    };
    current.onerror = () => { if (!stopped && socket === current) write('socket-error'); };
    current.onclose = event => {
      if (stopped || socket !== current) return;
      write('disconnected', { code: event.code }); retry = setTimeout(connect, 1000);
    };
  };
  write('header', { url, durationSeconds: duration, format: 'oclr-tosu-timing-v1', note: '观测记录，不自动判定全体完成' });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  deadline = setTimeout(stop, duration * 1000);
  connect();
  console.log(`记录 ${duration} 秒：${url}\n输出：${output}\n可输入事件标记后回车，例如“其他人已结束”“最后一路结束”“结果队分跳变”；Ctrl+C 提前结束。`);
  await done;
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  await finished(stream);
  console.log(`记录完成：${sequence} 帧，其中 ${validFrames} 帧有效。`);
  return { frames: sequence, validFrames };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const values = { url: 'ws://127.0.0.1:24050/websocket/v2', duration: 120, output: resolve(`.local/diagnostics/tosu-timing-${Date.now()}.ndjson`) };
  const args = process.argv.slice(2);
  if (args.includes('--help')) console.log('npm run tosu:record -- [--duration 秒数] [--out 文件.ndjson] [--url ws://127.0.0.1:24050/websocket/v2]');
  else {
    for (let i = 0; i < args.length; i += 2) {
      const key = { '--url': 'url', '--duration': 'duration', '--out': 'output' }[args[i]];
      if (!key || !args[i + 1]) throw new Error('参数无效，使用 --help 查看');
      values[key] = key === 'duration' ? Number(args[i + 1]) : key === 'output' ? resolve(args[i + 1]) : args[i + 1];
    }
    const target = new URL(values.url);
    if (target.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.username || target.password) throw new Error('记录器仅连接本机无凭证的 tosu WebSocket');
    if (!Number.isInteger(values.duration) || values.duration < 1 || values.duration > 3600) throw new Error('记录时长须为 1–3600 秒');
    const result = await record(values);
    if (!result.validFrames) { console.error('未取得有效 tosu 帧，请检查服务与所选实例。'); process.exitCode = 2; }
  }
}
