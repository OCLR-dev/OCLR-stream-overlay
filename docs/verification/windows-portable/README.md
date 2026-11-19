> v0.3.0 的 Windows 界面改用 Wails。构建与验收见 [Wails 启动器](../wails-launcher/README.md)。以下保留原生版本的历史证据。

# Windows 便携版交付与验证

此页按阶段保留构建和验证结果。2026-10-29 的 macOS 初验、后续 Windows 原生验证及 2026-11-15 的端口复验分别列在对应章节。便携包的操作步骤见随包《使用说明.txt》。

## 早期 macOS 验证结论

- **便携 ZIP 已实际生成**：`release/OCLR-Windows-x64.zip`，入口 `OCLR.exe`，目标 Windows 10 / 11 x64（Intel / AMD）。不是 Electron，不需要 Node / Git / npm；附带 Node 22.23.4、已构建前端和服务端。尚未做代码签名。
- **Windows 原生启动验收未完成**。已检查并启动本机 Parallels 的 Windows 11；`prlctl start/exec` 受 Pro / Business 版本限制。图形方式可启动 Windows，但 Computer Use 无法操作虚拟机内容区，出现 `noWindowsAvailable` / `cannotClickOffscreenElement`，键盘输入无法落入 Windows。没有运行成功的 `.exe` 或 Windows 验收报告，不能把启动虚拟机视为启动应用通过。
- **真实 tosu / osu!tourney / OBS 未验证**。没有捆绑或下载这些程序。游戏捕获仍是占位，真实结算旧快照风险与接线边界保留。

## 当时验证的实现

`tools/windows-launcher` 使用 Windigo 建立原生窗口和控件，由 Go 管理后端进程。启动器等待后端就绪及完整会话恢复，核对构建标识和子进程 PID 后才打开默认浏览器。关闭窗口先确认停止输出；关闭浏览器不关服务。重复双击通过 Windows 命名互斥量复用同版本实例；旧版本或未知占用明确提示，不杀其他进程。

原生侧栏包含「概览」「设置」「日志」「关于」。原生测试确认控件随页面切换、切换保留尚未应用的端口输入，并从隔离的本机日志显示最近记录。日志预览仅读取当前文件末尾 48 KiB，打开完整日志沿用原生文件关联。

启动器的 osu!Tourney 生成与启动操作会读取本机服务刚验证的直播授权赛季。Windows 启动器测试使用临时目录验证完整配置、赛季切换、旧配置备份与路径持久化；服务端测试使用合成 Streaming API 验证未授权、切换赛季和断开连接时的结果。真实 osu!stable 和线上授权的联合启动仍待实机验收。

服务就绪后，每 3 秒检查本机地址和子进程标识。超时、HTTP 失败或返回内容不匹配时，窗口显示“等待服务响应”并持续检查，匹配的子进程恢复后更新为就绪。子进程退出由 Windows 进程等待结果确认，此时窗口保留，便于通过“打开本机日志”查看带时间的检查结果、后端 stderr 和退出码。日志保存在 `%LOCALAPPDATA%\OCLR\StreamOverlayLauncher\launcher.log`，保留本份与上一份，各约 1 MiB。原生自动验证用隔离的合成后端复现连续超时、同一 PID 恢复和退出码写入。

启动器分开显示直播服务与 tosu 操作。选择应用程序后将绝对路径保存于独立的本机启动器设置，从该程序目录直接启动 tosu。Win32 文件选择器和设置读写支持中文与空格路径。启动器按完整可执行文件路径识别外部启动的进程，并用所选程序同目录下 `tosu.env` 的 `SERVER_PORT` 检测 `127.0.0.1` 的 TCP 连通状态。Go 测试覆盖路径持久化、同名异路径进程隔离、向本机临时端口连接和配置修改后的重新读取。

`server/portable.js` 是独立的 Windows 便携版入口，监听 `127.0.0.1:3001`，就绪前 UI/API 返回 503。启动器通过父子进程私有 stdin 管道传递已验证的本机 tosu 端口及退出指令。端口变更会结束旧连接并重建游戏数据基线。端口缺失或无效时清除连接。父进程退出或关闭管道会触发后端正常收尾，停止数据订阅并等待持久化队列。

数据路径 `%LOCALAPPDATA%\OCLR\StreamOverlay` 不依赖程序位置或工作目录。启动占位以稳定数据目录计算，多个解压目录不能同时写同一比赛。会话 schema 1 不转换，全部字段、撤销、存档保留；每个新构建首次打开已有会话前保存原始字节到 `backups/<build>/session.json`。旧包旁 `.local` 首次迁移先复制完整会话与 archive 到独立备份，再在目标旁暂存核验、原子改名；损坏/冲突/权限失败保留原记录。已有稳定数据时不被旧副本覆盖。

分发内容采用目录白名单；没有 `.env.local`、凭证、本机比赛、通用 node_modules、模拟器或其他项目内容。附 Node、Go、Windigo、Vue 和字体许可，逐文件 SHA256 清单及 ZIP 校验值。构建标识覆盖前端、服务端、来源层、启动器源码、Go 依赖版本和固定 Node 校验值。更新应先退出旧版，再解压至新目录，不要在运行中覆盖旧程序。

本轮没有改动比赛模型或前端操作行为：图池标记独立、Playing/结算、自动生效、异常核对/重赛/纠错/撤销、初始化存档，以及深紫左红右蓝均沿用原实现。

## Windigo Windows 验证

Historical Win32 and Windigo comparison 可手动运行，在同一台 Windows x64 runner 用相同版本的 Go、Node 与 Python 构建 Win32（`d6f9df4`）与 Windigo（`0014963`）的 ZIP。校验并解压 ZIP 后，工作流用防火墙阻挡解压出来的 `OCLR.exe` 和 `runtime/node.exe` 对外连接，先验证 TCP 探测确实被阻挡，再测试两个包。

比较报告记录两个 ZIP 的字节数。启动时间从进程创建计至本机健康检查返回就绪。无窗口和无参数图形启动分别交错测量，每版五次，取中位数。图形流程确认主窗口可见、四页可切换，并读取旧格式保存的服务端口、tosu 与 osu! 路径。测试从设置页改端口，确认 Go 启动新 PID、旧端口关闭、旧程序路径和比赛记录字节保持一致，再从侧栏退出并确认新端口关闭。本机已从两份实际 ZIP 通过同一图形流程。真实 osu!stable、tosu 及 OBS 的联调仍待独立验证。

## 已执行验证（早期 macOS 实验）

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

Windows 图标嵌入 `OCLR.exe`，同时供文件资源管理器和启动窗口使用。替换 `tools/windows-launcher/assets/oclr-stream.ico` 后，在 `tools/windows-launcher` 重新生成资源并提交 ICO 与 `.syso`。常规打包直接链接已生成的资源。角色署名与授权随包提供，详见 [Liru 授权](../../../tools/packaging/licenses/Liru-CC-BY-4.0.txt)。

```sh
go run github.com/tc-hib/go-winres@v0.3.3 make --in assets/winres.json --arch amd64 --out icon
```

在 Windows 开发/验收机执行（使用包内运行时，无需安装 Node）：

```powershell
& .\release\OCLR-Windows-x64\runtime\node.exe tools/packaging/verify_windows.mjs release/OCLR-Windows-x64 release/windows-native.json
```

脚本在 Windows TEMP 下建立隔离的中文/空格程序目录与数据目录，执行原生 exe 首启、重复启动、SSE、退出、目录更新保留、端口占用、旧服务拒绝、损坏记录和 smoke-test，报告含每项结果。测试通过仍需人工补测正常 GUI 模式的浏览器自动打开、重复双击、复制地址、关闭网页后输出、关闭确认、键盘导航及高 DPI。

### 初版发布流程（历史）

以下是早期按 main 提交逐一打包的记录。现行流程打包推送至 `release/windows` 的最新提交，详见[发布说明](../../windows-release.md)。

`windows-release.yml` 在推送到 `main` 后触发。一次推送包含多个主线提交时，按 `main` 的第一父提交链为每个新增提交分别打包。合并提交以其最终内容打包，分支内的开发历史沿用各自的 PR 检查。单次推送的 GitHub Actions 矩阵上限为 256 个主线提交。

`windows-portable.yml` 安装锁定依赖、构建 ZIP、运行回归测试，并在 Windows runner 校验和解压该 ZIP，用包内 Node 执行 EXE 启动、同步、退出和资料恢复检查。PR 与手动触发会提供验证工件。主线推送的每个提交独立验证和发布，成功后由单独的发布任务在 [GitHub Releases](https://github.com/OCLR-dev/OCLR-stream-overlay/releases) 上传 ZIP 与 SHA-256 校验值。发布标签从 `v0.0.1` 连续递增，标题为 `v0.0.N · Windows x64`，保留 Pre-release 标识。编号按首次 Windows 发布提交 `e52dd726` 开始的 main 第一父提交链计数，构建完成顺序不影响版本号，重跑复用同一版本。既有三个版本已按提交顺序编号为 v0.0.1～v0.0.3，旧 windows-SHA Git 标签继续保留以追溯源码。

每个预览版本的发布说明链接到对应的 Actions 运行。CI 验证报告由该运行提供，真实 tosu／OBS 与原生交互验收仍需在直播机确认。

## 后续服务器部署边界

当前服务仍是本机可信边界，不开放公网。远端服务器无法读取直播电脑的 `127.0.0.1:24050`；未来需要本地 tosu 数据桥接、身份验证、授权控制、断线重连和状态恢复设计。本轮未增加这些入口，也没有用监听 `0.0.0.0` 冒充服务器支持。

构建来源：[Node 官方固定版本下载](https://nodejs.org/dist/v22.23.4/)、[Go 官方下载](https://go.dev/dl/)。CI 设置参考 [setup-go](https://github.com/actions/setup-go)、[setup-node](https://github.com/actions/setup-node)。

## 服务端口与 OBS 地址同步（#36，2026-11-15）

- `npm test`：542 项通过；测试使用隔离随机端口，不占用已有 3001 服务。
- `npm run build`：类型检查与生产构建通过。
- Windows Go 启动器：`go test ./...` 与编译通过；涵盖端口范围、持久化及与现有程序路径设置共存。
- 使用开发运行时 Node 24.22.1 组装的 synthetic Windows 包，在 `OCLR_VERIFY_PORT=3011` 下完成 13 项原生启动器验证：中文及空格路径、单实例复用、SSE、重启保留比赛与撤销、占用端口不影响其他程序、旧后端隔离、损坏数据保留和健康检查超时恢复等均通过。这不是正式发布包验收。
- 尚未完成可见启动器界面操作、真实 OBS／OCLR 重连与正式发布包验收。Go race 检查因环境未启用 CGO 未运行。

### OBS 自动同步补充（2026-11-15）

连接 OBS、服务重启后重连、切换场景集合时自动检查浏览器源。`localhost` 与 `127.0.0.1` 均可识别；只修改匹配的本机 `/overlay`、`/showcase` 端口，保留查询参数、片段及其他来源设置。每个共享来源只更新一次，不重建场景，不改变 Program、位置、尺寸或锁定状态。其他网站、弹幕和未识别端口不变。OBS 未开启时等待重连，写入失败沿用连接重试流程。

合成验证：545 项 Node 测试通过，包含自定义端口跨重启保存、集合切换、别名、参数保留、无关来源隔离、重复同步与失败后重试。真实 OBS 画面仍待实机验收。
