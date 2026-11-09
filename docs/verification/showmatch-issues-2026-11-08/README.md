# 表演赛现场问题登记与原因调查（暂不修复）

登记日期：2026-11-08。用户要求先记录六项问题、调查原因，不立即修改功能。

后续用户已授权开始修复。以下保留首次调查快照；当前修复结果见 [已实施修复与验证](FIXES.md)。

本轮仅新增调查文档与隔离诊断结果，不改源码、比赛记录、运行服务或发布包；未在 GitHub 发帖、重开 Issue 或提交推送。

## 调查基线

- 本地 main：`96d54f4`，调查前工作区干净。
- 用户指定的 [v0.0.7 Release](https://github.com/OCLR-dev/OCLR-stream-overlay/releases/tag/v0.0.7)：源码为 `7bf28594a8566f179bfc99e3e2895721e1ddc29d`。该提交在本地 Git 对象中可读；本轮另行检查其启动器代码，避免用本地 main 的旧启动器代替发布版。
- 实际下载 `OCLR-Windows-x64.zip`，SHA-256：`176be19c6d1f8b8da77609d435cc7944a9b738af849abff9482fedc38c088813`，与 GitHub Release asset digest 一致。
- 包内 build：`5f77ea7a7637b94a73fd68a175e1551fffd2a3104b46b9759cc613b4a090eb1a`；Node `22.23.4`；前端资源 `index-MPfzWE8m.js` 中包含连续计数、120ms 插值及减少动态效果判断。
- GitHub 元数据通过只读 API 核对；源码及解包资源检查在 macOS 上完成，不是 Windows / OBS 实机复现。

现场补充：闪退的表现是启动器先提示“本机服务已停止”，随后关闭。背景停动与分数跳变来自不同 Windows 电脑，不能假定具有相同现场原因。各机动画偏好和 OBS 配置尚未知。

## 1. 保留 Roll、只跳过 Ban 后，Mappool BP 队列不生效

**状态：确认了可复现的代码原因；具体现场操作记录仍待核对。**

表演赛与正式比赛存在不同路径。`server/session/model.js` 的 `syncRollFlow()` 对表演赛直接 `return false`，即使 Roll 胜方、先 Pick、先 Ban 都已填写，也不自动建立 action / queue。现有 `test/streaming.test.js` 甚至明确断言表演赛 Roll 后 `action === null`，理由是网站数据没有裁判 BP 规则。这是现有实现的明确限制，不是 Roll 数字读取失败。

另一个独立问题：`set-plan` 只修改后续 queue，不把首项提升为当前 action。若表演赛 Roll 后 action 为空，即使手动填写两项 Pick 队列，仍会得到 `queue.length === 2`、`action === null`、`canApply === false`；自动换图没有可执行的当前动作。

本轮使用 **v0.0.7 包内服务端代码**，构造纯内存合成表演赛，依次导入、确认 Roll、配置后续 Pick 队列，复现以上两个状态。见 `diagnostic-results.json`。

还需区分“空 Ban”和“跳过 Ban 阶段”：`skip-ban` 要求已有可执行的 Ban action，只消费一个 Ban 槽；不会凭空创建 Pick 队列，也不代表跳过两轮全部 Ban。`jump-bp-phase` 和显式选择队伍 Pick 是另外的路径，会创建当前动作；不能把这些按钮视为同一行为。

后续验证：核对现场使用的是空 Ban、阶段跳转、仅填写队列还是直接选队 Pick；确认当时 action / queue / bpFlow、Warm-up、暂停、已准备本局及异常状态。现阶段不修改表演赛规则，也不擅自套用 S11 的两轮 Ban。

## 2. Windows 何时出现“本机服务已停止”后关闭

**状态：提示的触发链已确认；本次现场的最初触发原因未确认。**

v0.0.7 的 `tools/windows-launcher/main_windows.go`：

1. 每 3 秒请求一次 `http://127.0.0.1:3001/api/health`，HTTP 客户端超时仅 1 秒。
2. 请求错误，或 project / build / ready / session 不匹配时，等 1 秒后再查一次。
3. 第二次仍失败即发送 `msgServiceStopped`，显示用户看到的提示；确认提示后销毁启动窗口。
4. 启动器结束会关闭子进程 stdin；`server/portable.js` 的 stdin close 监听会有序停止后端。

因此该提示既可能是 **Node 已经退出**，也可能是 **服务仍活着但连续两次健康检查超时或失败**。后一种情况下，启动器会进一步把后端带着退出。仅凭此提示不能判断是进程崩溃，更不能断言是 tosu 断线或切图造成。

代码明确存在的触发条件包括：后端异常退出/被结束；系统负载或主线程长阻塞导致两次本机健康请求失败；健康响应不再匹配本包。后两项是可达代码路径，不代表已在现场确认。

历史上已确认的闪退原因是便携入口创建图片处理器时捕获空 session，首次读取封面/元数据发生 TypeError 和未处理拒绝，使 Node 退出。PR #20 / `58f39ff` 已修复；**v0.0.7 已包含这项修复**，不能直接用旧缺陷解释本次事故。详见 [旧图片请求退出记录](../portable-artwork-crash/README.md)。

诊断缺口：启动器将 stderr 保存在内存 buffer；正常运行后弹出此提示时没有展示异常堆栈，也未在本路径写出持久崩溃日志。缺少现场 stderr、退出码与健康检查耗时，暂时无法给出唯一根因。启动端口占用、数据恢复失败、未完整解压属于另一类启动失败提示，应分开登记。

后续取证应围绕提示出现前的动作、时间点、Node 是否仍存活、health 是否超时及 stderr；由维护者采集，不增加普通直播员逐局操作。

## 3. 背景动态效果何时会不动

**状态：确认主动停动条件；现场是否命中尚未确认。**

- `ui/lazer-ribbons.css` 的 `prefers-reduced-motion: reduce` 会强制 `animation: none !important`，条带保留静态构图。旧网格/菱形也有相应的减少动态效果分支。这是明确的主动静止条件。
- `LazerRibbonEdge.vue` 只在 Playing / Mappool 显示；其他场景隐藏此层、使用各自装饰。不能以其他场景没有条带认定卡死。
- 条带是无限 CSS 动画，只在循环边界重新随机外观，不依赖 tosu 心跳、比分、音频或 SSE；正常 tosu 断开本身不会调用暂停背景的逻辑。
- OBS/browser surface 被停止渲染、源被关闭，或渲染进程/图形环境异常，也可能呈现静帧。这些属于待现场排查项，本轮没有 Windows/OBS 证据证明发生了哪一种。

后续区分：文字和比分也一起冻结，还是只有装饰不动；控制台预览和 OBS 是否一致；运行该页面的浏览器环境是否匹配 reduced-motion；换场景、重新显示源、刷新后是否恢复。与第 5 项来自不同电脑，不合并归因。

## 4. NM 图池为什么没有 Star 参数

**状态：未发现 NM 被禁用；确认了失败后无法恢复的前端缓存问题。**

Mappool 的 `MapColumns.vue` 对所有模组卡片调用 `/api/beatmaps/{id}/metadata/{mod}`；NM 会请求 `/metadata/NM`。`mapStarDisplay()` 只使用 `calculation.stars`，普通元数据 stats 中没有预计算星级，因此缺少计算结果就显示未知，不能从 CS/AR/OD 推造星级。

v0.0.7 包含 NM 计算分支（mods=0）及 rosu-pp-js。macOS 上调用实际包内计算器，对同一合成谱面运行 NM/HD/HR/DT 均得到有效星级；这证明包内算法支持 NM，不是 Windows 实机或现场真实谱面的验收。

确认的恢复缺陷在 `ui/mapMetadata.ts`：模块级 cache 永久保存 Promise；HTTP 非成功、网络异常等返回 null 后，MapColumns 虽删除自己的 requested 标记，但再次调用只拿到缓存的 null Promise，不再请求服务器。隔离探针模拟首次 503、第二次本可成功：调用两次，实际 fetch 只有一次，两次结果均 null。

首次失败的可能来源仍需取证：官方 .osu 下载超时/不可用、谱面校验或计算失败、5 秒计算超时、谱面已不属于当前图池、无效 ID 等。前端最多并发 2 项，服务器公共文件请求间隔 1 秒；NM 排在最先加载，但这不足以证明失败一定只发生在 NM。

后续需要具体 NM 谱面 ID、对应 metadata/NM 响应状态及正文、同页 HR/HD 是否正常、刷新后是否恢复。不要把“缓存失败会持续”写成“现场首次失败原因已查明”。若用户指的是 Playing 底栏，其正式参数另从匹配当前谱面的 tosu 星级读取（`MapInfo.vue` / `mapParameters.ts`），需另查 tosu 原始字段，不能直接套用 Mappool 下载链。

## 5. v0.0.7 分数仍直接跳到上报值，没有连续变化

**状态：排除官方 ZIP 缺少该实现；现场禁用或观感原因待确认。**

[Issue #17](https://github.com/OCLR-dev/OCLR-stream-overlay/issues/17) 需求是数值持续追赶目标，不是字形缩放/弹跳；main 提交 `15e7513` 为 v0.0.7 祖先，实际 ZIP 的已构建 JS 也包含 ScoreCounter 和 120ms 算法。不能归因于源码改了却未打入此官方 ZIP。现场运行的资源是否确实为该 ZIP，仍需核对 build / 资源名。

当前有以下明确条件：

- 顶栏实时队分才使用 ScoreCounter，系列赢图以及其他位置数字没有统一启用该插值。
- 正式共享输出仅在连接 synced、有效房间 IPC=3（Playing）、动效基线已建立时允许计数。
- reduced-motion 或 document.hidden 时直接显示目标；Ranking（IPC=4）、首次显示、重连、新局/run/谱面/作用域变化、未知恢复、归零及向下纠错也直接显示准确值。
- 开启时是每次上报后 **120ms** 线性追分，随后停在目标；上报间隔更长时仍会经历静止段。这并非整段游戏时间都持续变化，也没有复刻 osu! 原生计数算法。低帧率下可见的中间帧还会更少，但现场帧率未知。

后续首先核对该电脑的实际 build、页面位置、IPC、连接稳定性、reduced-motion、页面可见性以及目标上报间隔/实际渲染帧率。不能因另一台电脑背景停动，就认定这一台也是减少动态效果造成。

Issue #17 当前按源码完成关闭，并明确保留 Windows/OBS 验收边界；本条登记为现场验收未满足，未擅自重开或关闭问题。

## 6. Match Chat 最上方留一行空白

**状态：定位到固定截取和贴底布局；是否恰好一行及完整几何仍待截图/实测。**

`ui/useOverlay.ts` 固定 `.slice(-4)`，最多传最近 4 条聊天；`ChatBox.vue` 并没有额外插入一个空白 `<p>`。实际使用 compact fieldset + legend，`ui/broadcast.css` 中内容高度 100%、`justify-content: flex-end`，每条 line-height 为 20px、上下有 padding，聊天外框固定 138px。

因此，四条短单行消息只有 80px，贴底后上部自然留下余量，较高面板也不会自动多取几条补满。另有 fieldset/legend 与内容 height:100% 的高度分配需要测量，可能影响可用区和裁切；消息换行、tosu 空消息也需区分。现阶段不把精确的一行留白归因于某一个 CSS 像素值。

后续以现场同一组聊天测量 legend、content 和每条消息的矩形；验证空消息、四条短消息及长消息换行时，最旧/最新消息是否被裁掉。修复目标需保留最新消息可见及跨场景常驻，不在此轮改布局。

## 本轮验证与尚未完成事项

- 23 项现有针对性测试通过：`test/score-counter.test.ts`、`test/streaming.test.js`、`test/beatmap-metadata.test.js`。首次运行一项因沙箱禁止监听本机端口而失败，允许本机临时监听后同组 23 项全部通过；不是功能修复后的通过。
- 独立探针复现：包内表演赛 Roll 不建立 action/queue；仅 set-plan 后仍无可执行 action；前端元数据失败 Promise 不重试。
- 包内计算器对合成谱面的 NM/HD/HR/DT 都可计算；不使用合成谱面冒充实际图池或比赛数据。
- 未修改源码、未启动/重启现有直播服务、未运行 Windows exe、未操作 OBS、未进行真实比赛结算验收。
- 下一轮需要现场证据才能定案的部分：服务退出/健康检查失败的原始原因；两台电脑分别的动画和渲染状态；真实 NM 的首次请求失败原因；Chat 的准确空白和裁切尺寸。
