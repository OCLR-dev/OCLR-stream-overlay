# OCLR 直播画面与导播控制台

## 比赛画面

正式比赛使用一个 1920×1080 OBS 浏览器源 `/overlay`。深紫底、左红右蓝的队伍横幅、白色 OCLR 标识和金色系列赢图位贯穿比赛。顶栏使用白色 OCLR 字标，Showcase 底栏与过场使用 S11 版本。[品牌资源](ui/assets/) · [白色字标来源](docs/verification/showcase/README.md#2026-11-17-白色-svg-同步)

| 画面 | 观众看到什么 |
| --- | --- |
| 等待 | 双方完整队员名单、本场赛制规格与到场／就绪状态，底栏展示本场图池概览 |
| Roll | 双方点数、先 Ban／先 Pick 的归属，红蓝队位置固定 |
| 图池 | 按 Mod 分组的谱面、已确认的 Ban/Pick 和逐图胜方。保留 Pick 方与本图胜方各自的队色 |
| Playing | 游戏窗口、实时队分与分差、当前谱面和 Mod 参数。Ranking 在同一个布局中保留本图成绩 |
| Winner | 系列赛结果，支持赛制允许的表演赛平局 |
| 暂停 | 暂停类型与导播设置的时间提示。「即将开始」可启动返场倒计时 |

各场景常驻，切换可见性。比赛聊天和直播间弹幕保留共用区域。Match Chat 显示房间消息和时间，BanchoBot 与已匹配的红蓝槽位有各自的姓名颜色。Stream Chat 的内容由 OBS 弹幕源合成，空白区域保持空白。[场景组件](ui/App.vue) · [聊天显示规则](docs/verification/issue-28/README.md)

## 游戏捕获和比分

- **OBS 图层。** 比赛浏览器源置于各路游戏捕获上方。正式 Playing 使用透明洞口，游戏与 Ranking 共用相同的槽位和位置。每路 4:3 占 480×360，16:9 占 480×270。3v3 两侧第三路各在本队下排居中。等待画面保留选手名单，Playing 窗底留给游戏。Windows 两套预设共用同一应用音频源，场景中的条目默认启用。扫描找到唯一的 Client 0 才绑定，窗口未找到或重名时清空绑定并保持静音等待。人数、比例和 EX 的实际坐标见[播出样式](ui/broadcast.css)与[OBS 预设](server/obs/presets.js)。
- **顶栏。** 队名、队旗、Ban 和 EX 状态共用一套布局。队旗按原比例展示，读取不到时用队名首字。常规比赛显示系列分；Playing 收到双方有效总分后，大字显示本图队分，系列分缩到赢图菱形旁。热身隐藏系列比分与赢图位，仍可显示实时队分。[顶栏实现](ui/components/BroadcastHeader.vue)
- **分差和图卡。** 分差条以中线为零，绝对分差 25 万时达到半条端点；平分归零。准备期按匹配的 NM／HD／HR／DT 槽位预览参数。Playing 和 Ranking 使用实际选手参数，FM 显示有效选手的范围。FM 的 EZ 队分补偿与保存赛果共用服务端计算。[分差刻度](ui/scoreDifference.ts) · [计分口径](docs/verification/fm-ez-scoring/README.md)
- **动效。** 背景斜条带位于内容层后方，Ban/Pick 确认、比分与赢图各用对应反馈。新接入或恢复连接时以已有状态起画。保留减少动态效果偏好，窗口使用稳定槽位标识。

## 导播控制台

`/control` 的「比赛配置」分为「本场资料」「游戏数据」「OBS」三个标签。比赛现场的左侧管理区跟随所选画面。右侧预览当前 OBS Program，显示场景名、缩略图、推流与录制状态，并提供「切回当前比赛布局」。未连接 OBS 时使用 Overlay 网页预览。录像打点由服务端按实际开打和全场结果确认写入本机。

等待、Roll、图池、Playing、Winner 是五个直接切换入口，暂停单独操作。直播员可以中途加入并直接跟随；比赛进度、播出画面、OBS 节目场景各自有独立状态。当前步骤用一句话说明现场情况与下一步，维护详情承载连接和诊断信息。[比赛现场操作](docs/main-operator-contract.md)

## Showcase

`/showcase` 用于配置演示图池、Stage 和 OBS，`/showcase?clean=1` 用作播出源。中央 1600×800 留给普通 osu! 客户端回放，底栏展示 S11 标识、谱面信息和 Stream Chat。按客户端难度 ID 匹配唯一 Slot，未知或有歧义时显示「—」。

启用自动过场的 OBS 场景会在加载回放时遮住游戏。全屏斜幕和纯色遮挡分层；服务端确认回放开始后揭开。过场底栏将当前 Slot 居中，两侧各留三个位置，右侧弹幕在过场期间持续可见。[Windows 接线与过场操作](docs/windows-portable.md#showcase-回放过场) · [过场视觉验收](docs/verification/showcase-cover/integration/README.md)

## 查阅设计决策

按主题查[项目待办与设计索引](docs/design/backlog.md)。需要定位某次样式调整、尺寸演变或当时的参考图，见[设计沿革](docs/history/broadcast-design.md)。

## Windows 启动器

Windows 启动窗口使用 Wails + Vue。桌面将 Node 提供的 `/control` 和 `/showcase` 放在各自的隔离 frame 中，保留网页组件、同源 API、SSE 与独立 OBS 输出。切换桌面导航保留已打开的页面，明确重启后按新的服务 PID 和端口重新加载。最小化继续播出，关闭窗口与「退出服务」共用确认和保存流程。

Go 管理子进程、设置与原生对话框。只有启动器外壳可调用桌面绑定，内嵌页面只能请求切换入口或打开固定用途的浏览器页面。OCLR 授权在同一 Node 地址的浏览器页面沿用网站握手，桌面通过 SSE 看到结果。见 [桌面控制台验收](docs/verification/desktop-control/README.md)。

启动器在启动时选定存储位置。默认使用当前 Windows 用户目录；程序目录存在 `OCLR-portable` 标记时，使用同级 `OCLR-data`，并将比赛目录、回放临时目录及启动器设置位置传给受管的 Node 进程。完全便携模式首次启用时先关闭服务、复制资料，再写入标记。已有两份存储时只切换各自的资料，工具在程序目录内时保存相对路径。[存储与更新说明](docs/windows-portable.md#资料存储与更新)

## 启动器图标与随包 tosu

Wails 顶部品牌区与关于页复用 Windows 应用的 `oclr-stream.ico`，按正方形尺寸等比显示。Windows CI 每次打包解析 tosu 最新正式 Windows release。启动器优先使用有效的明确选择路径，否则定位自身目录中的 `tosu/tosu.exe`；自动检测路径不保存为固定绝对路径。tosu 的配置与工作目录跟随实际程序位置，launcher 只读取端口，不改写其他设置。实现、测试与待验收项见 [验证记录](docs/verification/bundled-tosu/README.md)。
