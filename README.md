# OCLR 直播 Overlay

专为 [OCLR](https://oclr.org/streaming/s11) 赛事打造的 osu! 直播画面与导播控制系统。项目基于 Vue 3、Vite、TypeScript 与 Node.js 构建，包含**独立直播员控制台**、**OBS 1920×1080 播出界面**与**图池 Showcase 演示系统**，支持从 OCLR 官网一键拉取直播任务、通过 `tosu` 自动跟随比赛进程、联动 OBS 切换常规/EX 场景，并提供免安装开发环境的 Windows 便携包。

---

## 核心特性

- **开箱即用的 Windows 便携版**：内置前端、Node.js 运行时与原生启动器（`OCLR.exe`），解压即用；支持记忆 `tosu` 与 `osu!stable` 路径，一键生成 `tournament.cfg` 并拉起 `osu!Tourney`。
- **全流程自动化与随时人工接管**：服务端统一订阅 `tosu` 数据，自动完成房间队名识别、换图跟随、开打切入、结算展示与计胜（含 FM 中 EZ 模组 `×1.5` 分数补偿）；直播员可随时手动切画面、改 BP、处理重赛或校正比分，支持中途加入已有比赛。
- **OBS 场景与 B 站弹幕一键配置**：直接连接本机 OBS，一键创建共用浏览器源的 4v4 常规八路与 EX 六路比赛场景，粘贴 B 站直播身份码即可自动挂载并复用 `STREAM CHAT` 弹幕源。
- **独立图池 Showcase 模式**：与正式比赛记录完全隔离，支持录入或一键复制图池，连接普通客户端播放单图或回放（rep）时自动匹配 Slot 并展示谱面封面与参数。
- **无 `tosu` 本地全链路模拟器**：内置 `tosu` WebSocket 模拟器与时序探测工具，无需开启游戏客户端即可结合真实 OCLR 历史赛程调试 UI、演练比分拉扯与注入异常。

---

## 快速上手：我是直播员（Windows 便携版）

如果你负责赛事直播，不需要安装 Node.js 或任何开发工具，直接使用便携版即可（完整图文步骤见 [直播员使用说明](docs/windows-portable.md)）：

1. **下载与启动**：前往 [GitHub Releases](https://github.com/OCLR-dev/OCLR-stream-overlay/releases) 下载最新的 `OCLR-Windows-x64.zip`，**完整解压**后双击 `OCLR.exe` 打开原生启动窗口（退出时请通过启动窗口按钮关闭）。
2. **检查端口与路径**：
   - **「概览」**：查看当前服务运行状态，一键打开控制台或复制全部浏览器源地址（控制台、Overlay 与 Showcase）。
   - **「设置」**：默认服务端口为 `3001`。若端口冲突，可修改为 `1–65535` 之间的端口并点击「重新启动 / 重试」（比赛记录完整保留，重连 OBS 后会自动同步本机浏览器源端口，OCLR 授权重连一次即可）。在此处选择并记住本机 `tosu` 与 `osu!stable` 的程序路径，端口检测会自动读取同目录下 `tosu.env` 的 `SERVER_PORT`。
   - **「日志」**：预览最近运行日志、健康检查状态或打开完整日志文件。
3. **赛前配置（控制台 `http://127.0.0.1:3001/control`）**：
   - **OCLR 直播任务**：在「开播前设置 → OCLR 直播任务」点击登录并前往 [S11 直播授权](https://oclr.org/streaming/s11) 完成授权，无需手动复制 Key。连接后选择你的直播场次（支持正赛与已指派的公开[表演赛](docs/streaming-api.md#表演赛)），确认后即可一键导入红蓝双方、队旗、名单、图池与赛制，并可一键生成该赛季 `tournament.cfg` 启动 `osu!Tourney`（详见 [OCLR 登录与直播任务](docs/streaming-api.md)）。
   - **OBS 与弹幕配置**：在「OBS 与播出画面」连接本机 OBS，展开「场景与捕获窗口」即可一键创建常规八路与 EX 六路场景（或绑定已有场景，详见 [OBS 跟随 EX 说明](docs/windows-portable.md#obs-跟随-ex)）。粘贴 B 站身份码即可自动配置右下角弹幕框（详见 [直播间弹幕设置](docs/windows-portable.md#b-站直播间弹幕)）。
   - **OBS 浏览器源固定地址**：播出画面始终使用 `http://127.0.0.1:3001/overlay`（画幅 `1920×1080`，只读输出，请勿在 URL 后加固定 `#scene`）。比赛数据自动保存在 `%LOCALAPPDATA%\OCLR\StreamOverlay`。

---

## 现场导播与比赛操作指南

正常直播以**自动跟随**为主（自动 Ban/Pick、自动切画面、自动计胜三个开关在「游戏连接」中可独立控制），同时左侧管理面板与顶部常驻栏支持随时人工介入（设计规范见 [自由操作与中途加入](docs/main-operator-contract.md)）。

### 1. 画面切换与赛前/赛中设置
- **常驻快捷键与按钮**：主界面顶部常驻 5 个播出画面按钮（快捷键 `Alt+1` 至 `Alt+5`：等待、Roll、图池、Playing、Winner）以及独立暂停、热身开关、双方开启/关闭 EX 和 EX 次数加减按钮。切画面无需进二级菜单，也不会误触发计胜或扣除 EX 次数。
- **即改即同步**：在「本场设置」修改比赛阶段（自动切换 BO11/BO13 与先赢目标）、标题、队名、名单或图池时，下拉框立即生效，文本框停顿 `450ms` 或失焦后自动同步到输出端，无需点保存。

### 2. 图池 Ban / Pick、EX 与 TieBreaker (TB)
- **自由顺序操作**：图池面板只有一组红蓝队伍的 Ban/Pick 按钮，既可以**先选动作再点图**（服务端会按该动作自动跟随房间的下一次有效换图），也可以**先点图再选动作**；不受前置 BP 顺序锁定限制，支持中途开播直接指定当前 Pick。
- **EX 机制**：普通图准备期可手动开启双方 EX（TB 禁用）。开启或关闭本身不扣次数，只有当该次 Pick 正常决出胜负后才扣除 1 次；同图重赛会自动撤回原消耗，修改胜方不会重复扣减（详见 [EX 常用操作与谱面封面验证](docs/verification/ex-artwork/README.md)）。
- **决胜局（TB）**：达到决胜比分后，在图池点击 `TieBreaker` 单独准备 TB（无 Pick 方，禁用 Ban/EX）。常规图打满（BO11 打完 10 图 / BO13 打完 12 图）后会等待核对，不会把下一次普通选图误判为 TB。
- **模组参数与特殊计分**：Playing 画面优先读取 `tosu` 实时星级与四维（CS/HP/AR/OD）转换值，并自动加载 `tosu` 背景或 osu! 官方封面（详见 [模组参数与图池标签](docs/verification/mod-parameters-labels/README.md)）。FM 模式下使用 EZ 的选手分数由系统自动按 `×1.5` 逐人四舍五入后汇总，实时队分、分差与结算统一口径（详见 [FM EZ 计分补偿](docs/verification/fm-ez-scoring/README.md)）。

### 3. 异常处理与逆向纠错
当比赛出现突发状况时，无需重启服务或清空重来（设计细节见 [本图异常与观战恢复](docs/design/match-incidents.md)）：
- **开打前/中途返回房间**：若裁判中止比赛且房间连续返回准备状态（Ready），系统会自动保留当前选图、BP、EX 与比分并回到准备状态，无需手动点重赛（详见 [返回准备验收](docs/verification/ready-return/README.md)）。
- **单人掉线或观战重载（Panic）**：若仅选手掉线而房间仍在比赛，系统会挂起自动计胜并提示人工核对；若直播机观战重载后同图同组选手分数恢复，会自动接回原局。
- **同分平局与重赛**：一局结束双方总分相同时，控制台会提示先与裁判核对。需重赛时点击「处理异常 → 裁判已要求重赛本图」；若为允许平局的表演赛，可直接点击「记录本图平局」。
- **三大赛果纠错入口**（位于「比赛记录」，均保留修订历史并支持一键「撤销最近一项修改」）：
  1. **撤回本局计胜**：减去该局比分贡献并恢复为待结算状态（旧 Ranking 帧不会把分数自动加回）。
  2. **修正胜方**：直接更改某局胜负归属（或平局）及赢图标记，不重放 `tosu` 事件。
  3. **人工校正系列比分**：直接输入整数修改大比分，立即生效并在后续赢图时在此基础上累加。
- **中途初始化**：「开播前设置 → 管理比赛记录」提供「全部撤销」与「初始化」（默认先自动存档至 `.local/archive/`）。勾选保留当前房间连接即可在清空记录后继续无缝跟随当前比赛。

---

## 独立图池演示（Showcase 模式）

需要录制或直播图池演示时，点击控制台右上角的**「Showcase · 图池演示」**（或直接访问 `http://localhost:3001/showcase`）进入独立工作台。Showcase 数据单独保存在 `showcase.json`，**绝不会修改或污染正式比赛的 BP、比分和场景**（详见 [Showcase 入口与场景操作](docs/verification/showcase-entry/README.md) 与 [Showcase 验证](docs/verification/showcase/README.md)）。

1. **录入演示图池**：可一键点击「复制控制台已加载图池」，或按每行 `Slot 谱面ID或链接 标题（可选）` 格式手动输入（如 `NM1 4278199 eclosion`，支持带 `#osu/难度ID` 的官网链接），在左侧填写独立的「当前 Stage」名称，失焦即自动同步。
2. **一键建立 OBS 场景**：在页面顶部连接 OBS，点击「创建 OCLR · Showcase 场景」，会自动生成 `OCLR · Showcase` 场景与 `1920×1080` 的 `/showcase?clean=1` 洁净浏览器源（并自动复用已有弹幕源）。你只需在浏览器源上方添加一个游戏窗口采集源，居中放置在中央约 `800px` 高的留白区域即可。
3. **自动跟随谱面**：用 `tosu` 连接普通 osu! 客户端，在游戏内选图或播放回放（rep），Showcase 会按谱面 ID 自动高亮对应 Slot 并同步曲名、难度、封面与四维参数，无需手动切图。

---

## 开发者与维护指南

### 环境要求与常用命令

项目要求 **Node.js `>= 22.13.0`**。首次克隆仓库后执行 `npm ci` 安装依赖：

| 场景 | 命令 | 说明 |
| :--- | :--- | :--- |
| **生产构建与正式运行** | `npm run build && npm start` | 编译前端并启动本地服务（默认监听 `127.0.0.1:3001`） |
| **自动监听构建 + 模拟器** | `npm run watch` | 首次自动 `build` 并启动模拟服务；修改 `ui/` 静默 5 秒后自动重编，修改 `server/` 自动重启模拟服务 |
| **前端热更新开发** | `npm run sim` + `npm run dev` | 终端 1 启动模拟器（默认 API `3005` / WS `24051`），终端 2 启动 Vite 热更新（访问 `http://127.0.0.1:3003/control`） |
| **无 `tosu` 模拟测试** | `npm run build && npm run sim` | 启动模拟器面板（[`127.0.0.1:24051`](http://127.0.0.1:24051/)）、模拟控制台（[`3005/control`](http://127.0.0.1:3005/control)）与输出（[`3005/overlay`](http://127.0.0.1:3005/overlay)） |
| **类型检查与单元测试** | `npm run check && npm run build && npm test` | 执行类型检查、构建及 `test/` 下的全部 Node 测试（便携版测试需要构建产物） |
| **WebSocket 与结算时序测试** | `npm run sim:test` / `npm run sim:timing` | 运行 8 项真实 WS 测试，或对抗探测 17 种结算先后顺序时序风险 |
| **真实直播机信号录制** | `npm run tosu:record -- --duration 180` | 录制指定秒数的真实 IPC、各路分数与人工事件标记 |

### 页面路由一览（以默认 `3001` 端口为例）

- **直播员控制台**：[`http://localhost:3001/control`](http://localhost:3001/control) — 画面管理、内嵌只读预览、赛前配置与异常纠错。
- **OBS 比赛输出**：[`http://localhost:3001/overlay`](http://localhost:3001/overlay) — `1920×1080` 只读输出页面，通过 SSE 接收服务端状态快照。
- **图池 Showcase**：[`http://localhost:3001/showcase`](http://localhost:3001/showcase) — 图池演示控制台（OBS 浏览器源请填 `/showcase?clean=1`）。
- **独立视觉演示**：[`http://localhost:3001/`](http://localhost:3001/) — 携带独立演示数据与评审控件，不影响正式比赛会话。

### 本地模拟与离线调试说明

- **模拟器工作方式**：`npm run sim` 仅替代 `tosu` 客户端信号（连接 `ws://127.0.0.1:24051/websocket/v2`），赛事资料仍可通过 `.env.local` 配置的 OCLR 只读 API 拉取（例如输入 `s10` 读取真实历史赛季与图池）。你可以在模拟器面板中选图、推送 Playing/Ranking 状态、模拟双方交替领先追分或注入掉线故障。
- **完全离线合成模式**：若需在不联网、无凭证环境下做回归诊断，请追加 `--offline-oclr` 参数（使用隔离临时会话，不请求线上 API）。
- **状态恢复参数**：维护者重启模拟服务时，可附加 `--session-file <session.json>` 与 `--room-file <room.json>` 无损恢复已有对局，或通过 `--app-port` / `--ws-port` 指定端口。
- **匿名采样回放**：UI 贡献者与 Agent 可参考 [匿名化 Windows tosu 采样与回放说明](test-data/tosu/windows-2026-10-31/README.md)（含 10 分钟、3921 帧真实采样数据）进行本地回放验证。
- **打包发布 Windows 便携版**：日常推送 `main` 不会触发打包；将验证通过的提交推进到 `release/windows` 分支后，GitHub Actions 会自动构建并发布 Windows x64 Pre-release（详见 [Windows 发布分支说明](docs/windows-release.md)）。

---

## 项目架构与数据边界

### 核心模块职责

| 路径 | 职责说明 |
| :--- | :--- |
| `server/session/model.js` | 人工操作与 `tosu` 观测的唯一状态写入入口、状态机合法转换与校验 |
| `server/session/rules.js` | 正赛／表演赛的 BP 起点、胜负结束条件、TB／EX 规则与自动计胜资格判定 |
| `server/session/records.js` | Pick／单局 run／赛果身份管理、兼容投影、EX 次数统计与 schema 迁移 |
| `server/session/application.js` | 串行处理中的观测事件、局部异常恢复与人工操作编排 |
| `server/session/presentation.js` | 播出场景自动跟随及提交后的画面显示调度 |
| `server/session/automation.js` | 唯一的房间换图 / Playing / Ranking 观察器（连续性状态仅保存在内存） |
| `server/session/store.js` | 命令队列、`.local/session.json` 原子写入、迁移备份、历史存档与只读快照分发 |
| `server/session/data.js` | 通过 `src/index.js` 接入统一数据层，显式导入 OCLR 已发布赛事资料 |
| `server/session/http.js` | 本机会话读取、SSE 实时推送与严格同源的 `/api/session/command` JSON 写入接口 |
| `ui/components/OperatorConsole.vue` | 独立直播员控制台视图（由 `ui/session.ts` 提供浏览器端会话通信） |
| `ui/useOverlay.ts` | 将共享会话状态接入播出组件，并保持根路径演示模式独立 |

### 数据安全与隔离原则

- **三方数据严格分离**：**OCLR 官网只读资料**、**`tosu` 实时帧**与**本地人工播出记录**彼此隔离。API 定时刷新只更新来源健康度与可选资料，绝不覆盖已确认的本场 BP 与比分；本项目不生成 `bracket.json`、不回写官网赛果、不直连数据库。
- **原子存储与防损坏**：本场状态保存在 `.local/session.json`（已被 Git 忽略且不通过 HTTP 暴露），采用原子替换写入；若检测到文件损坏会拒绝启动，防止静默覆盖历史记录。
- **凭证不落前端**：`.env.local`（可参考 `.env.example` 创建）中的 API Key 或网页端 OAuth 授权仅保存在服务端内存，绝不进入浏览器 URL、前端代码、日志或 Git 仓库。后端仅监听 `127.0.0.1` 并严格限制静态文件白名单。

---

## 设计与验收文档索引

想要深入了解某个具体模块的设计细节或历史验收记录，可直接查阅以下文档：

- **上手与操作文档**：[直播员使用说明 (Windows 便携版)](docs/windows-portable.md) · [直播 API 与表演赛说明](docs/streaming-api.md) · [自由操作与中途加入规范](docs/main-operator-contract.md) · [Windows 发布分支流程](docs/windows-release.md)
- **架构与设计方案**：[控制台设计方案](docs/design/operator-console-plan.md) · [BP 自动跟随方案](docs/design/bp-automation-plan.md) · [tosu 信号调查](docs/design/tosu-auto-scene-research.md) · [本图异常与观战恢复](docs/design/match-incidents.md) · [后续改进与待处理事项 (Backlog)](docs/design/backlog.md)
- **核心特性验收记录**：[自动化状态机重构](docs/verification/automation-state-machine-refactor/README.md) · [自动化生命周期](docs/verification/automation-lifecycle/README.md) · [开播设置改版](docs/verification/prestream-setup/README.md) · [真实队旗接入](docs/verification/team-flags/README.md) · [面板职责验收](docs/verification/scene-management/README.md) · [志愿直播员控制台](docs/verification/volunteer-console/README.md) · [控制台基础验证](docs/verification/operator-console/README.md) · [动作优先 BP](docs/verification/action-first/README.md) · [Roll / BP 衔接](docs/verification/roll-bp/README.md) · [返回准备状态](docs/verification/ready-return/README.md) · [现场问题修复记录](docs/verification/live-issues-2026-11-01/README.md) · [EX 与谱面封面](docs/verification/ex-artwork/README.md) · [模组参数与图池标签](docs/verification/mod-parameters-labels/README.md) · [FM EZ 计分补偿](docs/verification/fm-ez-scoring/README.md) · [背景与图池布局](docs/verification/lazer-background/README.md) · [界面语义动效](docs/verification/semantic-motion/README.md) · [Showcase 入口与场景](docs/verification/showcase-entry/README.md) · [Showcase 隔离验证](docs/verification/showcase/README.md) · [Windows 便携版构建验证](docs/verification/windows-portable/README.md) · [单实例服务验证](docs/verification/single-runtime/README.md) · [数据来源分离](docs/verification/tosu-real-oclr/README.md) · [WebSocket 模拟验证](docs/verification/tosu-websocket/README.md) · [结算时序对抗验证](docs/verification/result-timing/README.md)

---

## 许可证

本项目自有代码与文档采用 [MIT License](LICENSE)。第三方依赖、字体与素材保留各自原有许可证，详见 [第三方声明 (`THIRD_PARTY_NOTICES.md`)](THIRD_PARTY_NOTICES.md) 与 [素材许可证 (tools/packaging/licenses/)](tools/packaging/licenses/)。Windows 便携包内已随附 `LICENSE`、`THIRD_PARTY_NOTICES.md` 及 `licenses/` 目录下的第三方许可证文件。
