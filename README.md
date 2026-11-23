# OCLR 直播 Overlay

这套工具把 OCLR 对阵和图池、tosu 读到的游戏数据、导播在本机记录的比赛进度合成一套 osu! 比赛画面。导播使用桌面或浏览器控制台，OBS 使用独立的 1920×1080 浏览器源。

Windows 启动窗口使用 Wails + Vue，启动后直接显示直播控制台。顶部可切换 Showcase、服务、设置、日志和关于。桌面和浏览器共用 Node 服务保存比赛，外部授权使用系统浏览器。Windows 需要 Microsoft Edge WebView2 Runtime。见 [桌面控制台验收](docs/verification/desktop-control/README.md)。

Windows 包附带打包时最新的官方 tosu Windows 正式版，位于 `tosu/`。启动器默认识别包内程序，保留有效的自定义路径；新包附带 `tosu.env`，默认端口为 24050。左上角和关于页使用与应用窗口一致的正式图标。详见 [随包 tosu 与图标验证](docs/verification/bundled-tosu/README.md)。

Windows 默认将设置和比赛保存在 `%LOCALAPPDATA%\OCLR`。在桌面「设置 → 资料存储」可启用完全便携模式，首次复制现有设置与比赛，之后将资料保存在 `OCLR.exe` 旁的 `OCLR-data`。[存储与更新说明](docs/windows-portable.md#资料存储与更新)

## 开播

1. Windows 直播机从 [GitHub Releases](https://github.com/OCLR-dev/OCLR-stream-overlay/releases) 下载 `OCLR-Windows-x64.zip`，全部解压后双击 `OCLR.exe`。等待桌面控制台载入。安装、接线与更新见 [Windows 直播员手册](docs/windows-portable.md)。
2. 在「比赛配置 → 本场资料」登录 OCLR，预览自己被指派的场次，点「使用所选直播任务」。核对双方、本场图池、赛制和实际上场名单。任务导入队伍身份、可用队旗和公开注册名单。注册名单用于等待页，上场名单由导播核对录入。见 [直播任务与表演赛](docs/streaming-api.md)。
3. 在「游戏数据」查看 tosu 和房间，在「OBS」配置比赛场景与弹幕。在 OBS 的节目画面（Program）核对游戏捕获和弹幕，在混音器核对游戏声音。Windows 比赛预设默认启用应用音频源，找到唯一的 osu!tourney Client 0 后自动收音。连接 OBS 后，控制台右侧显示当前节目画面、推流与录制状态，并在休息场景提供返场按钮。未连接时显示「Overlay 预览」。

| 要做的事 | 默认本机地址 |
| --- | --- |
| 导播操作比赛 | [控制台](http://127.0.0.1:3001/control) |
| 在 OBS 播出比赛 | [比赛输出](http://127.0.0.1:3001/overlay) |
| 准备 Showcase 图池、Stage 与回放过场 | [Showcase 操作页](http://127.0.0.1:3001/showcase) |
| 在 OBS 播出 Showcase | [Showcase 播出页](http://127.0.0.1:3001/showcase?clean=1) |
| 单独查看演示数据和视觉控件 | [演示页](http://127.0.0.1:3001/) |

便携版更改端口后使用启动窗口给出的地址。比赛输出与控制台订阅同一个本机会话，关闭控制台网页后，OBS 继续播出，直播服务继续自动打点。停录后在「录像打点」复制时间轴。[节目预览与录像操作](docs/main-operator-contract.md#obs-节目画面与录像打点)

## 比赛与图池演示

- **正赛**可以从到场、Roll 和 BP 开始，也可以中途接入正在 Playing 的房间。图池管理 Ban/Pick 和 TB，Playing 管理当局比分与成绩。Ranking 沿用 Playing 捕获布局。暂停、撤销和比赛纠错都在控制台。[现场操作与中途加入](docs/main-operator-contract.md)
- **Showcase** 使用普通 osu! 客户端播放 rep。图池可手动录入、复制控制台已加载的图池，或导入网站授权的图池。在演示图池核对回放清单。开启自动过场后，等「遮挡已确认」再点「播放下一张」。[授权导入](docs/streaming-api.md#从网站导入-showcase-图池) · [OBS 过场操作](docs/windows-portable.md#showcase-回放过场)

## 本地开发

使用 Node.js 22.13+。首次运行执行 `npm ci`。前端在 `ui/`，来源适配在 `src/`，比赛状态和持久化在 `server/session/`，OBS 联动在 `server/obs/`。

| 目的 | 从仓库根目录运行 |
| --- | --- |
| 构建并启动正式服务 | `npm run build`，然后 `npm start` |
| 使用游戏信号模拟器开发 UI | 分别在两个终端运行 `npm run sim` 和 `npm run dev`，打开 [热更新控制台](http://127.0.0.1:3003/control) |
| 监听源码并更新构建版 | `npm run watch` |
| 检查类型、构建和运行测试 | `npm run build` 包含类型检查，构建后运行 `npm test` |
| 验证 WebSocket 或诊断结算时序 | `npm run sim:test` 或 `npm run sim:timing` |
| 采集直播机游戏信号 | `npm run tosu:record -- --duration 180` |

模拟器默认使用控制台端口 3005、tosu 端口 24051。普通模拟只替代游戏信号，赛事资料仍按所选赛季读取。隔离回归可用 `npm run sim -- --offline-oclr`。已有采样的回放方法见 [Windows tosu 采样说明](test-data/tosu/windows-2026-10-31/README.md)。

## 维护文档

| 查什么 | 入口 |
| --- | --- |
| 修改项目时遵循的约定 | [AGENTS.md](AGENTS.md) |
| 播出视觉、捕获尺寸和各页职责 | [当前设计](DESIGN.md) |
| 本场状态、异常和赛果纠错 | [操作约定](docs/main-operator-contract.md) · [异常处理](docs/design/match-incidents.md) |
| 准备实施的功能、已完成事项和旧方案 | [项目待办与设计索引](docs/design/backlog.md) |
| 某次改动的测试、截图与实机记录 | [分项验收记录](docs/verification/) |
| 构建和发布 Windows 包 | [Windows 发布分支](docs/windows-release.md) |

主线文档随源码更新。使用便携包时，随包的《使用说明.txt》和 Release 标注的提交对应这次构建。

## 许可证

自有代码与文档采用 [MIT License](LICENSE)。字体、素材和依赖的授权见[第三方声明](THIRD_PARTY_NOTICES.md)与[随包许可证](tools/packaging/licenses/)。
