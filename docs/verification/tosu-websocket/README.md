# tosu WebSocket 模拟器与界面验证

日期：2026-10-28（America/New_York）。本轮使用**真实本机 WebSocket 连接传输模拟数据**，不是直接调用 SessionStore.frame() 注入已归一化对象。仍不等于真实 osu! / tosu / OBS 联调。

## 启动与使用

```sh
npm run build
npm run sim
```

- 模拟器面板：<http://127.0.0.1:24051/>
- 直播员控制台：<http://127.0.0.1:3005/control>
- OBS / 只读输出：<http://127.0.0.1:3005/overlay>
- 模拟 tosu WebSocket：`ws://127.0.0.1:24051/websocket/v2`
- 原始快照：<http://127.0.0.1:24051/json/v2>

端口占用时指定 `npm run sim -- --app-port 3006 --ws-port 24052`。程序不结束其他进程。终端 Ctrl+C 同时关闭这两个模拟服务；本轮交付时保留默认端口运行，便于直接操作。

点击 **重置并自动演练一局**，会执行明确的测试 BP：红 Ban HD1 → 蓝 Ban HR1 → 红 Pick NM1 → 准备期改 NM2 → Playing（持续分数/聊天）→ Ranking（自动加一张红队赢图）。这是固定的模拟序列，不代表正式比赛 BP 规定。约 15 秒完成，并停留结算供直播员纠错。

也可逐步点击右侧按钮，或填写谱面 ID、IPC 与队分后推送。每次换图应等待界面应用当前动作，再进行下一步。面板支持池外图、同图快照、平分、缺失队分、错误房间、无效数据、断开连接和暂停发送。暂停发送超过 5 秒可实际触发 stale；恢复后先建立基线。

所有队伍、选手、谱面 ID、Roll 与成绩均明确标记为模拟。预设 7 张 NM 和其余五类，用于现有图池布局验证。没有加载 `.env.local`、没有读取凭证、没有请求线上 OCLR API。每次启动建立独立临时存储，路径会打印在终端；重置会话会先保留本次模拟存档。正式 `.local/session.json` 不参与。

## 传输与字段

```text
TosuSimulator (HTTP Upgrade + WebSocket 文本帧)
  → 原有 TosuClient（重连 / 5s stale）
  → 原有 normalizeTosuV2
  → 原有 BroadcastData / attachBroadcast
  → 原有 SessionStore / RoomAutomation
  → /api/session/events (SSE)
  → 现有 /control 与 /overlay
```

- `beatmap.id / artist / title / version / mapper / time / stats`
- `state.number / name`、`play`、`resultsScreen`
- `tourney.ipcState / bestOF / team / totalScore / points`
- `tourney.clients[].ipcId / team / user / beatmap.stats / play`
- `tourney.chat[].name / message / timestamp / team`

字段结构依据 [tosu 官方 v2 类型](https://github.com/tosuapp/tosu/blob/master/packages/tosu/src/api/types/v2.ts)，WebSocket 握手与文本帧依据 [RFC 6455](https://datatracker.ietf.org/doc/html/rfc6455)。模拟器只实现当前项目使用的字段子集；未复制全部 settings/performance/files 等接口，也不提供游戏视频或 osu! 房间命令。`simulation: true` 为模拟器额外标记。缺失队分/错误帧等属于明确的故障注入，不是有效 tosu 数据的声明。

`points` 故意保持 0:0，以确认本地赢图来自最终总分，而不是直接照抄 tosu 星数。多个输出页面只增加 SSE 订阅，服务器仍只有一个 tosu WebSocket 订阅。

## 自动化验证

```sh
npm run sim:test
npm test
```

新增 7 项真实网络集成测试通过；整个仓库 53 项测试通过，耗时约 23 秒。`npm run build`（含类型检查）与 `git diff --check` 通过。

| 用例 | 已验证结果 |
| --- | --- |
| Ban → Ban → Pick | HD1 归红队、HR1 归蓝队；旧图重复帧不占新槽 |
| 准备期 NM1 → NM2 | 同一 round ID，只有一局，不提前 Playing |
| 实时 Playing | 自动切画面、持续队分更新、8 位选手总分一致、比赛聊天通过原适配层 |
| Ranking | 最终总分 1,234,567 : 1,100,000，自动红队赢图 +1，重复帧不再加 |
| 两个独立输出 SSE | 自动计胜和人工比分校正同步到两个订阅；上游 WS 仍只有一个 |
| 撤回 / 人工校正 | 撤回后旧 Ranking 不补回；重记胜方与 2:2 校正不会被旧帧覆盖 |
| 错误房间 / 无效帧 / 暂停 / 撤销 | 不推进 BP；恢复建立基线，等待新换图 |
| 断开 socket / 静默 | 真实断线重连、原 5 秒 stale 计时；Ranking 首帧不补造结束或赢图 |
| abort / 同图重赛 | 3→1→4 不误计胜，显式重赛建立新 run ID |
| 延迟、平分、缺失最终队分 | 不猜胜者；连续结算内最终数据补齐稳定后才加图；真实 0 有效 |
| 快速重置 / 导航隔离 | 重置串行化可继续操作；允许入口文档导航，同源写入与文件白名单保持 |

测试入口：[test/tosu-websocket.test.js](../../../test/tosu-websocket.test.js)。使用系统真实 TCP/WebSocket 与原适配层；端口随机分配，不依赖正式服务或本机真实 tosu。

## 浏览器验证

在独立模拟器面板点击换图与 Playing/Ranking，现有输出自动响应。控制台显示 `#1 NM2 prepared`，证明准备期替换没有新增局次。Playing 的队分持续增加，Ranking 显示最终队分与红队一张赢图。

随后通过现有控制台撤回该局、改为 2:2，并解除手动画面锁定；源持续发送原 Ranking，输出仍保留人工比分。最后点击模拟器的完整自动演练，重新走完一局，当前停留模拟红队 1:0 的结算。

- [Playing](playing.png)
- [自动结算计胜](ranking.png)
- [控制台人工纠错](correction.png)
- [模拟器面板](simulator.png)

控制台、输出与模拟器浏览器日志未见前端 error/warn。游戏窗口仍明确显示“等待游戏捕获接入”；直播间 Chat 仍为等待实际 OBS 源的占位。谱面参数区域（★/CS/AR/OD/BPM/时长）目前仍未接线，即使模拟帧包含 stats 也显示 —；本轮记录这一现有界面边界，没有把占位认作数据展示已完成。

## 尚需实机核对

本模拟器验证程序逻辑、数据传输与界面联动，不复现真实内存读取延迟、选中实例错绑的全部表现、客户端逐步结束时序、实际计分规范或 OBS 视频捕获。真实版本的结束序列、最终队分何时稳定、防抖参数与捕获源仍需直播机录制核对。
