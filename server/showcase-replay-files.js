import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
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

const stableSelection = '服务 → 比赛工具 → osu!Stable';
const sameDirectory = (a, b) => dirname(a).toLowerCase() === dirname(b).toLowerCase();

async function configuredOsu(value, launcherSettings) {
  if (typeof value !== 'string') throw new Error();
  let selected = value;
  if (launcherSettings && selected.startsWith('.\\')) {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    selected = resolve(root, selected);
    const inside = relative(root, selected);
    if (inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) throw new Error();
  }
  if (!isAbsolute(selected) || basename(selected).toLowerCase() !== 'osu!.exe') throw new Error();
  const executable = await realpath(selected);
  if (basename(executable).toLowerCase() !== 'osu!.exe' || !(await stat(executable)).isFile()) throw new Error();
  return executable;
}

async function stableReplayClient() {
  const launcherSettings = process.env.OCLR_LAUNCHER_SETTINGS;
  const settings = launcherSettings || join(process.env.LOCALAPPDATA || '', 'OCLR', 'StreamOverlayLauncher', 'settings.json');
  let prefs, executable;
  try {
    if (!isAbsolute(settings)) throw new Error();
    prefs = JSON.parse(await readFile(settings, 'utf8'));
    executable = await configuredOsu(prefs.osuStablePath, launcherSettings);
  } catch {
    throw new Error('找不到 osu!Stable，请在「' +  stableSelection  + '」选择普通客户端的 osu!.exe。');
  }
  const tourney = await configuredOsu(prefs.osuPath, launcherSettings).catch(() => null);
  if (tourney && sameDirectory(tourney, executable)) {
    throw new Error('请在「' +  stableSelection  + '」选择与 osu!Tourney 分开的安装目录。');
  }
  try {
    await lstat(join(dirname(executable), 'tournament.cfg'));
    throw new Error();
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('所选 osu! 含有赛事配置，请在「' +  stableSelection  + '」选择普通客户端。');
  }
  return executable;
}

export async function prepareStableReplay(path) {
  if (process.platform !== 'win32') throw new Error('请在 Windows 直播机上使用 osu!Stable 播放回放。');
  const executable = await stableReplayClient();
  return async () => {
    if (await stableReplayClient() !== executable) throw new Error('osu!Stable 路径已变化，请重试播放回放。');
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [path], { cwd: dirname(executable), detached: true, stdio: 'ignore' });
      child.once('error', () => reject(new Error('未能打开回放，请检查普通 osu!Stable 后重试。')));
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  };
}

export async function cachedReplay(path, limit) {
  if (!path) return null;
  const info = await lstat(path).catch(() => null);
  return info?.isFile() && info.size > 0 && info.size <= limit ? { path } : null;
}

export async function saveCachedReplay(path, bytes, current) {
  const root = dirname(path);
  let temporary;
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    temporary = await mkdtemp(join(root, '.download-'));
    const staged = join(temporary, 'Replay.osr');
    await writeFile(staged, bytes, { mode: 0o600 });
    if (!current()) return null;
    await rename(staged, path);
    return { path };
  } catch {
    throw new Error('无法保存本机回放缓存，请检查直播机存储空间和目录权限后重试。');
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}
