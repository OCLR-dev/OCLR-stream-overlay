import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { startCustomMatch } from './custom-match.js';
import { newCustomSession } from './session/model.js';
import { sessionFromTemplate } from './custom-template.js';
import { backupBeforeVersion } from './portable-data.js';
import { portableGuardPort } from './runtime.js';

const root = fileURLToPath(new URL('../', import.meta.url));
let app;
let startupStage = '读取程序清单';
try {
  const manifest = JSON.parse(await readFile(join(root, 'portable-build.json'), 'utf8'));
  if (manifest.kind !== 'custom-match' || !/^[a-f0-9]{64}$/.test(manifest.build)) throw new Error('Custom-Match 程序清单无效');
  startupStage = '定位 Windows 用户数据目录';
  if (!process.env.OCLR_DATA_DIR && !process.env.LOCALAPPDATA) throw new Error('无法找到 Windows 用户数据目录');
  const dataDir = resolve(process.env.OCLR_DATA_DIR || join(process.env.LOCALAPPDATA, 'OCLR', 'CustomMatchTest'));
  const port = Number(process.env.OCLR_APP_PORT ?? '3011');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('服务端口须为 1–65535 的整数');
  startupStage = '读取比赛初始配置';
  const initialState = manifest.template === false ? newCustomSession() :
    sessionFromTemplate(JSON.parse(await readFile(join(root, 'match-template.json'), 'utf8')));
  initialState.auto.wsUrl = null;
  app = await startCustomMatch({ port, sessionFile: join(dataDir, 'session.json'), guardPort: portableGuardPort(dataDir),
    onStage: stage => { startupStage = stage; },
    prepareStorage: () => { startupStage = '备份现有比赛'; return backupBeforeVersion(dataDir, manifest.build); },
    initialState: () => initialState, launcherTosu: true,
    runtime: { build: manifest.build, label: manifest.label || '', portable: true, pid: process.pid } });
  const input = createInterface({ input: process.stdin });
  input.on('line', line => {
    if (line === 'shutdown') { input.close(); void app.stop(); return; }
    const match = /^tosu-port (0|[1-9][0-9]{0,4})$/.exec(line);
    if (match && Number(match[1]) <= 65535) app.setLauncherTosuPort(Number(match[1]));
  });
  input.on('close', () => void app.stop());
  process.once('SIGTERM', () => { input.close(); void app.stop(); });
  process.once('SIGINT', () => { input.close(); void app.stop(); });
} catch (error) {
  const message = error.code === 'EADDRINUSE' ? '所选服务端口被占用，请在启动窗口修改端口后重试。'
    : error.code === 'EACCES' || error.code === 'EPERM' ? 'Windows 拒绝了此操作；请根据下方阶段和错误代码核对。'
    : error.message === 'SESSION_RESTORE_FAILED' ? '比赛记录无法读取，原文件已保留，勿初始化比赛。'
    : /[\u4e00-\u9fff]/.test(error.message) ? error.message : 'Custom-Match 启动失败，具体原因见下方。';
  console.error(`${message}\n阶段：${startupStage}\n错误代码：${error.code || error.name || 'UNKNOWN'}\n详细信息：${error.message}`);
  await app?.stop();
  process.exitCode = 1;
}
