# tosu 自动切画面调查

日期：2026-10-28。结论：已有赛事状态字段可用于识别开图/结算，适合驱动浏览器画面；还需使用实际直播机的 tosu / osu!tourney 版本验证状态序列。本页保留前期源码调查依据；自动切换、最终队分稳定后计胜及逆向纠错已实现并通过模拟验证，真实房间联调仍待完成。

## 接口与字段

订阅 `ws://127.0.0.1:24050/websocket/v2`，读取每帧的 `tourney.ipcState`。`/json/v2` 可获取快照，持续订阅便于捕捉状态变化。下表针对 stable / osu!tourney 赛事管理器；tosu 的 lazer 分支可能使用不同状态来源，不能未经核对直接套用这些数值。

| 数值 | osu! 官方赛事 IPC 名称 | 拟用于本项目 |
| --- | --- | --- |
| 0 | Initialising | 初始化，不触发结束 |
| 1 | Idle | 空闲；结合本轮此前状态判断 |
| 2 | WaitingForClients | 等待客户端；不视为已经开图或正常结束 |
| 3 | Playing | 已准备本轮且自动跟随开启时显示 Playing |
| 4 | Ranking | 从本轮有效 Playing 进入时显示单图结算与聊天 |

依据：tosu 将赛事管理器读出的 `ipcState` 原样输出；数值含义来自 osu! 官方赛事 IPC 枚举。上述画面映射为本项目设计，tosu 不会替网页切场景。没有查到本次所阅 v2 公开结构中独立的“整张比赛结束”回调，需在订阅端识别状态转换。

- [tosu v2 WebSocket 文档](https://github.com/tosuapp/tosu/wiki/v2-websocket-api-response)
- [tosu v2 输出实现：buildTourneyData / buildResult](https://github.com/tosuapp/tosu/blob/master/packages/tosu/src/api/utils/buildResultV2.ts)
- [tosu 赛事状态读取](https://github.com/tosuapp/tosu/blob/master/packages/tosu/src/states/tourney.ts)
- [osu! 官方 TourneyState 枚举](https://github.com/ppy/osu/blob/master/osu.Game.Tournament/IPC/TourneyState.cs)

## 不能混用的信号

- 顶层 `state.number`、`resultsScreen` 来自 tosu 当前选中的游戏实例。单个进程显示结算不等于所有选手结束；不能用单人结算状态直接代替赛事管理器状态。
- 本次所阅 v2 `tourney.clients[]` 有 `ipcId`、队伍、选手、谱面统计和 `play`，没有逐客户端的 `state` / `finished` 字段。不能凭空写“所有 clients.state 都结束”的判断。
- 没有赛事管理器时，tosu 仍可返回 `ipcState: 0`、空队伍和空客户端的默认对象。存在 `tourney` 对象本身不代表房间已连接。
- 中途退出、失联和实际输图不能靠“分数不再增加”、`failed` 或谱面播放时长区分。`3 → 1/2` 不直接记作正常打完。
- 赛事状态读取失败时可能保留旧值；收到 WebSocket 帧只证明传输活动，不能保证该字段刚成功从游戏读取。需要结合客户端存在、有效数据、连续序列和实际异常录制评估可靠性。

类型依据：[tosu v2 类型](https://github.com/tosuapp/tosu/blob/master/packages/tosu/src/api/types/v2.ts)。来源读取与默认对象见上方官方实现。

## 自动跟随设计

1. 已选定本场、本轮图池条目，并启用自动跟随；热身或尚未准备本轮时不推进正式比赛。
2. 观察到有效 `Playing (3)` 后建立本轮运行标识；同一谱面重赛使用新的运行标识，不能只用 beatmap ID 去重。
3. 连续有效的本轮 `3 → 4` 经短暂可配置防抖后，一次性切单图结算。保留本轮最后有效数据供结算展示；不能因此宣称已获得官方最终成绩。防抖参数是本项目实现选择，不是上游协议保证。
4. 结算保持显示，隐藏谱面卡，使用现有比赛聊天与固定直播间 Chat。正常结算且最终队分完整、稳定、不相等时自动增加本地赢图；缺失/平分保持待处理，可人工记胜并返回 BP。
5. 可选自动回 BP 必须先观察本轮结算，再观察赛事管理器返回空闲/等待，并满足最短展示时间；需实机验证后启用。单独计时到点不强制切走。
6. 暂停、手动锁定、断线、数据过期时暂停自动切换。重连先建立基线，首帧就是 `4` 时不补造一次完成事件；保留手动结算入口。
7. 显示事件与计胜分别留记录；同一 run 只自动加一次赢图。支持撤回单局、修正胜方和人工输入正确系列比分；旧 Ranking 不覆盖纠错。不直接宣布 Winner，不增加 OBS 确认环节。

## 本项目现状与验收

`src/tosu.js` 已归一化 `tourney.ipcState`、队分、星数与赛事聊天，现已通过服务端共享会话驱动正式 Vue 输出。控制台与 OBS 页只订阅，自动流程仅在服务器处理一次；演示页保持独立。

本机检查时未发现 24050 端口的监听服务，未取得真实房间数据。下一步联调记录：正常开图/结束、选手陆续结束、掉线、中途退出、同图重赛、暂停期间打完、结算期间重连；核对具体状态序列与分数刷新先后，再确定防抖和回 BP 的条件。源码支持该接入方向，不等于已验证当前安装版本能够可靠自动播出。
