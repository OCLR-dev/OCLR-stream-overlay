# 聊天新条目动效（2026-11-15）

## 行为

- MATCH CHAT（左下）：新消息到达时，已有消息向上移动；最新一行从下方 8px 处淡入，时长 280ms。首条消息也播放进入动画。消息按内容加出现序号生成稳定 key，队名颜色更新不会重新播放动画。
- STREAM CHAT（右下）：内容由 OBS 中的 blive.chat 浏览器源绘制，不在本页 DOM 内。blivechat 自身已通过 `#items` 的 `translateY` 平滑上移旧消息；本次向 OBS 源注入同样的 280ms 淡入动画，覆盖普通弹幕、醒目留言和大航海消息。
- 减少动态效果时，两侧都直接显示，不播放位移或淡入。
- 已有 OCLR 弹幕预设会在下次连接 OBS 时自动升级；直播员自定义过的 CSS 保持原样。

## 验证

- `npm run check`、`npm run build`、完整 `npm test`（545/545）通过。
- 无头 Chromium 用隔离预览页检查：空聊天占位仍在顶部；首条和后续消息的 `opacity` 从 0 连续升至 1，旧行位置在 280ms 内上移；稳定后消息顺序和底边位置不变。
- 单独检查注入后的 Stream Chat CSS：`animation-name` 为 `oclr-chat-line-in`，280ms 后 `transform` 回到 `none`。
- 未连接真实 OBS 和 blive.chat 做画面验收。开播后仍需在实际弹幕流中确认一次右下角效果。
