# OCLR Overlay · Custom-Match

面向社区自办 osu! 赛事的本地直播画面与导播控制台。支持本地配置赛事名称、阶段、奇数 BO、两队名单、图池（含 CA 槽位）与自定义 BP 规则，将本场配置、tosu 实时游戏数据与本机比赛记录合成为 1920×1080 的 OBS 只读浏览器源。本版使用独立会话，不加载 OCLR 网站授权与赛事 API。

Windows 桌面端基于 Wails + Vue 构建（需 Microsoft Edge WebView2 Runtime），启动即进入直播控制台，顶部可切换 Showcase、服务、设置、日志和关于；桌面端与浏览器共用本机 Node 服务保存比赛。发行包于 `tosu/` 目录内置官方 tosu 正式版，启动器默认识别包内程序，同时保留有效的自选路径。[Windows 使用说明](docs/custom-match-windows.md)

Windows 默认将比赛保存在 `%LOCALAPPDATA%\OCLR\CustomMatchTest`（启动器设置位于同级 `CustomMatchTestLauncher`）。在桌面「设置 → 资料存储」可启用完全便携模式，首次启用会复制现有资料，后续统一保存在 `OCLR-Custom-Match.exe` 同级的 `OCLR-data`。[更新与存储说明](docs/custom-match-windows.md#更新与存储)

## 开播

1. 从 [GitHub Actions](https://github.com/OCLR-dev/OCLR-stream-overlay/actions/workflows/windows-portable.yml?query=branch%3Atest%2Fcustom-match+event%3Apush) 下载最新成功运行的 `OCLR-Custom-Match-Windows-x64` 产物，完整解压后双击 `OCLR-Custom-Match.exe` 启动桌面控制台。安装、接线与更新见 [Windows 使用说明](docs/custom-match-windows.md)。
2. 在「比赛配置 → 本场资料」录入赛事标题、阶段名称、奇数 BO（1–31）、红蓝队名及名单、本场图池与 BP 规则。见 [配置步骤与 BP 格式](docs/custom-match.md)。
3. 在「游戏数据」确认 tosu 与赛事客户端连接，在「OBS」配置比赛场景与弹幕源，并在 OBS 节目画面（Program）与混音器中核对游戏捕获、弹幕和声音。Windows 比赛预设默认启用应用音频源，匹配到唯一的 osu!tourney Client 0 后自动收音。连接 OBS 后，控制台右侧实时显示节目画面、推流与录制状态，并在切至休息场景时提供返场按钮；未连接时显示「Overlay 预览」。

| 用途 | 默认本机地址 |
| --- | --- |
| 导播操作比赛 | [控制台](http://127.0.0.1:3011/control) |
| OBS 比赛画面源 | [比赛输出](http://127.0.0.1:3011/overlay) |
| 配置 Showcase 图池、Stage 与回放过场 | [Showcase 操作页](http://127.0.0.1:3011/showcase) |
| OBS Showcase 画面源 | [Showcase 播出页](http://127.0.0.1:3011/showcase?clean=1) |
| 独立查看演示数据与视觉控件 | [演示页](http://127.0.0.1:3011/) |

若在桌面端修改了服务端口，请以启动窗口给出的地址为准。控制台与比赛输出订阅同一本机会话：关闭控制台网页后，OBS 继续播出，直播服务继续自动打点；停录后可在「录像打点」复制时间轴。[节目预览与录像操作](docs/custom-match.md#obs-节目画面与录像打点)

## 比赛与图池演示

- **正赛**：支持从到场、Roll 和 BP 完整跟进，也支持中途接入正在 Playing 的房间。图池管理 Ban/Pick 与 TB，Playing 管理当局成绩与系列比分，Ranking 沿用 Playing 捕获布局；暂停、撤销与比赛纠错均在控制台完成。[BP 格式与规则](docs/custom-match.md#bp-格式) · [自由操作与中途加入](docs/main-operator-contract.md)
- **Showcase**：使用普通 osu! 客户端播放回放（`.osr`）。图池可手动录入或复制控制台已加载图池，拖入本地 `.osr` 文件后核对回放清单；开启自动过场后，待状态显示「遮挡已确认」再点「播放下一张」。[Showcase 回放清单](docs/custom-match.md#showcase-回放清单)

## 本地开发

环境要求 Node.js 22.13+，首次运行执行 `npm ci`。前端位于 `ui/`，数据源适配位于 `src/`，比赛状态与持久化位于 `server/session/`，OBS 联动位于 `server/obs/`，自定义赛事服务入口为 `server/custom-match.js`（会话独立保存在 `.local/custom-match/session.json`）。

| 目的 | 在仓库根目录运行 |
| --- | --- |
| 构建并启动自定义赛事服务 | `npm run build && npm run custom` |
| 使用隔离游戏信号模拟器运行 | `npm run build && npm run custom -- --simulate`（模拟器默认在 [24054](http://127.0.0.1:24054/)） |
| 热更新开发 UI | 先启动 `npm run custom`（可加 `-- --simulate`），另一终端运行 `npm run dev`，打开 [热更新控制台](http://127.0.0.1:3003/control) |
| 监听源码变更并更新模拟构建 | `npm run watch -- --simulate` |
| 类型检查、构建与运行测试 | `npm run build && npm test`（`build` 已包含类型检查） |
| 验证 WebSocket 或诊断结算时序 | `npm run sim:test` 或 `npm run sim:timing` |
| 采集直播机游戏信号 | `npm run tosu:record -- --duration 180` |
| 打包 Windows 便携版 | `python tools/packaging/build_windows.py --custom-match`（见 [下载与定制打包](docs/custom-match-windows.md#下载与定制打包)） |

已有真实采样的回放方法见 [Windows tosu 采样说明](test-data/tosu/windows-2026-10-31/README.md)。

## 维护文档

| 查阅内容 | 入口 |
| --- | --- |
| 修改项目时遵循的约定 | [AGENTS.md](AGENTS.md) |
| 播出视觉、捕获尺寸与各页职责 | [当前设计](DESIGN.md) |
| 自定义赛事配置、BP 与 OBS 打点 | [自定义赛事说明](docs/custom-match.md) · [Windows 使用说明](docs/custom-match-windows.md) |
| 本场状态、异常与赛果纠错 | [自由操作约定](docs/main-operator-contract.md) · [异常处理](docs/design/match-incidents.md) |
| 待办功能、已完成事项与旧方案 | [项目待办与设计索引](docs/design/backlog.md) |
| 测试、截图与实机记录 | [自定义版验收记录](docs/verification/custom-match/README.md) · [分项验收目录](docs/verification/) |

## 致谢

前端 UI/UX 方案由 Claude 与 Gemini 提供，后端数据方案由 GPT 提供。

## 许可证

自有代码与文档采用 [MIT License](LICENSE)。字体、素材和依赖的授权见[第三方声明](THIRD_PARTY_NOTICES.md)与[随包许可证](tools/packaging/licenses/)。
