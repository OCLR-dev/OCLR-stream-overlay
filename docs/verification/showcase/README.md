# 独立图池 Showcase 验证

## 自定义测试版同步（2026-11-14）

在独立工作树 `overlay-showcase-custom-sync`，从 `test/custom-match` 的 `9cc8df5` 同步主线 `d3648fa` 至 `ce01cda` 的通用 OBS 与 Showcase 提交。保留自定义赛事入口、阶段／BO／BP、CA、七秒 Pick、独立会话及 OCLR 接口禁用；自定义启动入口增加本地 OBS 控制器，支持同端口的 Showcase 场景创建。图片服务合并 Showcase 图池时保留自定义来源地址所需的会话字段。

主线构建及 529 项回归通过，自定义版构建及 574 项回归通过；两版各另有 2 项便携服务生命周期测试通过。便携测试仅在临时副本中将固定 3001 替换为空闲端口，原 3001 服务和用户会话保持。自定义运行时测试确认 `/api/obs` 与 `/api/showcase` 可用，OCLR 接口仍返回 403；既有自定义背景换源、CA 和比赛恢复回归通过。

以下为此前独立 Showcase 实现的浏览器和数据边界验收记录；Windows 原生 osu!／tosu／OBS 合成仍需实机确认。

日期：2026-11-14（America/New_York）。隔离工作树 `overlay-issue-32`，分支 `codex/issue-32-showcase`。原工作区的 README、OBS 预设和测试未提交修改保留，原 3001 服务、比赛文件、OBS 和发布分支未改动。

## 当前行为与边界

按 [Issue #32](https://github.com/OCLR-dev/OCLR-stream-overlay/issues/32) 的独立 Showcase 需求及用户本轮修正：先录入演示图池，随后按普通 osu! 客户端经 tosu 提供的当前谱面自动识别 Slot。原手工点选、前后切图与可选跟随方式已移除。

录入支持 Slot + 谱面 ID／具体难度链接 + 可选标题，也可复制控制台当前已加载图池；输入停顿 450ms 或失焦自动同步。整份列表通过校验后才应用，无效行保留原列表与编辑草稿。Showcase 图池与独立 Stage 名称保存在 `showcase.json`，控制台后续换场或更换图池不覆盖它；旧手工选择文件兼容迁移为独立图池，旧 Slot 不再生效。

当前 Slot 只由新鲜普通客户端谱面 ID 唯一匹配。池外／重复 ID 时 Slot 为 `—`，仍显示真实客户端谱面信息；断线、过期、无谱面或有效赛事房间／选手时清除旧的实时显示。零值参数保留，空 tourney 占位结构按[官方 v2 格式](https://github.com/tosuapp/tosu/wiki/v2-websocket-api-response)兼容。此路径不要求比赛 Playing，不发出比赛命令或改变 Ban/Pick、局次、比分、赛果、场景和撤销历史。

1920×1080 上方 1920×900 改为 Winner 同款背景与动态效果：深紫渐光／静态网格、共用网格光段、54 枚独立向上漂浮的菱形、13.24s 斜条纹。底部恢复 Playing 三段几何：S11 Logo (30,928) 420×138，谱面卡 (460,928) 1000×138，Stream Chat (1470,928) 420×138；不显示红蓝分隔线或 Match Chat。最上方居中显示独立录入的 Stage，留空隐藏；Showcase 浏览器源始终为 1920×1080、位置 (0,0)、缩放 1，铺满画布。按用户红框的高度参考，中央回放可用区为 (160,100) 1600×800；独立 osu! 采集保持原始比例居中放在该区，Stage 与底栏位于其外。该区域不是浏览器源尺寸，不显示参考红框。

## S11 Logo 来源

从 [官网 S11 矢量横幅](https://oclr.org/branding/oclr-s11-winter-banner.svg) 提取其 OCLR、S11 和小图案三组原始路径，移除背景照片、外框和日期，转为纯白填充／描边；保留原字形、R 星座与原有遮罩。S11 在底栏内与主字形下缘对齐。资产为 `ui/assets/oclr-s11-logo-white.svg`，690×240、20208 字节，SHA256 `c0f4d2b5a54f73e80fad72dc95d22b445999c779905fea53ff11fda020a0d1bc`。以 `object-fit: contain` 等比放入 420×138 区域，没有底板、嵌入照片或外部字体依赖。带背景的旧 WebP 资产已移除。

## 验证结果

- 本轮 `npm run build`（含 Vue 类型检查）与 `git diff --check` 通过，构建仅在隔离工作树。
- Stage／Showcase／独立 OBS／HTTP 专项 **18 项**通过，包括 Stage 保存／恢复、清空、与并发图池编辑互不覆盖、旧文件兼容，以及独立图池、自动 Slot、跨页面 SSE 和路由边界。
- 浏览器以独立 WebSocket → 真实 `TosuClient` → 归一化 → Showcase SSE → 两个页面检查 NM1 自动变为 NM2。图池自动同步、非法行保持、池外／重复 ID、断线清除与恢复、刷新跟随保持。
- 1920×1080 几何复核：Stage 标题位于顶部中央且底边不超过 100px，输入自动同步、清空隐藏、刷新保留；中央回放可用区 (160,100) 1600×800 与标题／底栏不重叠，浏览器源仍为完整 1920×1080。Logo／谱面卡／Stream Chat 的位置与 Playing 三段布局一致；Logo 成功解码本地透明 SVG，实际像素检查确认可见图形为纯白、其余区域透明。Winner 斜纹周期保持 13.24s；Showcase 单独使用 54 枚菱形。实际运动取样确认水平位移为 0、竖直位移向上；Winner 仍使用原 36 枚菱形与 `ambient-diamond-drift`。换图后装饰节点保持同一个 DOM；减少动态偏好下斜纹和菱形动画关闭、网格光段隐藏。
- 1440×1000 操作页与 390×844 手机页无横向溢出；独立干净输出不请求比赛会话或 OBS 管理 API。八组 Playing 人数／比例／EX 捕获与 1000×138 谱面卡几何保持。详情见 [浏览器量测](browser-checks.json)。浏览器无 exception、error 或 warning，比赛会话前后深比较相同。

浏览器复制了现有 3001 服务已加载的完整 19 张图池，仅用于隔离验证，未增造谱面或写回原比赛。WebSocket 信号与截图中的零值参数是**明确的合成验证信号**，不代表谱面正式参数或真实回放；截图中的「阶段预览」也是排版验证文字，不代表正式赛程阶段。池外／重复映射为故障注入测试，未改官方图池。

[Logo 局部预览](showcase-logo-preview.png) · [等待客户端时的输出](showcase-empty-1920.png) · [已匹配谱面的输出](showcase-1920.png) · [桌面录入与自动匹配](selection-1440.png) · [手机操作](selection-390.png)

## 实机边界

未进行真实 Windows 普通客户端 rep、tosu 与 OBS 合成验收，未验证真实观众弹幕。未部署到原 3001 服务或发布 Windows 包。隔离预览读取本机 `127.0.0.1:24050/websocket/v2` 的普通客户端数据；没有数据时显示等待，不自动播放合成信号。
