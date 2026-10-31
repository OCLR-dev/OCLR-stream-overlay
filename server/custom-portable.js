import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { startCustomMatch } from './custom-match.js';
import { sessionFromTemplate } from './custom-template.js';
import { backupBeforeVersion } from './portable-data.js';

const root = fileURLToPath(new URL('../', import.meta.url));
let app;
let startupStage = '读取程序清单';
try {
  const manifest = JSON.parse(await readFile(join(root, 'portable-build.json'), 'utf8'));
  if (manifest.kind !== 'custom-match' || !/^[a-f0-9]{64}$/.test(manifest.build)) throw new Error('测试包清单无效');
  startupStage = '定位 Windows 用户数据目录';
  if (!process.env.LOCALAPPDATA) throw new Error('无法找到 Windows 用户数据目录');
  const dataDir = resolve(process.env.LOCALAPPDATA, 'OCLR', 'CustomMatchTest');
  startupStage = '读取比赛初始配置';
  const template = JSON.parse(await readFile(join(root, 'match-template.json'), 'utf8'));
  // Validate bundled configuration even when an existing saved match takes precedence.
  sessionFromTemplate(template);
  startupStage = '备份现有比赛';
  await backupBeforeVersion(dataDir, manifest.build);
  app = await startCustomMatch({ port: 3011, sessionFile: join(dataDir, 'session.json'), guardPort: 0,
    onStage: stage => { startupStage = stage; },
    initialState: () => sessionFromTemplate(template),
    runtime: { build: manifest.build, label: manifest.label || '', ready: true, portable: true, pid: process.pid } });
  const input = createInterface({ input: process.stdin });
  input.on('line', line => { if (line === 'shutdown') { input.close(); void app.stop(); } });
  input.on('close', () => void app.stop());
  process.once('SIGTERM', () => { input.close(); void app.stop(); });
  process.once('SIGINT', () => { input.close(); void app.stop(); });
} catch (error) {
  const message = error.code === 'EADDRINUSE' ? '3011 地址已被占用，请先退出占用该地址的服务。'
    : error.code === 'EACCES' || error.code === 'EPERM' ? 'Windows 拒绝了此操作；请根据下方阶段和错误代码核对。'
    : error.message === 'SESSION_RESTORE_FAILED' ? '比赛文件无法读取，原文件已保留，勿初始化比赛。'
    : /[\u4e00-\u9fff]/.test(error.message) ? error.message : '测试版启动失败，具体原因见下方。';
  console.error(`${message}\n阶段：${startupStage}\n错误代码：${error.code || error.name || 'UNKNOWN'}\n详细信息：${error.message}`);
  await app?.stop();
  process.exitCode = 1;
}
