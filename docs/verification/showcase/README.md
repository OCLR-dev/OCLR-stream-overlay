# 独立图池 Showcase 验证

日期：2026-11-14（America/New_York）。基于 `c604f07`，隔离工作树 `overlay-issue-32`，分支 `codex/issue-32-showcase`。原工作区的 README、OBS 预设和测试未提交修改保留，原 3001 服务、比赛文件、OBS 和发布分支未改动。

## 最新需求与边界

已通过 GitHub API 读取 [Issue #32](https://github.com/OCLR-dev/OCLR-stream-overlay/issues/32)，核对正文更新时间 `2026-11-14T07:47:07Z`，无评论。实现范围为独立 `/showcase` 页面、已加载图池选图、Playing 同款谱面信息、Stream Chat、独立 OBS 场景创建，以及可选普通客户端 tosu 谱面参数。普通客户端 rep 的游戏／窗口采集由直播员自行配置。

`/overlay` 保持比赛输出用途，Showcase 不加入其场景枚举。专用 `/api/showcase`、`/api/showcase/events` 只读取本场图池，展示选择与参数开关写入独立 `showcase.json`。不修改比赛场景、Ban/Pick、局次、系列分、赛果和撤销历史。比赛进度与客户端换图均不改变展示选择，本场或图池更换后旧选择失效。

可选参数复用现有服务端 tosu 连接；只接受新鲜、无有效赛事房间／选手且 ID 匹配的顶层谱面数据，不新建第二路游戏连接。tosu v2 的空 tourney 字段及零值占位客户端按[官方 v2 结构](https://github.com/tosuapp/tosu/wiki/v2-websocket-api-response)兼容，不把占位数据当真实赛事；有效队名或选手、错图、断线与过期均不补参数。未观察到的值保持 `—`。

## 验证结果

- `npm run build`（含 Vue 类型检查）通过，构建仅写入隔离工作树的 `dist`。
- 回归 524 项通过；固定端口的便携版 2 项在临时副本内将 3001 替换为空闲端口 50096 后通过，共 526 项。未停止现有 3001 服务。
- 最终 Showcase／OBS／HTTP 专项 36 项通过，含独立保存与重启恢复、读写隔离、空池与换池、零值／过期／错图／tourney 参数、多页面 SSE、同源限制、请求大小和私有资源隔离。
- OBS 模拟器覆盖：仅创建 Showcase 浏览器源；不自动添加游戏、窗口或音频采集；不切 Program、不启用比赛跟随；常规／EX 捕获几何保留；重复创建保留人工位置和解锁；同名／替换场景拒绝覆盖；创建及锁定中断可重试；常规、EX 与 Showcase 复用同一直播间弹幕输入。
- 浏览器检查 1440×1000 操作页、390×844 操作页和 1920×1080 独立输出。选择 NM1 → NM2 在独立页面同步，刷新保留；按 HR 查找；手机无横向溢出；选图前后比赛会话逐字相同；干净输出不请求比赛会话或 OBS 管理 API；无浏览器 exception、error 或 warning。
- 1920×1080 输出测量：回放区域 (0,0) 1920×900；谱面卡 (30,928) 1430×138；Stream Chat (1470,928) 420×138。上方 1,728,000 像素 alpha 全为 0，底栏内容不覆盖捕获区域。
- Playing 共用组件拆分后检查八组常规人数／源比例／EX 组合，原捕获尺寸与 1000×138 谱面卡保持，数据见 `browser-checks.json`。
- `git diff --check` 通过。

浏览器预览只读复制了现有 3001 服务已加载的完整 19 张图池，来源标记为 `oclr-streaming`，edition 为原值 `s11`。这只是隔离布局验证，未重新核验该图池的官方赛季状态，没有增造谱面或把它写回本场。

[独立输出截图](showcase-1920.png) · [桌面选图](selection-1440.png) · [手机选图](selection-390.png) · [浏览器量测](browser-checks.json)

## 实机边界

未进行真实 Windows 普通客户端 rep、tosu 与 OBS 的合成验收，也未验证真实观众弹幕。本次 OBS 证据为有状态模拟器，截图上方透明区不包含真实游戏画面。未部署到原 3001 服务、未发布 Windows 包。
