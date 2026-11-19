import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function localReplayMetadata(filename, bytes) {
  const invalid = () => new Error('请选择有效的 .osr 回放文件（最大 8 MiB）。');
  if (typeof filename !== 'string' || !/^[^/\\\u0000-\u001f]{1,255}\.osr$/i.test(filename)) throw invalid();
  try {
    let offset = 5; // game mode and client version
    const string = () => {
      const marker = bytes.readUInt8(offset++);
      if (!marker) return '';
      if (marker !== 0x0b) throw invalid();
      let length = 0;
      for (let shift = 0; shift <= 21; shift += 7) {
        const byte = bytes.readUInt8(offset++);
        length += (byte & 127) * 2 ** shift;
        if (byte & 128) continue;
        if (offset + length > bytes.length) throw invalid();
        const value = bytes.toString('utf8', offset, offset + length);
        offset += length;
        return value;
      }
      throw invalid();
    };
    const checksum = string();
    const playerName = string();
    string(); // replay hash
    const mods = bytes.readUInt32LE(offset + 19);
    if (bytes[0] > 3 || !/^[a-f0-9]{32}$/i.test(checksum) || playerName.length > 255) throw invalid();
    // Skip life graph and timestamp. The compressed replay itself is read by osu!.
    offset += 23;
    string();
    const length = bytes.readInt32LE(offset + 8);
    if (length <= 0 || offset + 12 + length > bytes.length) throw invalid();
    return { filename, playerName, mods };
  } catch { throw invalid(); }
}

export async function stageReplayFile(bytes) {
  const unavailable = () => new Error('无法保存本机回放，请检查直播机存储空间后重试。');
  const temporaryRoot = process.env.OCLR_REPLAY_TEMP || tmpdir();
  const directory = await mkdir(temporaryRoot, { recursive: true }).then(() => mkdtemp(join(temporaryRoot, 'oclr-showcase-')))
    .catch(() => { throw unavailable(); });
  const path = join(directory, 'Replay.osr');
  const dispose = () => rm(directory, { recursive: true, force: true }).catch(() => {});
  try { await writeFile(path, bytes, { mode: 0o600 }); }
  catch { await dispose(); throw unavailable(); }
  return { path, dispose };
}

export async function prepareStableReplay(path) {
  if (process.platform !== 'win32') throw new Error('请在 Windows 直播机上使用 osu!stable 播放回放。');
  let executable;
  try {
    const local = process.env.LOCALAPPDATA || '';
    const portableSettings = process.env.OCLR_LAUNCHER_SETTINGS;
    const settings = portableSettings || join(local, 'OCLR', 'StreamOverlayLauncher', 'settings.json');
    const prefs = await readFile(settings, 'utf8').then(JSON.parse, error => {
      if (error.code !== 'ENOENT') throw error;
      return {};
    });
    let selected = prefs.osuPath || join(local, 'osu!', 'osu!.exe');
    if (portableSettings && selected.startsWith('.\\')) {
      const root = fileURLToPath(new URL('../../', import.meta.url));
      selected = resolve(root, selected);
      const inside = relative(root, selected);
      if (inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) throw new Error();
    }
    if (!isAbsolute(selected) || basename(selected).toLowerCase() !== 'osu!.exe') throw new Error();
    executable = await realpath(selected);
    if (basename(executable).toLowerCase() !== 'osu!.exe' || !(await stat(executable)).isFile()) throw new Error();
  } catch { throw new Error('找不到 osu!stable，请在桌面控制台「设置」中选择普通客户端的 osu!.exe。'); }
  const cwd = dirname(executable);
  try {
    await lstat(join(cwd, 'tournament.cfg'));
    throw new Error();
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('所选 osu! 含有赛事配置，请在「设置」中选择普通 osu!stable。');
  }
  return () => new Promise((resolve, reject) => {
    const child = spawn(executable, [path], { cwd, detached: true, stdio: 'ignore' });
    child.once('error', () => reject(new Error('未能打开回放，请检查普通 osu!stable 后重试。')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
