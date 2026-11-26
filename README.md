# OCLR 直播 Overlay

将 OCLR 赛事资料、tosu 实时游戏数据与本机比赛记录合成为 1920×1080 的 osu! 直播画面。导播在桌面端或浏览器控制台操作比赛，OBS 通过独立的只读浏览器源播出。

Windows 桌面端基于 Wails + Vue 构建（需 Microsoft Edge WebView2 Runtime），启动即进入直播控制台，顶部可切换 Showcase、服务、设置、日志和关于；桌面端与浏览器共用本机 Node 服务保存比赛，外部账号授权通过系统浏览器完成。发行包于 `tosu/` 目录内置官方 tosu 正式版与默认配置（端口 `24050`），启动器自动识别包内程序，同时保留有效的自定义路径。[桌面控制台验收](docs/verification/desktop-control/README.md) · [随包 tosu 说明](docs/verification/bundled-tosu/README.md)

Windows 默认将设置和比赛保存在 `%LOCALAPPDATA%\OCLR`。在桌面「设置 → 资料存储」可启用完全便携模式，首次启用会复制现有设置与比赛，后续统一保存在 `OCLR.exe` 同级的 `OCLR-data`。[存储与更新说明](docs/windows-portable.md#资料存储与更新)

## 开播

1. 从 [GitHub Releases](https://github.com/OCLR-dev/OCLR-stream-overlay/releases) 下载 `OCLR-Windows-x64.zip`，完整解压后双击 `OCLR.exe` 启动桌面控制台。安装、接线与更新见 [Windows 直播员手册](docs/windows-portable.md)。
2. 在「比赛配置 → 本场资料」登录 OCLR，预览指派场次并点击「使用所选直播任务」，核对对阵双方、赛制、图池与实际上场名单。任务会自动导入队伍标识、可用队旗及公开注册名单（注册名单用于等待页展示，实际上场名单由导播核对录入）。见 [直播任务与表演赛](docs/streaming-api.md)。
3. 在「游戏数据」确认 tosu 与房间连接，在「OBS」配置比赛场景与弹幕源，并在 OBS 节目画面（Program）与混音器中核对游戏捕获、弹幕和声音。Windows 比赛预设默认启用应用音频源，匹配到唯一的 osu!tourney Client 0 后自动收音。连接 OBS 后，控制台右侧实时显示节目画面、推流与录制状态，并在切至休息场景时提供返场按钮；未连接时显示「Overlay 预览」。

| 用途 | 默认本机地址 |
| --- | --- |
| 导播操作比赛 | [控制台](http://127.0.0.1:3001/control) |
| OBS 比赛画面源 | [比赛输出](http://127.0.0.1:3001/overlay) |
| 配置 Showcase 图池、Stage 与回放过场 | [Showcase 操作页](http://127.0.0.1:3001/showcase) |
| OBS Showcase 画面源 | [Showcase 播出页](http://127.0.0.1:3001/showcase?clean=1) |
| 独立查看演示数据与视觉控件 | [演示页](http://127.0.0.1:3001/) |

若在便携版修改了端口，请以启动窗口给出的地址为准。控制台与比赛输出订阅同一本机会话：关闭控制台网页后，OBS 继续播出，直播服务继续自动打点；停录后可在「录像打点」复制时间轴。[节目预览与录像操作](docs/main-operator-contract.md#obs-节目画面与录像打点)

## 比赛与图池演示

- **正赛**：支持从到场、Roll 和 BP 完整跟进，也支持中途接入正在 Playing 的房间。图池管理 Ban/Pick 与 TB，Playing 管理当局成绩与系列比分，Ranking 沿用 Playing 捕获布局；暂停、撤销与比赛纠错均在控制台完成。[现场操作与中途加入](docs/main-operator-contract.md)
- **Showcase**：在「服务 → 比赛工具 → osu!Stable」选择独立安装的普通客户端，用于播放回放（`.osr`）。创建 OBS Showcase 场景时会建立居中并锁定的游戏捕获，以及预设启用的 osu!Stable 应用程序音频。图池可手动录入、复制控制台已加载图池，或从网站授权导入。在演示图池核对回放清单；开启自动过场后，待状态显示「遮挡已确认」再点「播放下一张」。[授权导入](docs/streaming-api.md#从网站导入-showcase-图池) · [OBS 过场操作](docs/windows-portable.md#showcase-回放过场)

## 本地开发

环境要求 Node.js 22.13+，首次运行执行 `npm ci`。前端位于 `ui/`，数据源适配位于 `src/`，比赛状态与持久化位于 `server/session/`，OBS 联动位于 `server/obs/`。

| 目的 | 在仓库根目录运行 |
| --- | --- |
| 构建并启动正式服务 | `npm run build && npm start` |
| 搭配游戏信号模拟器开发 UI | 分别在两个终端运行 `npm run sim` 与 `npm run dev`，打开 [热更新控制台](http://127.0.0.1:3003/control) |
| 监听源码变更并自动更新构建 | `npm run watch` |
| 类型检查、构建与运行测试 | `npm run build && npm test`（`build` 已包含类型检查） |
| 验证 WebSocket 或诊断结算时序 | `npm run sim:test` 或 `npm run sim:timing` |
| 采集直播机游戏信号 | `npm run tosu:record -- --duration 180` |

模拟器默认使用控制台端口 `3005`、tosu 端口 `24051`。常规模拟仅替代游戏信号，赛事资料仍按所选赛季读取；完全离线的隔离回归可使用 `npm run sim -- --offline-oclr`。已有真实采样的回放方法见 [Windows tosu 采样说明](test-data/tosu/windows-2026-10-31/README.md)。

## 维护文档

| 查阅内容 | 入口 |
| --- | --- |
| 修改项目时遵循的约定 | [AGENTS.md](AGENTS.md) |
| 播出视觉、捕获尺寸与各页职责 | [当前设计](DESIGN.md) |
| 本场状态、异常与赛果纠错 | [操作约定](docs/main-operator-contract.md) · [异常处理](docs/design/match-incidents.md) |
| 待办功能、已完成事项与旧方案 | [项目待办与设计索引](docs/design/backlog.md) |
| 某次改动的测试、截图与实机记录 | [分项验收记录](docs/verification/) |
| 构建与发布 Windows 便携包 | [Windows 发布分支](docs/windows-release.md) |

主线文档随源码同步更新；使用便携包时，随包的《使用说明.txt》与 Release 标注的提交对应当次构建。

## 致谢

前端 UI/UX 方案由 Claude 与 Gemini 提供，后端数据方案由 GPT 提供。

## 许可证

自有代码与文档采用 [MIT License](LICENSE)。字体、素材和依赖的授权见[第三方声明](THIRD_PARTY_NOTICES.md)与[随包许可证](tools/packaging/licenses/)。
