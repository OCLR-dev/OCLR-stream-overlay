# Windows 便携版交付与验证

日期：2026-10-29（America/New_York）。实现验收时未提交、推送或发布 Release；后续提交与推送不代表 Windows 验收通过。

## 当前结论

- **便携 ZIP 已实际生成**：`release/OCLR-Windows-x64.zip`，入口 `OCLR.exe`，目标 Windows 10 / 11 x64（Intel / AMD）。不是 Electron，不需要 Node / Git / npm；附带 Node 22.23.4、已构建前端和服务端。尚未做代码签名。
- **Windows 原生启动验收未完成**。已检查并启动本机 Parallels 的 Windows 11；`prlctl start/exec` 受 Pro / Business 版本限制。图形方式可启动 Windows，但 Computer Use 无法操作虚拟机内容区，出现 `noWindowsAvailable` / `cannotClickOffscreenElement`，键盘输入无法落入 Windows。没有运行成功的 `.exe` 或 Windows 验收报告，不能把启动虚拟机视为启动应用通过。
- **真实 tosu / osu!tourney / OBS 未验证**。没有捆绑或下载这些程序。游戏捕获仍是占位，真实结算旧快照风险与接线边界保留。

## 实现

`tools/windows-launcher` 用 Go 标准库调用 Win32：等待后端就绪及完整会话恢复，核对构建标识和子进程 PID 后才打开默认浏览器。原生窗口包含状态、打开控制台、复制 OBS 地址、退出。关闭窗口先确认停止输出；关闭浏览器不关服务。重复双击通过 Windows 命名互斥量复用同版本实例；旧版本或未知占用明确提示，不杀其他进程。

`server/portable.js` 是独立本地入口，不改变开发启动入口和模拟器。只监听 `127.0.0.1:3001`，默认真实 tosu `ws://127.0.0.1:24050/websocket/v2`；就绪前 UI/API 返回 503。父子进程私有 stdin 管道用于退出，没有新增 HTTP 关机或公网控制接口；父进程退出也会触发后端正常收尾。进程退出前停止数据订阅并等待持久化队列。

数据路径 `%LOCALAPPDATA%\OCLR\StreamOverlay` 不依赖程序位置或工作目录。启动占位以稳定数据目录计算，多个解压目录不能同时写同一比赛。会话 schema 1 不转换，全部字段、撤销、存档保留；每个新构建首次打开已有会话前保存原始字节到 `backups/<build>/session.json`。旧包旁 `.local` 首次迁移先复制完整会话与 archive 到独立备份，再在目标旁暂存核验、原子改名；损坏/冲突/权限失败保留原记录。已有稳定数据时不被旧副本覆盖。

分发内容采用目录白名单；没有 `.env.local`、凭证、本机比赛、node_modules、模拟器或其他项目内容。附 Node、Go、Vue 和字体许可，逐文件 SHA256 清单及 ZIP 校验值。构建标识覆盖前端、服务端、来源层、启动器及固定 Node 校验值。更新应先退出旧版，再解压至新目录，不要在运行中覆盖旧程序。

本轮没有改动比赛模型或前端操作行为：图池标记独立、Playing/结算、自动生效、异常核对/重赛/纠错/撤销、初始化存档，以及深紫左红右蓝均沿用原实现。

## 已执行验证（macOS，不能替代 Windows）

`npm run build` 含类型检查通过；`npm test` 97 项通过。新增两组集成测试覆盖以下情况：

| 要求 | 当前实测证据 | Windows 原生状态 |
| --- | --- | --- |
| 首次启动、就绪后访问页面 | 完整包同布局，真实子进程健康就绪且会话已恢复；control/overlay 200 | 待验证 `.exe` 自动开浏览器 |
| 重复启动 | 同数据目录第二后端退出 1，原比赛不变 | 待验证命名互斥量及重复双击 |
| 中文及空格路径、无关 cwd | 在临时中文路径复制 app，工作目录为系统 TEMP | 待验证 Windows 路径 |
| 端口占用和失败 | 独立占用 3001，新进程失败、不建数据、不换端口、不影响占用者 | 待验证中文原生弹窗 |
| 关闭控制台后继续输出 | 两个 SSE 连接同步修改；断开控制台，overlay 仍 200 | 待验证浏览器/OBS 实际行为 |
| 正常退出与重启 | 私有管道退出，退出码 0；原地址重新启动成功 | 待验证原生退出按钮 |
| 原比赛恢复、更新保留 | 完整 JSON 字节一致、同会话 ID、撤销仍可用；不同目录及构建再次恢复 | 待验证原生包更新 |
| 旧数据迁移 | 原始会话及 archive 字节一致；备份存在；损坏/冲突拒绝 | 待验证 Windows 文件系统 |
| 控制台与独立输出同步 | 两个真实 SSE 订阅接收到同一标题变更 | 待验证 Windows 浏览器双页面 |

`test/portable.test.js` 使用隔离临时数据，不读取现有比赛。固定测试端口需空闲；不要在运行中的直播电脑执行开发测试。完整回归记录见 `mac-regression.txt`。

原工作区 HEAD 为 da83ebf，既有 README 和 Windows 文档修改已保留并续写。原 3007 / 24053 模拟服务未关闭、未初始化、未迁移，也未写其比赛命令。

## 构建与 Windows 复验（维护者）

```sh
npm ci
python3 tools/packaging/build_windows.py
```

开发机需要 Python 3、Go 1.27.3、Node 22.13+。脚本执行前端构建，下载固定版本的官方 Windows Node ZIP 并核对固定 SHA256，交叉编译 GUI exe，生成便携包。离线缓存可用 `--node-archive <zip>` 和 `--go <go可执行文件>`。Windows 使用 `python` 命令即可。

在 Windows 开发/验收机执行（使用包内运行时，无需安装 Node）：

```powershell
& .\release\OCLR-Windows-x64\runtime\node.exe tools/packaging/verify_windows.mjs release/OCLR-Windows-x64 release/windows-native.json
```

脚本在 Windows TEMP 下建立隔离的中文/空格程序目录与数据目录，执行原生 exe 首启、重复启动、SSE、退出、目录更新保留、端口占用、旧服务拒绝、损坏记录和 smoke-test，报告含每项结果。测试通过仍需人工补测正常 GUI 模式的浏览器自动打开、重复双击、复制地址、关闭网页后输出、关闭确认、键盘导航及高 DPI。

已添加手动触发的 `.github/workflows/windows-portable.yml`：在 Windows runner 构建、回归并执行实际 EXE 验收，只上传构建与验收工件，不发布 Release。该工作流仅手动触发；**目前未执行，不能算 CI 通过**。

## 后续服务器部署边界

当前服务仍是本机可信边界，不开放公网。远端服务器无法读取直播电脑的 `127.0.0.1:24050`；未来需要本地 tosu 数据桥接、身份验证、授权控制、断线重连和状态恢复设计。本轮未增加这些入口，也没有用监听 `0.0.0.0` 冒充服务器支持。

构建来源：[Node 官方固定版本下载](https://nodejs.org/dist/v22.23.4/)、[Go 官方下载](https://go.dev/dl/)。CI 设置参考 [setup-go](https://github.com/actions/setup-go)、[setup-node](https://github.com/actions/setup-node)。
