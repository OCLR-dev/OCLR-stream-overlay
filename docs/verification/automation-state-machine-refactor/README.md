# 自动化状态机重构实现与验证

日期：2026-11-09（America/New_York）。实施依据为 `docs/design/automation-state-machine-refactor.md` 的已确认规则。本次保留该设计原稿及已有 AGENTS.md 修改。

## 实际依赖

```text
normalized tosu -> room-facts / RoomAutomation / recovery observers
                              -> named observation requests
HTTP manual commands          -> model decision owner
rules                         -> model eligibility / transitions
records                       -> identity / result projection / EX contributions
application                   -> ordering / evidence lifecycle / one frame commit
store                         -> queue / file replacement / archive / snapshot / SSE
presentation                  -> scene following / post-commit display deadlines
```

`model.js` 是比赛状态的唯一写入入口。原有可接收任意状态修改回调的 `automaticTransition` 不再导出；观察器、恢复器和计时器只能请求明确操作，携带本场、版本及对应动作／比赛记录／run 身份。人工指令和机器请求复用内部 BP、开始、结束、计胜与贡献校验。核心允许调用方注入时间和 ID；瞬时依赖不进入快照。

`rules.js` 静态提供 OCLR 正赛和表演赛规则。正赛保留两轮 Ban 与交替 Pick，表演赛 Roll 仅生成交替 Pick；结束条件、自动成绩人数资格、TB 与 EX 资格在规则层。未增加通用赛事配置器。

`RoomAutomation` 保留原有来源连续性和防抖，只通过明确操作进入核心，不直接修改会话。`room-facts.js` 只报告队分完整性、人数与求和一致性，不判赛事资格。恢复器通过自己的 `reset`、`checkpoint`、`restoreEvidence` 和核心操作工作；应用层不访问或修改其他观察器的 `pending`／`endRun`。

应用层按顺序计算一帧的恢复、比赛与播出请求，然后一次保存。保存失败恢复观察器证据，保持原比赛状态；保存成功后才安装显示期限和发布快照。Store 只保留基础设施职责。

## 身份、兼容与人工入口

- schema 升为 2，保留旧 `round.id` 作为 `attemptId` 和兼容 HTTP 引用；每份单次记录有独立 `resultId`，明确 `replayOf` 链才共享 `selectionId`。同一 beatmap ID 不合并不同 Pick。
- `selections`、`results`、`pendingResults`、`currentSelectionId` 由核心随原有 Round 记录同步；结果保留来源、保护与修订。当前图指针不作为旧图补记的目标。
- 文件加载先校验迁移，在原路径旁保存含内容摘要的 schema 1 原始字节备份；首次成功提交才替换为 schema 2。撤销保存域一并升级。缺失／循环重赛引用保留数据并标记身份未知，限制该图自动推断。
- 旧 Pick 的 EX 消耗保持未知，以保存的剩余次数为基线，不从历史胜方追扣。明确重新准备重赛或准备期明确开启 EX 后，按新的已知上下文计算后续贡献。
- 原有 HTTP 命令继续可用。增加 `retract-bp { actionId }` 和 `finish-round { roundId }`；控制台只增加对应局部按钮、调整热手提示，不改变布局。
- `retract-bp` 只恢复最近可局部撤回的动作。Pick 已开始或已有后续 BP 时拒绝级联撤回，继续使用指定标记／Ban 修正入口。
- `finish-round` 明确确认指定图结束但暂不指定胜方，可处理该图异常并释放下一 BP。结果待核对集合独立保留。
- 自动计胜使用结构化 `ResultConfirmed` 显示提示，绑定对应比赛记录；旧会话消息文字解析只作展示兼容。

## 已落实行为

热手仅改变直播显示，不再阻止人工或自动比赛操作，也不重置连续性；随时允许手动关闭，房间不会自动改变开关。热手期间保持手动场景意图，比赛事实仍按自身规则处理。

房间稳定换图只确认当时明确的 BP 动作，不从第二次换图推断纠错。图池标记修改不改另一队、真实记录或后续顺序。

中途连续返回 Ready 的原有恢复识别仍保留。中止尝试成为旧记录，同 Pick 建立新准备记录；断线／窗口缺失仍只使证据不足，不据此自动宣布中止或判胜。

EX 开启、准备和比赛开始不扣次数。正常产生胜负时以 Pick 身份扣一次；改胜方保留消耗。明确重赛撤回原尝试的胜点和已知 EX 贡献，保留 Pick／EX 设置，再次正常结束扣一次。人工 EX 校正按队伍独立保存优先级；修正一队不改变另一队的退款资格。撤回赛果但尚未决定重赛，不推导额外补偿链。

正常 tosu 结算沿用现有分数完整性、一致性、防抖和本次比赛连续性校验，直接自动计胜。不增加全员完成证明或人工批准。人工结果与系列校正保留保护；旧图补记只改变旧图赛果、系列分及对应 EX，不切新图画面、不重复释放 BP。

TB 仍须明确准备，达到结束条件停止普通 BP；人工和自动计胜均不自动展示 Winner。中途接入的实时画面、谱面和队分不要求完整 BP，不补造历史开始或赛果。

## 验证

复用既有回归，新增四个连贯业务场景：EX／中止／重赛、旧图补记、新旧 BP 局部撤回、旧会话迁移。保存失败与结构化计胜提示在原有用例中扩展断言。热手、自动替换 Pick、自动 Winner 的旧预期按本轮确认规则更新；没有删除既有测试。

最终结果在本文件末尾记录。测试均使用隔离会话和临时本机端口，没有重启现有直播服务或操作其比赛文件。

## 保留的限制

- `early-ipc`／`coherent-stale` 的上游完整旧快照时序局限仍存在；接收连续性和逐人求和一致不能证明所有真实选手已结束。本次未重复扩展时序对抗矩阵。
- 切到下一谱面后，无法明确关联到旧尝试的新分数不自动补记，保留指定图人工处理。
- 历史 EX 已人工扣除但无凭据时保持未知，不自动推导退款或追扣；直播员可校正次数。
- 控制台全面重设计、开始后的谱面资料编辑、平分扩展不在本轮范围。
- 未进行真实 Windows／osu!tourney／tosu／OBS 验收；WebSocket 模拟通过只证明本地调用链和比赛状态行为。

最终整合验证结果：

| 检查 | 结果 |
| --- | --- |
| `npm test` | 432 / 432 通过，0 失败、0 跳过 |
| `npm run build` | 通过，包含 `vue-tsc --noEmit` 类型检查与 Vite 构建 |
| `git diff --check` | 通过 |
| Windows／原生 tosu／osu!tourney／OBS | 未执行 |

首次全量回归发现两项 WebSocket 测试仍期待“再次换图自动替换 Pick”；已调整为验证原 Pick 不变，再通过明确人工指令改图。最终全量回归包含这两项，没有只用局部通过替代最终结果。该次验证后仅补充文档；后续独立审查修复见下节。

本轮未提交、推送或发布，未重启现有直播服务；新代码尚未加载到该服务。

## 独立审查修复（2026-11-09）

上节 432 项为初次实现的验证记录。本节记录独立审查后的修复；已确认的业务决策保持不变。

| 问题与根因 | 修改位置及结果 | 定向验证 |
| --- | --- | --- |
| 迟到赛果重复扣 EX：只记录消耗后的修订，没有记录开启时的修订 | `model.js` 在 Selection 开启 EX 时记录 `exBaseline`，`records.js` 结算时比较对应队伍修订；修订已变化则保留人工剩余值，消耗记为未知。明确重赛建立新的已知基线，另一队修订不影响该队 | 开启 → 等待赛果 → 同队校正为 1 → 补记／改胜方仍为 1 → 明确重赛后新赛果正常扣一次 |
| 保存失败提前消费证据和期限 | `application.js` 在观察器副本上计算，持久化成功后安装；来源中断写入失败时保留该事实，后续输入先重试该提交，再建立新的观察位置。Pick／暂停恢复／Winner 期限失败后按原本场、期限及目标重新调度，重试间隔 1 秒；旧目标或关闭服务后不重试。`data.js` 显式处理 `sourceStatus()` rejection，允许来源通知重试 | 来源中断写入失败前后领域状态、四个观察器证据一致；恢复存储后即使收到 Ranking 也先提交中断，不补记胜。三个展示期限分别注入保存失败，恢复后各执行一次 |
| 表演赛非 Roll 入口插入正赛 Ban | `rules.js` 提供首次动作、阶段计划和 Pick 补充；`model.js` 的手动起点、阶段跳转和补充统一使用策略。表演赛手动 Ban 只增加该次显式 Ban，其后自动计划仅含 Pick；`set-action`／`set-plan` 保留明确人工队列，不补正赛 Ban。控制台阶段选项读取核心允许列表 | 手动 Ban 后没有第二项隐式 Ban；手动 Pick 交替；Ban 阶段跳转拒绝；显式 `set-action` Ban 不自行生成后续 Ban |
| 换图后无法撤回同一次 Pick | `recordBp` 标明 Selection，`retractionTarget` 将同 Selection 的 `replace-pick` 视为修订，原动作及修订一同撤回；使用当前有效 Pick 方。核心快照提供 `bp.retract` 能力与 action／selection 目标，UI 不再解析历史。过期目标和后续真实 BP 仍拒绝撤回 | 准备 → 换图及更换 Pick 方 → 撤回成功；过期 action 拒绝；后续真实 Ban 保留 |
| schema 2 重载未校验不变量 | `records.js` 的只读 `validateSessionV2` 由应用启动入口调用，校验唯一 ID、当前引用、重赛图、Selection／Result／Attempt 关系、活动尝试数、待核对集合和全部 undo 域。无效 schema 2 在启动时拒绝，不写回文件。schema 1 缺失／循环／分支引用保留原数据并携带明确迁移隔离标记，仍限制自动推断 | 有效 schema 2 重载不变；损坏引用、自循环、重复 ID、多个活动尝试、错误赛果关联、待核对集合及 undo 引用均拒绝，原文件字节保留 |
| 观察器／播出层保留领域资格与 phase 写入 | `RoomAutomation` 不再导入或调用赛事赛果资格策略，向核心提交分数候选及房间事实；核心决定是否接受。返回房间使用带目标的 `room-return` 领域操作更新 phase，`presentation.js` 只写 scene／sceneOverride | 正赛／表演赛既有自动计胜回归；直接调用场景投影不能改变 phase |

新增最小复现集中在 `test/automation-review.test.js`，复用同一组场景数据：修复前 **9/9 失败**，修复后 **9/9 通过**。没有删除原有有效测试。

| 检查 | 独立审查修复结果 |
| --- | --- |
| 相关业务回归（session、ready-return、streaming、pick-scene-delay、warmup、auto-win-banner、BP／重赛／恢复） | 236 / 236 通过 |
| `npm test` | 441 / 441 通过，0 失败、0 跳过 |
| 后续撤回目标匹配小改的定向复测 | 55 / 55 通过 |
| `npm run build` | 通过，包含 `vue-tsc --noEmit` 和 Vite 构建 |
| `git diff --check` | 通过 |
| Windows／原生 tosu／osu!tourney／OBS | 未执行 |

本轮未新增人工批准、全员完成证明、全局人工接管或业务补偿链。存储失败的重试仅重试原提交或原展示期限；`early-ipc`／`coherent-stale` 的已知上游限制仍保留。未提交、推送、发布，未重启现有服务，未操作现有比赛文件。

## 完整原包回放与本地查看（2026-11-09）

私有记录位于 `.local/automation-replay-20261109/`，未提交原包、聊天或选手数据。使用此前 Windows 留存的 14 个原始分片，共 21,396 帧；原包从 HD1 已在 Playing 时开始，赛前 Roll／Ban 不在原始帧覆盖范围。

- 先按记录时间推进归一化及比赛核心，逐条处理全部 21,396 帧。首 Ban 使用用户明确确认的红 HR1、蓝 FM2 作为起点。原记录操作语义单独注入，不混作原始游戏消息。
- 回放发现结算清空客户端列表时，观察器连房间选图基线一起重置，漏掉 DT3 并错移后续 Ban。`validRoom` 现将已知结束后的房间／谱面观察与进行中比赛的客户端资格分开；新增连贯业务回归。修复后完整回放中的第二轮 Ban、NM3 Pick 恢复正确。
- 不重放裁判操作时，旧 FM1 待核对保持独立，普通自动记录为 4:0；按原记录注入等待、系列校正、明确重赛及后续校正后，五张有效图分别按真实队分计胜，最终 5:0，原 FM1 尝试作废且不重复贡献。
- 原速 WebSocket 选段覆盖 HD1 Ready→Playing→Ranking、同一片段加入明确 EX 校正的测试、FM1 重赛后的完整比赛、Ranking→Ready 回图池及结算清窗后 DT3 Ban，共发送 1,786 条原始片段消息。原速调度最大迟到约 203ms；不视为 Windows 原生时序验收。
- 第一次查看截段停在 Ranking，因此保持末帧时不会回图池；补上原始 Ready 帧后确认自动回图池。没有改成计胜瞬间切走结算画面。
- 图池 Star 全空来自隔离服务误将公开 osu 元数据请求也返回 503。已恢复公开谱面／图片读取，同时保持赛事 API 隔离。另发现 FM2 官方 v9 文件缺少内嵌 BeatmapID：仅在官方直接下载路径允许用请求 URL 确认缺失的 ID，显式冲突 ID 仍拒绝；NM 基准计算约 5.06。相关元数据、计算及图片接口 19 项通过。
- 完整回归首次为 440/442；一项便携版测试因本轮回放占用 3001 而失败，释放端口后便携版 2/2 通过；另一项清窗测试先发 10000ms、再回退到 6500ms，已改为连续时间，保留原业务断言，session／ranking-return 77/77 通过。新断点相关回归 156/156、构建及差异检查通过。

用户要求从头查看且指定蓝队先 Pick／红队先 Ban 后，曾临时启动一轮合成模拟；该轮不计入原包验证结论。用户追问来源后已停止合成服务，改为全部原始消息的 1×连续回放，独立文件为 `real-raw-session.json`。本次测试的先手与首 Ban 作为明确初始条件；原始聊天、分数、谱面及客户端内容不改写。完整原速回放约 54 分钟，启动确认不等于已完成整段原速验收。BO11 主版不因原包止于 5:0 就补造第六胜或自动展示 Winner。
