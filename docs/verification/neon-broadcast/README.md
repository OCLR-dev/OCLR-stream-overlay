# Neon Broadcast 改版验证

日期：2026-10-28（America/New_York）。按用户提供的 `osu! 組隊賽直播界面.html` 直接重构 Vue 直播 UI，并融合项目已有 S11 规则。参考文件未修改，也未复制其比赛规则、正式队名或示例赛果。

提交前复核（2026-10-28）：`npm run build`（含类型检查）、`npm test`（18/18）与 `git diff --check` 通过。首次测试受沙箱回环端口监听权限限制，获准后完整重跑通过。该轮未重复浏览器截图检查，未做真实 tosu / osu!tourney / OBS 联调。`docs/design/` 的控制台、自动 BP 与自动切画面方案均为待实现设计。

## 本轮变化

- 深紫细网格背景、红蓝斜切队伍横幅、中央 OCLR S11 盾牌、白色大比分与菱形赢图位。
- 顶部为本图总分和固定中线分差，底部为带封面占位、参数及模组侧栏的紧凑谱面卡。
- 图池改为参考稿的模组横排卡片，保留既有 18 个本地示例、Ban/Pick 状态、S11 Ban/EX/先手状态与聊天；不代表正式图池数量或分布。
- 等待、全场胜利、暂停同一套深紫视觉；胜者未知不自动推断。
- 清除旧样式中多轮覆盖的广播主题层，外部控件与缩放留在 `ui/styles.css`，新广播视觉集中在 `ui/broadcast.css`。
- 本地字体 Saira Condensed 700/800、JetBrains Mono 500，复用工作区已有字体资产，中文使用系统回退。

## 已执行检查

- `npm run build`：Vue 类型检查及 Vite 构建通过。
- `npm test`：18 passed，0 failed，包含数据/代理边界、生产资源隔离、URL、EX/TB、Ban 与阶段星位测试。
- `git diff --check` 通过。
- 浏览器复核六场景；逻辑画布均为 1920×1080。截图是在本机浏览器视口内等比缩放后的画面，并非 OBS 原生输出。
- 八组组合（常规 3v3/4v4 × 源 4:3/16:9 × 无 EX/EX）下，Playing 与单图结算的窗口、源画面矩形逐项相同；4/6/8 路数量正确，源比例与 contain 均通过。顶部队名无垂直裁切，游戏窗无姓名/角色栏。
- 五态分差：左小/大领先为中线到 -80/-300px，右小/大为中线到 +80/+300px，平分为 0；数字为对应演示分差。条带端点固定在中线。
- 实测重复 HD Ban 拒绝并回显、空 Ban、B 队 EX 激活后双方减员且不扣次数、TB 恢复常规人数并禁 EX、TB Ban 选项禁用。
- 决赛 7 个菱形；切回小组后清除越界 7 并保留真实 0；右队 `row-reverse` 镜像填充。
- 实测 FM 提示、场景切换、C 干净输出、Esc 恢复、数字键切场景；六场景始终挂载。
- 双方到场后就绪保持未确认；技术暂停隐藏暂定时长，战术暂停次数不自动消耗。
- 浏览器 error/warn 日志为空。减少动态偏好的 CSS 关闭路径已检查，未切换系统偏好。

原始记录见 [browser-checks.json](browser-checks.json)。

| 场景 | 截图 |
| --- | --- |
| 改版前 Playing | [before-playing.png](before-playing.png) |
| 等待 | [waiting.png](waiting.png) |
| 图池 | [mappool.png](mappool.png) |
| Playing | [playing.png](playing.png) |
| 单图结算 | [map-result.png](map-result.png) |
| 全场胜利 | [victory.png](victory.png) |
| 战术暂停 | [pause.png](pause.png) |
| EX 2v2 / 16:9 / FM | [ex-2v2.png](ex-2v2.png) |

截图最右侧可能出现本机翻译扩展浮标，它在广播画布外，不属于 UI。

## 交付边界

本地开发预览为 <http://127.0.0.1:3003/>，构建产物已更新到被忽略的 `dist/`。未提交、推送或部署。

本轮仅修改 UI 和说明，仍为本地演示与源画面占位，没有连接真实 OCLR、tosu、osu! tourney 或 OBS。没有进行 Windows 字体回退、真实客户端或播出性能验收。未重新读取线上规则，以项目已有 S11 映射为准。

## 结算聊天调整（2026-10-28）

单图结算底部改用与图池共用的 `ChatPanel`，不再显示谱面卡；Playing 保留谱面信息，结算顶部队伍总分、分差与游戏源位置保持不变。聊天仍为本地占位内容。

本次 `npm run build` 与 `git diff --check` 通过。浏览器复查八组人数/源比例/EX 组合，Playing 与结算窗口及源矩形一致；每组结算均有聊天且无谱面卡，Playing 均有谱面卡且无聊天，图池聊天正常，error/warn 日志为空。未重跑数据层测试或进行真实 tosu/OBS 联调。详见 [result-chat-checks.json](result-chat-checks.json)，结算截图已更新。

## DT 图池与六行比例调整（2026-10-28）

图池补齐 NM/HD/HR/DT/FM/TB 六类，DT 使用青绿色。保留此前占位，并加入两个 DT 占位，共 20 个本地演示条目；数量和分布不代表正式图池。行数由共享模组列表派生，标题区从 64px 调整为 52px、行间距从 10px 调整为 8px，每行约 84px；卡片文字行高和状态标签位置同步调整，保留底部聊天区。

当前谱面模组、URL 恢复、Ban 演示选项和校验同步支持 DT；同队重复 DT Ban 按“NM/FM 以外不可重复”的既有口径拦截。

本次 `npm run build`、3 项现有 UI 状态测试与 `git diff --check` 通过。浏览器验证六行均在 1920×1080 逻辑画布内，TB 行在聊天区上方，20 个卡片标题/副标题均无垂直裁切；DT 选项、Ban、重复拦截和刷新恢复正常，error/warn 日志为空。图池截图已更新，原始记录见 [dt-mappool-checks.json](dt-mappool-checks.json)。本轮未连接真实图池、tosu 或 OBS。

## 直播间 Chat 位置与两个聊天框（2026-10-28）

按用户标注图，Playing 右下角加入独立直播间 Chat，位于逻辑画布 x=1470、y=928，尺寸 420×138；中央谱面卡保留，与右侧 Chat 有 10px 间距。移除该位置原有蓝色装饰线，聊天框不覆盖游戏源。

Mappool 和单图结算底部由三个示例消息卡改为两个完整聊天框，左侧“比赛聊天”、右侧“直播间 Chat”。比赛与直播间聊天分别保留独立区域，所有聊天框复用 `ChatBox`；目前仍是内容占位，没有接入直播平台或 tosu 聊天。

本次 Vue 类型检查、Vite 构建和 `git diff --check` 通过。浏览器检查八组人数/源比例/EX 组合，Playing 与单图结算游戏窗口和源矩形一致；Playing 仅有右下角直播间 Chat，结算页有两个聊天框且无谱面卡，图池也有两个框。框体均处于画布内且互不覆盖，error/warn 日志为空。未重跑数据层测试或进行真实播出联调。原始记录见 [chat-placement-checks.json](chat-placement-checks.json)，Playing、Mappool 和结算截图已更新。

## 固定直播间 Chat 尺寸（2026-10-28）

用户确认 OBS 直播间 Chat 不应随场景缩放，改为在 Playing、Mappool、单图结算三个场景中固定同位同尺寸：1920×1080 逻辑画布的 x=1470、y=928，宽 420、高 138。图池与结算底部不再左右等分，左侧比赛聊天占剩余 1178×138，右侧直播间 Chat 保留固定区域。位置和尺寸由共享 CSS 变量维护。

浏览器已确认三个场景直播间 Chat 的矩形完全一致；图池/结算的比赛聊天均位于 x=268、y=928，1178×138，两框间隔 24px。Playing 与单图结算游戏窗口矩形一致，error/warn 日志为空。截图已更新，原始记录见 [fixed-chat-checks.json](fixed-chat-checks.json)。已通过构建及 diff 格式检查；本轮未操控 OBS 或接入真实聊天源。

## 谱面卡与 Chat 上下对齐（2026-10-28）

Playing 谱面卡调整到 x=460、y=928，1000×138，与固定直播间 Chat（x=1470、y=928，420×138）顶部/底部对齐，保持 10px 横向间隔。两者共用顶部偏移和高度变量；谱面参数区收紧，FM 提示仍完整保留。

本次构建与 diff 格式检查通过，浏览器八组人数/源比例/EX 组合均满足对齐和固定 Chat 坐标，Playing/结算源矩形一致，FM 提示与参数区无重叠，error/warn 日志为空。检查见 [footer-alignment-checks.json](footer-alignment-checks.json)，局部预览见 [playing-footer-aligned.png](playing-footer-aligned.png)。未进行真实 OBS 联调。
