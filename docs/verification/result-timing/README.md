# 结算时序对抗探测（原始基线）

日期：2026-10-28（America/New_York）。这是对当前实现的特征探测，不代表真实 osu!tourney 一定会产生下述序列。原始结果见 [result-timing.json](result-timing.json)。

本页保留改造前 12 / 17 符合预期、5 种风险的原始记录。本轮最新为 15 / 17、2 种仍有风险；新增一致性检查与迟到变分待核对，完整旧快照提前计胜仍未解决。见 [最新报告与边界](../volunteer-console/README.md)。

## 方法

`npm run sim:timing` 在独立临时会话与随机本机端口运行：合成的原始 tosu v2 数据 → 真实 WebSocket → 现有 TosuClient / normalizeTosuV2 → RoomAutomation / SessionStore。没有连接线上 OCLR、读取凭证、发送 osu! 房间指令或修改默认模拟服务。

共 17 个假设场景，12 个满足期望，5 个暴露风险。`sim:timing` 遇到风险以退出码 1 结束，并打印 JSON 报告路径；不能把该命令的风险输出解读成正常回归测试通过。普通回归测试另行运行。

## 结果

| 场景 | 当前观察 |
| --- | --- |
| 正常连续 3→4 | 自动计胜一次 |
| 最后一路卡住，IPC 保持 3 | 继续 Playing，不计胜；最终 4 与新队分到来后正确计胜 |
| IPC 提前变 4，旧有效队分冻结 1.2 秒，然后胜方反转 | **风险：提前给旧领先方计胜，迟到的新分数不改正该局** |
| Ranking 后最终队分缺失，之后补齐 | 等待，补齐后计胜 |
| Ranking 后暂时平分，之后补齐 | 等待，非平分后计胜 |
| Ranking 后队分持续更新，更新间隔短于 250ms | 等待稳定后计胜 |
| 有效的 0 分 | 保留真实 0，正常计胜 |
| 没观察到本次 Playing，首次帧就是 Ranking | 不补造开打或计胜 |
| Ranking 短暂出现不足 250ms，随后回到 Playing | 不提前计胜，之后正常结算可计胜 |
| 一路个人分与命中数未完成，管理器先到 Ranking | **风险：当前不检查命中数，仍可能提前计胜** |
| 管理器队分与逐人求和不一致 | **风险：当前只使用管理器队分，不等待两者一致** |
| 旧快照的逐人分与总分一致，只是 IPC 提前变 Ranking | **风险：看起来一致的旧快照仍被判为最终分；加总校验也无法排除这种情况** |
| 已计胜后分数继续上涨，胜方未变 | **风险：保存的 finalScore 保留首次计胜时数值，不会更新迟到的最终队分** |
| 单个选中实例先显示 ResultsScreen，赛事 IPC 仍是 3 | 不误用单进程状态计胜 |
| 播放时间超过谱面末尾，赛事 IPC 仍是 3 | 不按播放时长计胜 |
| 一路窗口缺失，随后 Ranking | 挂起待核对，不计胜 |
| Playing → Idle → 旧 Ranking | 挂起待核对，不计胜 |

上表的“风险”表示：如果真实客户端产生这种序列，当前算法会出现问题。尚未证明真实客户端会产生它；也不能因为模拟的正常路径通过，就声称真实客户端一定安全。

## 上游证据与未确认处

- [官方 TourneyState](https://github.com/ppy/osu/blob/master/osu.Game.Tournament/IPC/TourneyState.cs) 只定义枚举，没有给出 stable 端等待全部玩家结束的生产条件。
- [tosu TourneyManager](https://github.com/tosuapp/tosu/blob/master/packages/tosu/src/states/tourney.ts) 读取管理器的状态和队分；读取失败的路径不能作为字段刚刚成功刷新的证明。
- [tosu v2 输出](https://github.com/tosuapp/tosu/blob/master/packages/tosu/src/api/utils/buildResultV2.ts) 从管理器读取 IPC / 总分，从各观战实例读取个人 play 数据。公开 `clients[]` 没有逐人的 finished 标记。
- [官方 FileBasedIPC 读取方](https://github.com/ppy/osu/blob/master/osu.Game.Tournament/IPC/FileBasedIPC.cs) 分别读取状态和分数文件；该代码是读取端，不能据此推断 stable 生产端何时切换状态。

不能把“分数稳定 250ms”“所有个人分加起来一致”“命中数看似足够”“scoreVisible 已开启”中的单个条件当作未经实机核对的最终完成证明。延长固定等待时间无法排除更长的冻结；缺少新鲜度标识时，一致的旧快照与真正完成的快照可能无法区分。

## 直播机记录

在运行真实 osu!tourney 与 tosu 的直播电脑上执行：

```sh
npm run tosu:record -- --duration 180
```

默认只连接本机 `ws://127.0.0.1:24050/websocket/v2`，写入被 Git 忽略的 `.local/diagnostics/`，不读取环境凭证。也可以指定 `--out capture.ndjson`。录制期间输入标记后回车：

```text
tosu / osu!tourney 版本与客户端配置
其他人已到结算，最后一路仍卡住
最后一路画面结束
管理器结果队分跳变
Panic 被点击
裁判发送 abort
裁判确认重新开打
```

逐帧保留本机时间与单调计时、所选实例状态、谱面 ID / 播放时间、管理器 IPC / scoreVisible / 队分 / 星数、各窗口的 IPC ID / 用户 ID / 个人分 / 命中数 / 谱面物件数、连接事件和人工标记。没有上游提供的 finished 字段就保持缺失，不自行推断；不保存姓名、聊天或环境配置。记录器在未收到有效帧时以退出码 2 结束。

记录器已用一秒真实本机 WebSocket 传输验证 IPC 变更、零值与缺失值、时间顺序、人工标记和文件输出。它验证的是记录工具，不是上述真实游戏时序。

当前应对：直播员确认有人卡顿时，使用现有“本图异常处理”挂起自动推进与计胜，再根据实际成绩继续、人工记胜或裁判确认重赛。实机证据齐全后再收紧自动完成条件。
