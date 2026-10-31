# 原尺寸游戏捕获与绿幕

2026-10-30。

主线与自定义测试版均已修改源码并构建。1920×1080 画布保持，4:3 来源为 480×360，OBS 应以 1:1、无裁切放置。6 路位置：

| 槽位 | x | y | 宽 | 高 |
| --- | ---: | ---: | ---: | ---: |
| A1 | 0 | 180 | 480 | 360 |
| A2 | 480 | 180 | 480 | 360 |
| A3 | 240 | 540 | 480 | 360 |
| B1 | 960 | 180 | 480 | 360 |
| B2 | 1440 | 180 | 480 | 360 |
| B3 | 1200 | 540 | 480 | 360 |

等待 / Playing / 单图结算复用 PovGrid。等待选手卡移到底部，Playing/结算不添加窗底身份栏。边框覆盖在来源边缘，不改变捕获尺寸。绿区背景为 rgb(0,255,0)、无图片/文字/子节点，共享输出即时切换避免绿幕混色。

验证：

- 类型检查和生产构建通过。主线完整 196 项测试通过。
- 8 组常规人数 / 源比例 / EX 组合 × 3 场景，共 24 次浏览器检查。三场景逐窗矩形相同；4:3 均为 480×360 整数坐标，16:9 均为 480×270。
- 独立 `/overlay` 使用纯内存验证数据：未绑定房间、无图池/轮次、无 tourney 时显示 tosu 标题、艺术家、难度、星级与参数，同时比分仍未知；共享场景过渡时长为 0s。没有加载或改动实际比赛记录。
- [矩形与纯绿检查](browser-checks.json)、[无房间谱面检查](unbound-map-check.json)。截图：[等待](waiting-1920.png)、[Playing](playing-1920.png)、[结算](map-result-1920.png)、[无房间谱面](unbound-map-1920.png)。

Windows 实机：已核实 Height=1080、TeamSize=3，原始捕获测得 480×360。此前 448×336 缩放校准已被用户否定，本次以原尺寸替代。此前实际合成截图存在纯绿边缘，尚不能据此宣称色键完成。新的源码与前端已通过连接的 Codex 聊天传输、校验并部署至 Windows，真实 `/overlay` 已恢复。

## Windows 最终合成

Windows 独立 `MP5 六路对齐` 场景集合：浏览器源 `http://127.0.0.1:3011/overlay`、1920×1080、scale=1；六路 Client 0–5 均可见、scale=1、位置与上表相同。原测试集合及部署前文件保留。

A/B 隐藏 A1 后仍有相同 1,660 个纯绿边缘像素，定位在 UI。旧 Chroma Key 的邻域取样使低阈值下的边缘残绿；改为只作用于 UI 的 `color_key_filter_v2`，绿色、similarity=10、smoothness=1。旧 `chroma_key_filter_v2` 保留但停用，游戏来源没有色键。

原尺寸初始实际合成有 9,418 个纯绿像素。逐像素色值键消除纯绿后，剩余 34 个近绿像素来自比分说明跨入 y=180 的捕获区；将 `.score-stage` top 从 -764px 改为 -772px 后消除。该修正、等待卡片队色变量均已同步主线、自定义版及 Windows 运行 CSS。

实际 OBS 1920×1080 PNG 像素检查：等待、单图结算、FM 视觉预览，以及恢复后的真实 `/overlay`，纯绿和近纯绿计数全部为 0；红蓝细框、FM 绿色标签保留。预览只验收布局和合成，未以其代替真实结算测试。

Windows 证据位于 `C:\Users\Me\Documents\Codex\2026-10-30\osu-tosu-live-ipc-3-playing\outputs`：`obs-native-restored-live.png`、`obs-native-result-visual-preview.png`、`obs-native-FM-visual-preview.png` 及对应 `.pixel-audit.json`；最终配置 `obs-native-final-collection.json`，SHA256 `796efbdc22171e529073a837ecc1ae524474617422715dbe14e50a7b2ff346a0`。

Windows 最终运行 CSS SHA256：`14eaf20f5b48d0a899f274bf0f1e9a84280d3cfa31e9d5ec12a99e60b90b8c07`。真实未绑定房间的谱面显示已核实；当前 IPC=1，本轮不将其作为 IPC=3 实时比分或真实结算复测通过的证据。

最终缓存处理：Windows HTML 已改为引用新资源 `index-native-14eaf20f5b48.css`，HTTP=200，内容 SHA256 与验收 CSS 一致。旧 HTML/CSS 已保留；普通刷新即可加载，OBS 保持真实 `/overlay`。
