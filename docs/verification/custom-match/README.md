# 自定义赛事隔离验证

## R2（2026-10-30）：同步main通用修正

明天MP5实测包为 `MP5-Xronicle-Windows-x64-20261030-r2.zip`，替代此前free-console包。通用修正同步自main `b622db1`：中途初始化可保留实际房间连接／WebSocket与自动化意图，未观察的旧Ranking不补计胜；初始化后一次撤销回到原比赛；局部改图不把重复Playing误作新事件；保留可点击的清除标记和模式选择；当前谱面重复槽位不猜模组；保留空Ban与独立TB处理。MP5的17图、CA、BO9、单轮Ban及专用数据目录不变，未合并OCLR凭证或比赛文件。

针对性59项回归通过，含MP5配置、特殊规则、真实本机WebSocket与旧连接隔离，以及新增初始化／撤销／展示连续性用例；类型检查与生产构建通过。此为隔离模拟与打包验证，Windows原生权限和真实tosu联调仍待用户复测。同步不提交／推送测试分支。


## 2026-10-30 自由控制台与中途加入（最新）

以完整BP约束加入前的 `c4c9fcd` 控制台主操作为回退基线，保留自定义队名、阶段／BO、图池、CA、tosu配置与修正记录。主界面移除真实BP队列、强制补做和重复执行按钮；四个队伍Ban/Pick可先选模式或先选谱面，点击即应用。选择当前Pick可以跳过未跟踪的历史游标，不伪造早先Ban；已有开打、赛果和播出标记保持独立。已结束或进行中的比赛仍可改标记，不新增实际Ban/Pick或改赛果。没有图池不再强制打开设置页。

参考官方 lazer 源码：
- [MapPoolScreen](https://github.com/ppy/osu/blob/master/osu.Game.Tournament/Screens/MapPool/MapPoolScreen.cs)：自由Red/Blue Ban/Pick模式、点谱面应用、自动建议后续模式。
- [MatchIPCInfo](https://github.com/ppy/osu/blob/master/osu.Game.Tournament/IPC/MatchIPCInfo.cs) 与 [FileBasedIPC](https://github.com/ppy/osu/blob/master/osu.Game.Tournament/IPC/FileBasedIPC.cs)：状态、谱面、分数独立读取；池外谱面可单独获取。
- [GameplayScreen](https://github.com/ppy/osu/blob/master/osu.Game.Tournament/Screens/Gameplay/GameplayScreen.cs)：展示绑定IPC状态；本项目保留原有结果连续性、人工纠错与去重保护，不照搬Ranking加赢图逻辑。

新增展示跟随独立于结果观察器：首次连接时已在IPC3也显示Playing；缺少BO、图池、名单或BP不影响实时展示，原始玩家明细不完整也不妨碍房间队分显示。只有连接live、同步正常、explicit房间绑定及无异常时展示IPC3队分，非Playing清空。谱面显示跟随房间，不把准备图或未知BP当成实时画面的必需条件。未观察到有效开打的Ranking不能补记赛果，显式暂停、手动画面覆盖、系列结束与事故处理边界保留。

最终针对性验证39项通过（live-scores、live-playing、action-first、automation-lifecycle），类型检查与生产构建通过，没有重复全套回归。浏览器1440px/390px控制台与1920×1080 Playing检查通过，窄屏documentWidth=390，输出无error/warn。空图池、空rounds、未知BO的隔离会话首次连接即自动Playing，234,567/765,432实时队分可见；独立测试中可不补先前Ban直接选择当前Pick。所有输入均为隔离模拟，未完成Windows真实tosu最终复测；无OBS操作。

证据：[控制台1440](midjoin-control-1440.png)、[自由图池1440](free-mappool-1440.png)、[390](free-mappool-390.png)、[1920 Playing](midjoin-playing-1920.png)。仅重载独立3011服务；原3007/24053仍为PID31704。无提交或推送。本次新包名 `MP5-Xronicle-Windows-x64-free-console.zip`，旧Windows发行包按用户要求清理。

## 2026-10-30 Playing 实时队分修正

用户 Windows 实机反馈：tosu live、实际房间左右绑定有效、IPC 3，但 Playing 没有比分变化。查到前端错误地要求当前 BP round 存在且谱面匹配，才显示房间队伍总分。现将 Playing 队分与 BP 本局记录解耦，保留连接、来源、明确房间绑定与异常保护；自动开打、结算记胜和参数同图核验未改动。

仅运行新增3项针对性回归及类型检查／构建，未重复全套测试。随机端口独立离线模拟，经真实本机 WebSocket/SSE 验证：无任何 round 时，Playing 从123,456／654,321更新为234,567／765,432，series仍0:0、rounds仍空。截图见[live-score-fix.png](live-score-fix.png)。此为模拟验证，Windows真实tosu需用户换包后复核。原3007/24053、3011比赛资料与OBS未操作。

已重建 `release/MP5-Xronicle-Windows-x64.zip`，并提供唯一别名 `MP5-Xronicle-Windows-x64-live-score-fix.zip`；保留当前独立数据目录，不要求重新初始化比赛。

日期：2026-10-30（America/New_York）。分支 `test/custom-match`，worktree `/Users/me/Documents/osu!tour/overlay-custom-match`，起点 `5b888c6`。没有提交或推送。

## 隔离与运行

开始前原仓库 `main` 工作区干净，目标分支／worktree 均不存在，随后新建。原 3007／24053 由 PID 31704 监听，测试全程未停止、重启或写入这两个服务；不操作 OBS。测试仅运行新工作区的 3011／24054，另有自动回归的随机本机端口（用后关闭）。

使用 `server/custom-match.js` 独立入口，不调用 OCLR 环境配置或资料适配器。OCLR API 请求返回 403，服务端拒绝打开非自定义会话。会话在新工作区 `.local/custom-match/session.json`；不复制原比赛或凭证。动态 WebSocket 地址与实际左右队名由手动设置明确录入，旧连接排队事件不能写入新来源。

最初交付时测试资料通过初始化存入独立 archive，恢复为空白自定义比赛；随后已按用户提供的真实资料预装 MP5 Xronicle，最新状态见下节。缺少 BO／BP／有效连接时不执行自动推进，自动化意图保持开启。控制台与只读输出地址见[使用说明](../../custom-match.md)。

## 回归

- `npm run check`、`npm run build`、`git diff --check` 通过。
- 最终 `npm test`：**183 / 183** 通过，包括原有 171 项与自定义／背景切换新增 12 项。
- 新增 `test/custom-match.test.js` 覆盖未知 BO／BP 等待、阶段与 BO 独立、非法 BO、BO1 正常一图、非 OCLR 顺序、规则编辑／冻结／手动纠错、改图、重赛、作废、空 Ban、播出标记独立、异常恢复、系列结束／TB、持久化／撤销、初始化、隔离 WebSocket、旧 Ranking／重连保护、非自定义文件拒绝与旧连接排队事件隔离。
- `test/artwork.test.js` 新增动态地址背景切换，不复用旧 tosu 服务器缓存；原封面／参数校验继续通过。

明确标记为“隔离测试”的规则为：**先 Ban 蓝／红／蓝／红（双方两个 Ban 全做完）→ 从红队开始交替 Pick**。它与 OCLR 的双方首 Pick 后再第二轮 Ban 不同。先 Ban／先 Pick 独立选择；服务器生成并推进当前和后续动作，普通操作不需要逐项手工安排整场。

真实本机 WebSocket 集成回归使用临时自定义会话：四个连续 Ban → Pick → 准备期换图 → Playing → Ranking 自动记胜 → 撤回 → 重复 Ranking → 人工改胜方 → 切换断开地址 → 重连旧 Ranking。验证只计一次，人工纠错保持，队伍轮换不改变；结束与记胜分离，其余重赛和系列边界由状态回归与已有真实 WebSocket 用例交叉覆盖。临时实例全部关闭。

## 浏览器

浏览器实际操作现有控制台，录入并修改标题、双方名称、自由阶段、BO7→BO9、逐行图池、BP 规则、WebSocket 地址和实际左右房间绑定；空名单仍可开始配置和 BP。刷新后保留全部有效配置、四个 Ban、准备图与后续动作。改动已引用谱面的标题可同步，刷新不丢进度。BO8 明确拒绝，继续播出上次 BO9；菱形双方各 5 个。

| 检查 | 结果／证据 |
| --- | --- |
| 1440px 控制台设置 | 无横向溢出，`scrollWidth=1440`；[截图](control-1440.png) |
| 390px 控制台设置 | 无横向溢出，`scrollWidth=390`；[截图](control-390.png) |
| 非 OCLR BP 桌面／手机 | 当前为第二轮 Ban，后续仍为另一方 Ban，未提前 Pick；[1440](bp-1440.png) / [390](bp-390.png) |
| 1920×1080 图池输出 | 四列、紧凑角标、原队旗占位与聊天保留；[截图](mappool-1920.png) |
| 1920×1080 Playing | 原稳定槽位与游戏捕获占位保留；[截图](playing-1920.png) |
| 八组游戏窗口几何 | 3v3／4v4 × 4:3／16:9 × 普通／EX，Playing 与单图结算逐窗完全同位同尺寸；[原始量测](geometry.json) |

未更改场景挂载方式或 `PovGrid` 的稳定选手 key。场景、比分与系列目标不会重建游戏窗口。浏览器输出检查未见前端 error / warn；封面网络失败仍使用原占位。游戏窗口仍是捕获待接入占位，未验证真实游戏视频。

## 结算时序与真实联调边界

`npm run sim:timing -- --out docs/verification/custom-match/result-timing.json`：**17 种中 15 通过、2 个既有风险**，按设计退出码 1。见[本次报告](result-timing.json)。IPC 提前到 Ranking 且整份分数仍为一致旧快照时，仍可能提前计胜；本次未声称解决，也未用任意延迟掩盖。人工核对／纠错与旧帧保护继续保留。

所有游戏输入均为合成信号，经实际本机 WebSocket、现有 tosu 归一化、观察器、共享会话与浏览器输出链路验证。**没有真实 osu!tourney／tosu 联调、OBS 操作、真实房间指令、推流或录制。** 不读取或写入 OCLR 线上赛事资料。


## Windows 完整包与用户真实资料（后续交付）

按用户本次表格与队名截图生成 `configs/mp5-xronicle-swiss-2.json`。共17张：NM5、HD2、HR2、DT3、FM2、CA2、TB1；左红“好麻烦啊......”、右蓝“我发现队友都玩osu”，BO9先5，阶段只写瑞士轮，不猜具体轮次。未使用表格中静态星级替代现有实时参数链路。CA新增独立显示与录入分类，沿用现有紫色和四列布局，不猜模组或回退NM模拟计算。名单、队旗仍可缺失。BP、tosu地址、实际房间左右绑定全部留空等待。常规窗口人数仍是未核实的4v4默认占位。

最终 `npm test` **186/186通过**，含新增真实配置与CA参数边界；`npm run build`（含类型检查）及diff检查通过。[完整日志](windows-regression.txt)。1920×1080浏览器量测17张卡片全部位于图池内，CA两张、双方5个菱形；[真实配置截图](mp5-real-mappool.png)。未触及PovGrid或游戏窗口挂载方式。

`release/MP5-Xronicle-Windows-x64.zip` 包含交叉编译的原生x64启动器 `MP5-Xronicle-Test.exe`、已固定SHA256校验的官方Windows Node归档中提取的运行时、构建前端与真实比赛配置。无需安装依赖。独立固定3011地址、独立进程互斥量和 `%LOCALAPPDATA%\OCLR\CustomMatchTest` 数据目录，不迁移或读取原OCLR数据、不加载凭证、不启动模拟器；原生启动窗口的退出/复用行为继续使用已有实现。

压缩包内每个文件的SHA256清单已核对，两个exe均为PE AMD64，未含环境文件、凭证或本机会话；见[包检查](archive-check.json)。使用Mac Node实际运行包内后端，覆盖中文／空格路径首次预装、静态入口、OCLR禁用、退出重启保留修改、重复启动拒绝、原StreamOverlay目录保护；见[后端检查](windows-package.json)。**这不是Windows原生exe运行验收**；Windows实机启动、真实osu!tourney／tosu与OBS联调仍未完成。

Windows操作步骤见[完整说明](../../custom-match-windows.md)。Mac3011也装入相同真实资料，未连接任何tosu；原3007／24053未动。无提交／推送。


## 按动作操作与本场单轮Ban（2026-10-30修正）

用户明确本场双方第一轮各Ban一张，然后自动交替Pick，没有第二轮Ban。MP5配置现使用 `single-ban-alternate` 预设，无需提供或填写整场BP文字。先Ban方可通过Mappool下一动作明确选择；两Ban完成后独立选择一次先Pick方，后续由服务端推进。可直接采用已有首Ban记录，拒绝静默丢弃第二轮Ban历史。不改变改图、重赛、异常、旧帧保护和结束/计胜分离；中途修复首Ban也不会重置既定Pick轮换。

Mappool新增四个“下一步：队伍Ban / Pick”按钮，未选谱面时可点击设置真实待执行动作；等新的有效tosu换图才操作谱面。无连接时等待，人工补做时再选择谱面。纯播出标记仍在独立区域。准备图/进行中不能被下一动作跳过，保留TB与系列停止边界。旧的正在防抖的换图不会被新动作消费。明确提前选择队列中同一动作时只移到当前一次，其余后续保持相对顺序。

最终自定义版全套 **194项通过**，主线通用交互 **176项通过**；类型检查和构建通过。新增动作与单轮Ban相关8项回归，覆盖两个首Ban后持续交替、独立先手、空Ban/撤销、准备改图/重赛、采用已有记录、OCLR队列保持、旧换图去重和中途Ban修复。[本次日志](action-first-regression.txt)。实际浏览器1440px/390px无横向溢出，未选谱面时动作按钮可用：[桌面](action-first-1440.png) / [手机](action-first-390.png)。

仅通用交互同步发布到OCLR main，不带MP5资料或单轮Ban规则，不改变原OCLR顺序。3007/24053运行中服务未重启，不把代码推送说成既有服务已加载。Windows包已更新同一下载路径；原生Windows和真实tosu联调边界保持。

## R3 tosu 未启动恢复

修复 Windows R2 实机截图中的 WebSocket 错误回调递归崩溃。主线 37 项、自定义分支 28 项定向回归通过（含共同用例），两侧类型检查和构建通过。见 [R3 包内后端回归](r3-package.json) 与 [压缩包校验](r3-archive.json)。

使用临时 Windows 数据目录及包内真实后端，以主机 Node 验证：已保存的 tosu 地址端口未监听时仍启动，控制台及输出 HTTP 200、友好提示、自动化保持开启；随后独立模拟器上线，自动恢复 Playing 与变化的分数，不补造局次或赛果。验证未运行 Windows exe，真实 tosu 时序仍需 Windows 实机复测。仅暂停并恢复独立 3011；原自定义会话字节一致，3007／24053 和 OBS 未动。旧 R2 包已删除，仅保留 R3。
