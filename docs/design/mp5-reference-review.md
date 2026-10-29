# MP5 直播操作方案参考核对

日期：2026-10-28。用户提供 [Mother-Ship/mp5-stream-overlay](https://github.com/Mother-Ship/mp5-stream-overlay)。已通过 GitHub API 与 raw 源码读取 master，核对提交 `3a66536f2baa9a379a51a818bd8601a2ac613ac9`。本次为源码对照，没有安装、运行参考项目，也没有复制其代码或素材。

## 实际操作方式

- README 要求直播员切到相应 OBS 场景，再使用浏览器源的“交互”调整比赛阶段、图池轮次和 BP。仓库分别提供 BAN_PICK、PLAYING 和两个 Showcase 页面。
- BP 页面直接提供红色 Ban、蓝色 Ban、红色 Pick、蓝色 Pick，配合可点击的图池。当前操作方和动作通过按钮及队伍高亮表达；有自动 BP 开关、撤销和清空按钮。
- 自动 BP 订阅 tosu v1 `/ws`，观察 `menu.bm.md5` 的变化，用当前动作和谱面 ID 执行一次操作；`canAutoPick` 控制一次消费。其跳过 TB 的逻辑来自 MP5 裁判约定，不能用作 OCLR 规则。
- 后续 BP 顺序来自 `matchstages.json`。Ban 后推进；Pick 后等待 Playing 页面写入推进标志。BP 页每 200ms 检查该标志。
- BP 撤销会移除最后一次选图、存储中的操作和相关单图记录，再回退阶段。清空 BP 使用三秒内第二次点击确认，属于其批量清空操作设计。
- Playing 读取 `tourney.manager.ipcState`：Playing 隐藏比赛聊天、展示谱面信息，Ranking 后延迟十秒展示聊天并设置 BP 推进标志。它没有使用本项目的独立 `map-result` 共享场景。
- 系列星数直接跟随 `tourney.manager.stars`。BP 页观察星数 +1/-1，为对应 Pick 标记或撤回胜方；这不是依据最终队分自动增加本地系列分。

## 同步与恢复

`COMMON/lib/bracket.js` 将 BP 序列和阶段推进标志写入 localStorage；`mapStats.js` 按 beatmap ID 保存单图资料。页面恢复和定时读取依赖同源、同一浏览器存储环境。所读控制路径没有提供供普通浏览器和 OBS 独立浏览器共同订阅的服务端比赛会话。两个页面分别连接 tosu，socket helper 在关闭后一秒重连。

因此，这套源码可以参考直播员的操作组织，但不能直接证明“在普通浏览器控制，OBS 独立浏览器输出”能够共享状态。本项目继续使用服务器唯一观察器、轮次 ID、持久化命令与 SSE；同图重赛和多输出去重仍按现有模型处理。

## 对当前 OCLR 控制台的建议

| 参考中的做法 | 当前实现 | 建议 |
| --- | --- | --- |
| 四个队伍/动作按钮 | 动作与队伍下拉框，再设置当前动作 | 可增加四个直接入口，同时明确 Ban 槽位；每次提交仍走现有 `set-action` 校验 |
| 直接点击图池条目 | 手动选图下拉框，再执行 | 控制台可增加紧凑图池按钮，显示 Ban/Pick/已打状态并复用 `apply-bp`；只读输出保持无操作 |
| 自动 BP 开关和撤销位于操作区 | 自动设置在预览下折叠区，撤销在比赛记录区 | 将启用/挂起/锁定状态及撤销入口靠近当前 BP 动作，减少比赛中滚动 |
| 明确的 BP 顺序配置 | 人工设置当前动作及已确认队列 | 显示清晰的行动序列与当前位置；继续只使用本场已确认顺序 |
| 出错后关闭自动、人工纠正再开启 | 已有锁定、撤销、逐局修正与系列分校正 | 保留纠错入口和旧帧不覆盖保护，明确恢复后重新建立基线 |

以上是待实施的控制台交互改进，本次没有修改 UI 或运行逻辑。观众端继续沿用当前深紫视觉；OBS 始终同一个 `/overlay` 浏览器源。正常结算按最终队分自动加赢图，支持人工逆向纠错；不改为追随上游星数，不引入 OBS 场景切换或确认流程。图池数据继续来自 OCLR 只读 API 与明确人工输入。

## 源码定位

- [README](https://github.com/Mother-Ship/mp5-stream-overlay/blob/3a66536f2baa9a379a51a818bd8601a2ac613ac9/README.md)：OBS 场景与交互操作说明。
- [BP 页面](https://github.com/Mother-Ship/mp5-stream-overlay/blob/3a66536f2baa9a379a51a818bd8601a2ac613ac9/MP5_BAN_PICK/index.html)：操作按钮。
- [BP 逻辑](https://github.com/Mother-Ship/mp5-stream-overlay/blob/3a66536f2baa9a379a51a818bd8601a2ac613ac9/MP5_BAN_PICK/index.js)：`handleMatchStageChange`、`tryAdvanceMatchStage`、`doAutoPick`、`setupMapListeners`、`undoBeatmapSelection`、`onStarChanged`。
- [Playing 逻辑](https://github.com/Mother-Ship/mp5-stream-overlay/blob/3a66536f2baa9a379a51a818bd8601a2ac613ac9/MP5_PLAYING/index.js)：`handleIpcStateChange`、`toggleChat`、赛事星数渲染。
- [BP 存储](https://github.com/Mother-Ship/mp5-stream-overlay/blob/3a66536f2baa9a379a51a818bd8601a2ac613ac9/COMMON/lib/bracket.js)、[单图记录](https://github.com/Mother-Ship/mp5-stream-overlay/blob/3a66536f2baa9a379a51a818bd8601a2ac613ac9/COMMON/lib/mapStats.js)、[连接管理](https://github.com/Mother-Ship/mp5-stream-overlay/blob/3a66536f2baa9a379a51a818bd8601a2ac613ac9/COMMON/lib/socket.js)。
