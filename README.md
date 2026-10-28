# OCLR 直播 Overlay

OCLR 赛事直播项目，前端已迁移至 **Vue 3 + Vite + TypeScript**，采用 **Violet Orbit** 浅紫主题和左红右蓝队色。六场景、S11 本地演示交互、URL 恢复及窗口几何沿用 layout-v1。数据基础层与画面仍分离，尚未接入真实数据，也未完成真实 tosu / osu! tourney / OBS 联调。

## 当前内容

| 路径 | 内容 |
| --- | --- |
| `server/` | 仅本机监听的 OCLR 只读 API 代理，凭证只留在服务端 |
| `src/` | OCLR API、tosu v2 WebSocket 与统一订阅入口 |
| `test/` | 数据边界、分页、断线与凭证隔离测试 |
| `ui/` | Vue 场景、共享窗口/谱面组件、TypeScript 状态与本地视觉资产；后续前端修改入口 |
| `dist/` | Vite 生成的生产资源，已忽略，不提交 |
| [`design/layout-v1/`](design/layout-v1/layout-plan.md) | 迁移前的 S11 视觉参考、布局决策及截图 |
| [`docs/verification/vue-migration/`](docs/verification/vue-migration/README.md) | Vue 迁移检查记录、布局比对与新版截图 |
| [`design/layout-v1/art/`](design/layout-v1/art/violet-orbit.svg) | Violet Orbit 本地 SVG 背景；Mappool / Playing / 单图结算共用 |
| [`design/layout-v1/s11-rules.md`](design/layout-v1/s11-rules.md) | S11 v1.6 规则映射、UI 边界及待定项 |

构建后，数据服务的 `/`、`/index.html`、`/overlay` 提供 Vue UI；`/api/health` 返回服务状态 JSON。默认画面仍使用明确标注的本地演示数据。

## 开发与生产运行

需要 Node.js 22.13+，本机已验证 Node.js 24.16。首次安装依赖并启动开发页：

```sh
npm ci
npm run dev
```

打开 <http://127.0.0.1:3003/>。Vite 仅监听本机，根目录限制为 `ui/`，不加载 `.env.local`。开发页只做 UI 演示，不自动请求 OCLR 或连接 tosu。

生产构建与本机运行：

```sh
npm run build
npm start
```

打开 <http://localhost:3001/>；OBS 可使用 <http://localhost:3001/overlay#scene=playing&clean=1>，画幅设为 1920×1080。正式播出仍需真实客户端和 OBS 联调。`npm run preview` 可单独在 3003 端口查看构建产物，与开发服务择一运行。

`npm run check` 执行 Vue/TypeScript 类型检查，`npm test` 执行数据层、UI 状态及静态服务隔离测试。未构建时访问本机 UI 会返回 `UI_BUILD_REQUIRED`，先执行 `npm run build`。

## 原版布局参考

在项目根目录运行：

```sh
python3 -m http.server 3002 --bind 127.0.0.1 --directory design/layout-v1
```

打开 <http://127.0.0.1:3002/>。只提供该线框目录，**不要把项目根目录作为静态 HTTP 根目录**。

- 六个场景：等待选手、Mappool Ban/Pick、Playing、单图结算、全场胜利、暂停 / 技术处理。
- S11 顶部锚点：`OCLR S11`、小组赛/淘汰赛/决赛、BO11 先 6 / BO13 先 7、当前普通/EX/TB、双方 6/7 个赢图星位。阶段与赢图星数均可由外部人工演示；默认未知空星。
- 常规人数 3v3 / 4v4（最终待定）独立切换。用户于 2026-10-27 确认：EX 激活时双方各减 1 路，常规 3v3 → EX 2v2，常规 4v4 → EX 3v3；清除 EX / TB 恢复常规窗口数。EX 剩余次数与星位不自动变化。
- Mappool 保留三列和聊天，增加双方各 2 个 Ban 槽、未确认/空Ban、先 Pick/先 Ban、FM/TB 占位和本地 Ban 校验。TB 禁 EX、TB 不可 Ban；不实现完整 BP 引擎，不推断行动顺序。
- Playing 与单图结算在谱面附近显示当前普通/EX/TB、模组、FM 要求和 EX 开启队伍；等待页常规选手卡显示 Captain/T1/T2…，EX 示例使用后排合成标签 T2/T3/T4，不显示 Captain/T1；Playing/结算已移除窗底姓名与角色栏。单图结算复用 Playing 的同位同尺寸窗口，只保留 osu! 原生结算占位，不制作逐人成绩表。
- Playing 分差带从固定中线向领先一侧延伸；单图结算总分只按当前有效上场人数求和（常规 3/4 原值保留，EX2/EX3 取现有数组前 2/3 项），独立于 Playing 领先按钮。暂停区分战术暂停/技术处理，外置人工控制，无自动倒计时。
- 全场胜利为独立占位，显示阶段和赛制目标，不造正式冠军。
- 支持 4:3 / 16:9 游戏源比例、干净输出与 URL 状态恢复。S11 规则详情见[规则映射](design/layout-v1/s11-rules.md)，布局决策见[布局规划](design/layout-v1/layout-plan.md)。
- **Violet Orbit 浅紫视觉（light only）**：瓷白与淡紫的日间广播场，配深紫轨道线、细网格和雾面淡紫面板。左队 / A = **RED**、右队 / B = **BLUE**；红蓝已增强到顶部两侧的浅色铺色、队名/星位、窗口边框、图池队伍状态区、等待页标题/头像和比分区域；中央品牌与共用背景保留浅紫。Mappool、Playing、单图结算共用 [violet-orbit.svg](design/layout-v1/art/violet-orbit.svg) 背景；等待、全场胜利、暂停仅在同一背景上叠加各自的浅色场景光层。这是单一浅色主题，不提供深色变体。背景、面板与标识均为本地 CSS/SVG，不使用外部字体或网络素材；此外只有缓慢的环境光漂移与颜色/比分状态过渡，并在 `prefers-reduced-motion` 下关闭。游戏源区域内不覆盖装饰。
- 当前所有分数、星位、Ban/EX 状态均为本地演示，游戏与原生结算画面均为占位。OCLR 是赛事品牌，OWC 2019 仅是布局参考。
- 按 `1`–`6` 切场景、`C` 切换干净输出、`Esc` 退出干净输出。外置 S11 演示抽屉默认收起，以免压缩画布。
- 样式与脚本带 revision query（`?v=20261027-light-v2`），已有预览标签页刷新后会加载当前浅紫 + 红蓝队伍标记视觉层。

![Playing 加强红蓝队色、移除窗底信息栏后的预览](docs/verification/team-colors/playing.jpg)

最新视觉调整和八种布局检查见[红蓝队色与窗口收束记录](docs/verification/team-colors/README.md)。

原版六场景截图与检查见[视觉验收记录](design/layout-v1/visual-verification.md)；Vue 版本的对应记录见[迁移验收](docs/verification/vue-migration/README.md)。后续修改 Vue 组件，不再维护原版 DOM 脚本。

## 数据来源

| 来源 | 用途 | 入口 |
| --- | --- | --- |
| tosu | 游戏状态、当前谱面、单人/Showcase 成绩、赛事客户端、实时队分、星数、聊天 | `ws://127.0.0.1:24050/websocket/v2` |
| OCLR 网站 | 已发布赛季、队伍/队员、赛程、正式结果、图池、晋级结构 | `https://oclr.org/api/v1` |
| 直播员选择 | 当前赛季、场次、图池、左右队伍、重复谱面槽位 | `BroadcastData.selectEdition/selectMatch`，仅在内存中 |

不生成或维护 `bracket.json`，不连接数据库。实时星数和游戏成绩与 API 中的正式结果分别保存；不因名字相同而自动绑定队伍。不从其他赛季借用空缺资料，也不从比赛结束事件自动写入正式结果。API 的 `/bracket` 仍可读取，它是线上晋级结构资源。

## 运行数据服务

需要 Node.js 22.13+（本机验证使用 24.16）。Node 代理本身使用标准库；Vue 页面需要先安装依赖并构建，见上文。

```sh
# 在项目根目录运行
cp .env.example .env.local # 仅初次配置；已有文件不要覆盖
npm start
```

服务地址为 `http://localhost:3001`，仅监听 `127.0.0.1`，与现有 `3000` 网站分开。

`.env.example` 默认以匿名模式读取 `https://oclr.org`。需要 Bearer 认证时，在不提交 Git 的 `.env.local` 中设置 `OCLR_AUTH_MODE=bearer`，并填写 `OCLR_API_KEY` 或将 `OCLR_CREDENTIALS_FILE` 指向已有的服务端凭证文件；相对路径以项目根目录解析。前端不接收 Key。仓库不包含任何本机 `.env.local` 或凭证文件，克隆后需自行配置。

`OCLR_API_ORIGIN` 必须与 Key 获发时绑定的 Origin 一致，由服务端发送，与本服务端口独立配置。Key 失效时返回 401/403，停止自动刷新并清空赛事快照。更新凭证后重启服务，再调用 `refresh()`。不会自动降级匿名。若明确使用公开匿名数据，将 `OCLR_AUTH_MODE` 设为 `anonymous` 后重启。

`.env.local` 和凭证文件绝不能通过静态 HTTP 服务器公开。本项目的 Node 服务只公开构建入口、显式允许的构建资源、四个指定浏览器数据模块和只读 API；不会公开项目根目录或未知路径。不要对整个工作区或项目使用 `python -m http.server`。

## 给后续 UI 的入口

Vue 页面现已由本项目本地服务同源提供，仍未订阅真实数据。`ui/model.ts` 仅表达本地演示状态；后续通过独立 composable 订阅 `src/index.js`，明确处理来源/缺失/过期/错误，不用演示值填补真实数据空缺。API Key 继续只留在服务端。

```js
import { createBroadcastData } from '/src/index.js';

const data = await createBroadcastData();
const unsubscribe = data.subscribe(state => {
  // state.oclr: status / updatedAt / error / data
  // state.tosu: status / updatedAt / data
  // state.selection: 当前赛季、场次、图池、左右队伍 ID
  // state.currentPoolEntry: 唯一匹配的谱面槽位，或 null
  // UI 按 status 决定是否显示内容，禁止把旧快照当作 live。
});

await data.selectEdition('s11');
// 从已取得的数据中选择真实 ID；空列表时保留未选择状态。
// data.selectMatch({ fixtureId, poolId, leftTeamId, rightTeamId, entryId });
data.start();

// 页面/场景销毁时：
// unsubscribe();
// data.stop();
```

独立的 `OclrClient.tournaments()` 可用于赛季选择器，`edition(slug)` 读取赛季资料。服务器也允许读取单场 `/api/oclr/tournaments/{edition}/matches/{uuid}`；历史归档的场次键可能不是 UUID，应保留 `/bracket` 数据，不能猜成当前赛事 fixture ID。

赛事快照按顺序读取 overview、teams、competition、mappools、bracket 和完整 players，每 60 秒刷新（可配置，最低 30 秒）。这些跨资源读取**不是数据库原子快照**，`updatedAt` 只是本地成功读取时间；正式来源时间/版本仍以各资源内容为准。分页集合带版本，409 后整份重读一次；不会返回半份名单。429 遵守 `Retry-After`。失败状态与真实空集合分开。

tosu 默认 5 秒无有效帧标记 stale 并重连，断线每秒重试；`stop()` 取消重连。每个新帧替换旧客户端列表，避免上一场选手残留。缺失数字保留 null，真实 0 保留 0。不在此阶段自动判定胜负、实现 Ban/Pick 规则或做动画。

## 参考与验收

- 官方 tosu：[项目与端点](https://github.com/tosuapp/tosu)、[v2 字段示例](https://github.com/tosuapp/tosu/wiki/v2-websocket-api-response)。公开文档对赛事数据标注了尚待测试，本机还需真实 tosu/赛事客户端验收。
- OCLR：[组织](https://github.com/OCLR-dev)、[机器可读接口](https://oclr.org/api/v1/openapi.json)。本次已实际读取线上 1.1.0 合同。
- MP5 参考项目仅用于核对 `/ws`、`COMMON/lib/bracket.js` 和比赛/Showcase 页面；该参考项目与其二进制、图片和字体均未收入仓库。
- OWC 2019 参考录像与截图位置见[布局规划的参考来源](design/layout-v1/layout-plan.md)。参考截图用于说明空间关系，不是 OCLR 的赛事素材或示例赛果。
- 本项目暂未提供自己的 Swagger UI；OCLR 上游的 OpenAPI 地址见上述链接。

```sh
npm test
```

测试覆盖分页重读/完整性、权限错误、缺失值/零值、谱面重复槽位、跨赛季竞态、断线重连、Key 隔离和代理边界。

2026-10-26 通过新项目本地代理的线上读取：9 个赛季（S3–S11）；S11 公开 players 为 32 人，teams、mappools、fixtures 均为 0，bracket 为 null。已验证代理不公开凭证文件。13 项自动测试通过。空值只是本次读取状态；联调服务已关闭，使用时运行 `npm start`。

Vue 版本已完成 1920×1080 六场景浏览器视觉复核及八组窗口几何对照，18 项测试通过。覆盖 S11 阶段/BO/星位、常规 3v3/4v4、EX/TB、Ban 槽校验、暂停和快捷键。截图与验收边界见[迁移记录](docs/verification/vue-migration/README.md)。减少动态偏好的 CSS 关闭路径已保留，系统偏好切换尚未实测。真实 tosu、osu! tourney 和 OBS 尚未联调，这些检查不等于实际播出验收。

S11 规则来源为 <https://oclr.org/tournaments/s11#rules>（1.6，核对日期 2026-10-26 America/New_York）。EX 窗口映射按用户 2026-10-27 America/New_York 的确认实现；常规人数最终仍待定，正式图池、报名结束前变化和真实阵容/数据接入仍待后续。本仓库不据此写正式结果或冠军。
