# 独立图池 Showcase 验证

日期：2026-11-14（America/New_York）。隔离工作树 `overlay-issue-32`，分支 `codex/issue-32-showcase`。原工作区的 README、OBS 预设和测试未提交修改保留，原 3001 服务、比赛文件、OBS 和发布分支未改动。

## 当前行为与边界

按 [Issue #32](https://github.com/OCLR-dev/OCLR-stream-overlay/issues/32) 的独立 Showcase 需求及用户本轮修正：先录入演示图池，随后按普通 osu! 客户端经 tosu 提供的当前谱面自动识别 Slot。原手工点选、前后切图与可选跟随方式已移除。

录入支持 Slot + 谱面 ID／具体难度链接 + 可选标题，也可复制控制台当前已加载图池；输入停顿 450ms 或失焦自动同步。整份列表通过校验后才应用，无效行保留原列表与编辑草稿。Showcase 图池单独保存在 `showcase.json`，控制台后续换场或更换图池不覆盖它；旧手工选择文件兼容迁移为独立图池，旧 Slot 不再生效。

当前 Slot 只由新鲜普通客户端谱面 ID 唯一匹配。池外／重复 ID 时 Slot 为 `—`，仍显示真实客户端谱面信息；断线、过期、无谱面或有效赛事房间／选手时清除旧的实时显示。零值参数保留，空 tourney 占位结构按[官方 v2 格式](https://github.com/tosuapp/tosu/wiki/v2-websocket-api-response)兼容。此路径不要求比赛 Playing，不发出比赛命令或改变 Ban/Pick、局次、比分、赛果、场景和撤销历史。

1920×1080 上方 1920×900 改为 Winner 同款背景与动态效果：深紫渐光／静态网格、共用网格光段与环境菱形、13.24s 斜条纹。底部恢复 Playing 三段几何：S11 Logo (30,928) 420×138，谱面卡 (460,928) 1000×138，Stream Chat (1470,928) 420×138；不显示 Match Chat。回放采集由直播员放到 OBS 浏览器背景源上方，并限制在上半区。

## S11 Logo 来源

从 [S11 官网公开配置](https://oclr.org/api/v1/tournaments/s11/configuration) 核对 `data.edition.branding.logo`，下载其指向的 [官方 Logo](https://oclr.org/oclr-s11-square-logo.webp)。本地资产为 `ui/assets/oclr-s11-logo.webp`，1200×1200、46124 字节，SHA256 `1852b340393743f32d5813d8163eb35a7dca7ca0c49231ed20cefb976fade2c2`。原图字节保持，以 420×138 容器居中裁切上下留白，无运行时官网依赖。正式静态资源白名单增加 WebP 类型，仍限制为扁平构建资产。

## 验证结果

- 本轮 `npm run build`（含 Vue 类型检查）与 `git diff --check` 通过，构建仅在隔离工作树。
- Showcase／OBS／HTTP 专项 **40 项**通过，包括独立图池、自动 Slot、跨页面 SSE、图片文件类型与访问边界，以及独立 OBS 创建／重试／常规 EX 保持等回归。
- 浏览器以独立 WebSocket → 真实 `TosuClient` → 归一化 → Showcase SSE → 两个页面检查 NM1 自动变为 NM2。图池自动同步、非法行保持、池外／重复 ID、断线清除与恢复、刷新跟随保持。
- 1920×1080 几何复核：Logo／谱面卡／Stream Chat 的位置与 Playing 三段布局一致；Logo 成功解码 1200×1200 本地 WebP。Winner 斜纹周期 13.24s，36 个共用环境菱形与网格光段存在；换图后装饰节点保持同一个 DOM，减少动态偏好下斜纹和菱形动画关闭、网格光段隐藏。
- 1440×1000 操作页与 390×844 手机页无横向溢出；独立干净输出不请求比赛会话或 OBS 管理 API。八组 Playing 人数／比例／EX 捕获与 1000×138 谱面卡几何保持。详情见 [浏览器量测](browser-checks.json)。浏览器无 exception、error 或 warning，比赛会话前后深比较相同。

浏览器复制了现有 3001 服务已加载的完整 19 张图池，仅用于隔离验证，未增造谱面或写回原比赛。WebSocket 信号与截图中的零值参数是**明确的合成验证信号**，不代表谱面正式参数或真实回放。池外／重复映射为故障注入测试，未改官方图池。

[等待客户端时的输出](showcase-empty-1920.png) · [已匹配谱面的输出](showcase-1920.png) · [桌面录入与自动匹配](selection-1440.png) · [手机操作](selection-390.png)

## 实机边界

未进行真实 Windows 普通客户端 rep、tosu 与 OBS 合成验收，未验证真实观众弹幕。未部署到原 3001 服务或发布 Windows 包。隔离预览读取本机 `127.0.0.1:24050/websocket/v2` 的普通客户端数据；没有数据时显示等待，不自动播放合成信号。
