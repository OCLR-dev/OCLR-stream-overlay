# OCLR 直播 Overlay

Vue 3 / Vite / TypeScript 的 Neon Broadcast 直播界面，配套独立直播员控制台与本机共享会话。沿用现有深紫 UI、红蓝横幅、系列菱形和稳定游戏窗口。

## 运行

需要 Node.js 22.13+。已有依赖不需重新安装；首次使用执行 `npm ci`。

```sh
npm run build
npm start
```

- 直播员：[http://localhost:3001/control](http://localhost:3001/control)。有流程操作、浏览器预览、BP、结果和逆向纠错。
- OBS：[http://localhost:3001/overlay](http://localhost:3001/overlay)。只读输出，画幅 1920×1080；始终使用同一个浏览器源与这个固定地址。不要固定 `#scene`，旧 hash 也不会覆盖共享会话。
- 视觉演示：[http://localhost:3001/](http://localhost:3001/)。保留独立演示数据、URL 恢复和原评审控件，不改变正式会话。

控制台与输出是两个独立页面，通过 Node 服务的快照和 SSE 同步。关闭或刷新控制台不影响输出；浏览器重新连接会取得统一快照。控制台预览只是另一个只读输出实例，不代表 OBS 最终合成。没有 OBS WebSocket、场景切换或 OBS 确认步骤。

`npm run dev` 仍在 127.0.0.1:3003 提供独立 UI 演示；Vite 根目录仅为 `ui/`，不加载凭证。本轮完整控制流程通过构建后 `npm start` 验证，开发/preview 服务本身不提供会话 API。

## 没有 tosu 的本机模拟测试

```sh
npm run build
npm run sim
```

打开 [模拟器面板](http://127.0.0.1:24051/)、[模拟控制台](http://127.0.0.1:3005/control) 和 [模拟只读输出](http://127.0.0.1:3005/overlay)。点击“重置并自动演练一局”，或逐步换图、进入 Playing/Ranking、修改队分与注入断线。现有 TosuClient 实际连接 `ws://127.0.0.1:24051/websocket/v2`，沿用原归一化、共享状态与界面链路。

模拟服务与正式 24050 / 3001 分开；不读取本机凭证，不请求线上 API，使用明确标记的模拟资料与临时存储。Ctrl+C 关闭。可通过 `--app-port` / `--ws-port` 改端口；`npm run sim:test` 运行 7 项真实 WebSocket 测试。结构、用例与浏览器证据见 [WebSocket 模拟验证](docs/verification/tosu-websocket/README.md)。

## 本场操作

1. 在“本场设置”录入真实队名、上场名单和本场图池，或通过 OCLR 已发布资料选择赛季、队伍、场次和图池。API 空集合保持为空。历史验证可明确选择 S10 / S9 的完整资料，不能拿历史资料补 S11 空缺；历史场次仍需人工确认对阵与上场名单。
2. 标记到场/就绪，开始 Roll。输入实际 Roll 结果，先 Pick 与先 Ban 分别记录；可先展示 Roll 再进入 BP。
3. 明确设置当前 BP 动作、队伍和 Ban 槽位。已核实的后续顺序可逐行填写 `a ban1` / `b ban2` / `a pick`；未确认的部分留空，不推断完整 BP 顺序。
4. 手动选择具体谱面执行 Ban/Pick，或启用房间自动跟随。Ban 只作用于具体条目，槽位显示 HD2 等实际标签。Pick 后改图替换同一轮准备图，不追加轮次。
5. 进入 Playing。正常结算自动展示单图结算，并按稳定、完整且不相等的最终队分自动给胜方增加一张赢图。每局只计一次；缺失/平分不猜胜方，保留人工记录。
6. 结算后下一张有效图可回 BP；未记清的上一局与新准备图独立保存。到达系列目标后仍展示单图结算，直播员点击“展示 Winner”即可；不增加 OBS 确认步骤。
7. “存档并准备下一场”保留上一场本机存档。暂停保存返回画面，不清空 Roll、Ban、轮次或比分。

人工图池每行使用 `标签 谱面ID 标题`，例如用本场真实的 `HD2` 标签与实际谱面 ID，标题可省略。条目 ID 唯一，同一 beatmap ID 可存在多个条目；这种情况自动跟随会停止并要求手动选择具体槽位。

### 异常与逆向纠错

“比赛记录”提供三类修正，均需填写原因并保留操作历史：

- **撤回本局计胜**：减回该局贡献，恢复为待记录结算；可重记正确胜方，或作废并重赛。旧 Ranking 帧不会自动把撤回的分数加回。
- **修正胜方**：直接改正该局记录与赢图归属；不会重放 tosu 事件。
- **人工校正系列比分**：直接输入双方正确赢图数并同步输出。保存校正差额，保留每局原记录，后续赢图在校正后的比分上累计。它与逐局修正是不同入口；若两者叠加会使比分越界，服务拒绝操作并提示先核对校正值。

“撤销最近一项修改”可撤销最近的人工或自动变更，同时追加修订记录。已展示的 Winner 可通过上述纠错返回结算核对。切换显示画面本身不计胜，也不扣 EX 次数。

## tosu 自动跟随

仅服务端建立一个 tosu v2 订阅，所有浏览器消费同一份会话，避免多个输出页重复推进。

- 开启前核对 tosu 所选实例确实绑定赛事房间，在控制台选择 **stable / osu!tourney** 并填写实际房间左右队名。当前不对未知客户端或 lazer 套用 stable IPC 枚举。两侧客户端和队名需有效匹配。
- `beatmap.id` 变化稳定 400ms、至少两帧后，按事件发生时的当前 BP 动作应用。使用本场图池唯一匹配；旧的人工 entry 选择不会挡住新换图。
- 新的赛事 Playing (`ipcState=3`) 建立独立 run ID；连续有效的 `3→4` 防抖 250ms、至少两帧后展示结算。稳定的双方最终队分决定本局胜方并自动加赢图，真实 0 保留，缺失不当作 0。迟到的最终队分可在同一连续结算内补齐。
- 换图不等于开打。非池内图、重复 map ID 槽位、已 Ban/已打图、房间不匹配或动作已改变时不推进 BP。
- 暂停、手动锁定、过期、无效帧、断线均中断自动连续性；恢复或重连先建立基线，首帧 Ranking 不补造计胜。相同 ID 的重复房间命令不能靠快照识别，重赛使用独立操作。
- 手动切换画面会锁定自动跟随；控制台“解除手动锁定”恢复后重新建立基线。不按分数停止增长、谱面时长或普通单进程 resultsScreen 判定赛事结束。

完整方案：[控制台](docs/design/operator-console-plan.md)、[BP 自动跟随](docs/design/bp-automation-plan.md)、[tosu 信号调查](docs/design/tosu-auto-scene-research.md)。

## 数据与存储

| 位置 | 职责 |
| --- | --- |
| `server/session/model.js` | 命令校验、比赛进度、单图 BP、系列分、自动计胜与纠错 |
| `server/session/automation.js` | 唯一的房间换图 / Playing / Ranking 观察器，连续性只保存在内存 |
| `server/session/store.js` | 串行提交、版本、持久化、撤销、只读订阅快照 |
| `server/session/data.js` | 通过 `src/index.js` 接入统一数据层，显式导入已发布资料 |
| `server/session/http.js` | 本机会话读取、SSE 和同源 JSON 命令 |
| `ui/components/OperatorConsole.vue` | 独立控制台；`ui/session.ts` 为浏览器会话客户端 |
| `ui/useOverlay.ts` | 将共享会话接入现有组件；演示模式保持独立 |

`.local/session.json` 原子替换保存比赛选择、Roll、BP、轮次、来源、校正差额、暂停返回位置、最近操作与撤销记录。准备下一场前保存 `.local/archive/`；整个 `.local/` 被 Git 忽略，HTTP 不提供这些文件。实时队分、聊天和观察器连续性不作为实时数据恢复；结算队分是明确的历史快照。文件损坏时拒绝启动，不静默覆盖记录。

来源：OCLR 已发布只读资料；tosu 当前帧；人工播出记录，三者保持分离。API 定时刷新只更新来源健康和可选资料，不改写已确认的本场 BP/赛果。不生成 `bracket.json`、不写网站正式结果、不连接数据库。

## 代理与凭证

沿用已有 `.env.local`；首次配置参考 `.env.example`，不要覆盖已有文件。OCLR Key 或凭证文件引用只在服务端加载，Key 不进入浏览器、URL、日志或 Git。后端仍是只读白名单代理；只有 `/api/session/command` 接受严格同源的 JSON 写入，写入范围仅本地会话。

服务只监听 `127.0.0.1`，生产静态白名单为入口及 `dist/assets/`，另保留四个指定数据模块。禁止对项目根目录运行静态 HTTP 服务。

OCLR 读取：顺序加载同一赛季的 overview/teams/competition/mappools/bracket/players；分页版本冲突整份重读一次；401/403 清空来源并停止自动刷新，不降级匿名；429 遵守 Retry-After。来源时间是本机成功读取时间，不是上游原子快照。

## 验证与尚未接入

```sh
npm run check
npm run build
npm test
```

本轮测试与截图见 [控制台验证](docs/verification/operator-console/README.md)。合成 tosu 序列只验证本地状态逻辑；本 Mac 没有 tosu，**尚未完成真实 tosu / osu!tourney / OBS 联调**。

游戏视频、原生结算捕获与直播间 Chat 源叠放仍需直播机接线，当前游戏窗口明确显示待接入。Playing 与单图结算保持同位同尺寸，直播间 Chat 固定为 `(1470,928,420,138)`。EX 对称减员窗口保留，但真实 EX 选手映射、捕获源和完整 EX 裁判规则仍待核对，不自动推定减员名单或扣次数。自动回 BP 的空闲状态计时策略尚未启用，只支持下一有效谱面或人工返回。
