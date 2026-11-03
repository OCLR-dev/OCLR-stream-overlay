# 中止后返回本图准备状态

日期：2026-11-03（America/New_York）。main 与 `test/custom-match` 共用此行为。

## 操作行为

裁判中止本局、房间返回准备阶段后，不再要求直播员额外确认重赛或重新 Pick。保留当前播出画面、原图、选图方、图池标记、BP 队列、EX 和系列比分。原尝试保留为作废记录，建立关联的准备尝试；重新开始后建立新的 run，正常结算只计胜一次，再继续下一 Pick。恢复本身不消耗 BP、不加赢图，也不触发 Pick 的 2.5 秒切画面计时。

## 信号边界

- 必须曾在当前连续连接中实际观察到本局开始，且本局仍在 Playing、没有释放 BP 或进入 Ranking。
- 同一房间、同一谱面（准备时允许谱面身份暂空）连续返回 IPC 1／2，至少两帧且持续 250ms 后恢复准备。单帧跳变不处理。信号间隔不得超过 5 秒。
- 玩家缺失但仍是 IPC 3，只挂起待核对；其后确实连续返回准备房间，才恢复准备。
- IPC 0 初始化、Ranking、换图、换房、断线、过期、时间倒退、明确暂停、人工等待或全部自动跟随关闭均不能借这条路径恢复。首次接入、进程重启和撤销不能复用先前证据。
- 实现识别的是“已观察的未完成本局返回准备房间”，不解析聊天、不向房间发送命令，也不声称收到独立的裁判 abort 事件。官方 [TourneyState](https://github.com/ppy/osu/blob/master/osu.Game.Tournament/IPC/TourneyState.cs) 只列出 Initialising／Idle／WaitingForClients／Playing／Ranking；[tosu v2](https://github.com/tosuapp/tosu/blob/master/packages/tosu/src/api/types/v2.ts) 提供对应房间快照。
- 如果真实信号漏掉整个 Ranking，又连续从 Playing 返回准备阶段，仅凭现有 IPC 无法区分中止和漏采的正常结束。本实现会按中止保留原尝试、不计胜，需人工核对实际赛果；可撤销或使用已有系列比分纠正。250ms 防抖不能证明裁判执行了命令。

## 验证

- 两版 `npm run build`（包含类型检查）通过；最后仅补充准备状态的顶部文案，再次构建通过。
- 全套 `npm test`：main **367/367**，测试分支 **377/377**，0 failed、0 skipped。两版串行执行，包含固定端口便携版用例；事先备份并停止 main 预览，测试不使用现有比赛文件。
- 新增 `test/ready-return.test.js`：main 18 项、测试分支 20 项；后者额外覆盖自定义 BO 赛事的两种准备状态。覆盖掉线后返回准备、空谱面／空选手、原图和画面保留、EX、系列分、BP、不重复尝试、旧 Ranking、重新开始、下一 Pick、暂停／人工等待／来源连续性、撤销和重启。
- 更新实际本机 WebSocket 合成集成用例：Playing → 缺少客户端 → IPC 1 → 自动恢复准备 → 空客户端加载 → 新 Playing → Ranking 一次计胜 → 下一 Pick → 下一图一次计胜，全程无重赛命令、无人工记胜。
- 3022／3023 内存会话浏览器检查：均显示“当前图 NM1 · 已选图 · 比赛尚未开始”，保持 Playing，顶部显示“等待比赛开始”，无强制异常面板、无浏览器 error。测试副本明确标注隔离验证。

[main 准备状态](main-prepared.png) · [测试版准备状态](custom-prepared.png)

未执行 Windows 原生 osu!tourney／tosu／OBS 实机复测，尤其仍需确认实际 abort、初始化和漏采 Ranking 的顺序。未重新制作 Windows 包。
