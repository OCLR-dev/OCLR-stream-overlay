# Playing 谱面参数接线

日期：2026-10-28（America/New_York）。原有未提交的控制台、异常处理与模拟器更改均保留；本次只接线参数并扩展隔离模拟验证。

## 字段口径

核对 [tosu 官方 v2 类型](https://github.com/tosuapp/tosu/blob/master/packages/tosu/src/api/types/v2.ts)、[输出实现](https://github.com/tosuapp/tosu/blob/master/packages/tosu/src/api/utils/buildResultV2.ts) 与 [谱面计算实现](https://github.com/tosuapp/tosu/blob/master/packages/tosu/src/states/beatmap.ts)。

| 卡片 | 原始字段 | 显示 |
| --- | --- | --- |
| ★ | `beatmap.stats.stars.total` | 整图星数，不用 `live` |
| CS / AR / OD | `beatmap.stats.{cs,ar,od}.converted` | tosu 提供的转换值，不回退 `original` |
| BPM | `beatmap.stats.bpm.common` | 常用 BPM，不用实时 BPM 或 min/max 补空 |
| 时长 | `beatmap.time.lastObject` | 毫秒转 `m:ss`，向下取整到秒 |

时长为原始谱面时间轴至末物件的长度，包含开头等待；不等同音频长度、物件间净时长或按倍速折算的实际用时。不从 `mp3Length`、当前播放时间、模组标签或选手数据推算补值。参数属于 tosu 当前所选实例，不合并不同选手模组；仍需实机核对该实例是否正确。

原适配层已透传 `stats` 并规范化 `time`，卡片此前固定写死 `—`。现在适配层进一步把上述数值的缺失、字符串和非有限数转成 `null`，保留真实 0；卡片对负值也显示 `—`。UI 通过原共享会话与 SSE 响应式读取，不新增连接。

只有共享会话已同步、tosu 为 live、stable-tourney 房间左右队名匹配，且当前帧 beatmap ID 与本局已选图一致才展示。过期、断线、错房间、错图或无当前选图时全部显示 `—`。演示页继续为空。字段按当前帧独立更新，不缓存旧参数。

## 验证

- 当前含其他未提交改动的工作区：`npm run build`（含类型检查）、`npm test`：65 passed / 0 failed；`git diff --check` 通过。
- 提交前按改动内容隔离暂存，并导出独立副本再次验证：构建通过、55 passed / 0 failed。本次提交不包含原有控制台、比赛异常处理与结算诊断改动。
- 新增归一化测试覆盖零值、缺失、字符串、NaN/Infinity 和原始帧不被修改。
- 新增真实本机 WebSocket → 归一化 → SessionStore → SSE 测试，覆盖同图参数更新、部分/全部缺失、零值，以及参数变化不推进比赛版本。
- 使用已有模拟器，独立端口 24052 / 3006；不加载凭证，不访问线上数据，不改正式本机会话。
- 浏览器通过模拟器按钮完成 Ban HD1 → Ban HR1 → Pick NM1 → Playing；直接操作新增“模拟参数样本”下拉框。无刷新即可从 `6.2 / 4 / 9.3 / 8.5 / 180 / 3:00` 更新为 `7.35 / 5.2 / 10.3 / 9.7 / 210.5 / 4:05`。
- 部分缺失仅保留 AR 9.8，其余 `—`，证明不会用 original、实时 BPM、音频时长或旧帧补值；全部缺失为六项 `—`；零值为五项 `0` 和 `0:00`。
- 错房间、暂停发送超过 stale 阈值、切到池外其他谱面均清空参数；恢复有效帧后可重新显示。
- 逻辑画布仍为 1920×1080，浏览器视口 1280×720 等比缩放；截图检查参数行未溢出，原游戏窗口与 Chat 布局保持。输出与模拟器浏览器 error/warn 日志为空。

浏览器记录：[browser-checks.json](browser-checks.json)。截图：[同图更新](playing-updated.jpg)、[部分缺失](playing-partial.jpg)。

可用 `npm run sim -- --app-port 3006 --ws-port 24052` 重现，在 Playing 中切换五组明确的合成样本。它们只存在于开发模拟器；不充当生产默认值。

本次完成的是模拟数据经真实本机 WebSocket/SSE 到界面的验证，尚未完成真实 tosu / osu!tourney / OBS 联调。

## 2026-10-30 后续

正式环境保留上述 tosu 来源、同图／同房间和转换值口径，并新增 HP。用户明确：当前模拟测试应使用真实谱面文件并显示模组后的参数与星级；现由 rosu-pp-js 按对应模组计算并标注「测试 · HR 参数」等，计算结果不作为正式环境的自动回退。详情及更新后的浏览器证据见 [模组参数与图池标签](../mod-parameters-labels/README.md)。
