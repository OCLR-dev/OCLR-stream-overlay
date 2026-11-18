# 控制台 OBS 节目画面与录像打点

**待实施。** 给 GPT 6.2 Sol 的实施方案。使用者是比赛当天临时上手的志愿导播。两项功能都从比赛控制台进入。

## 1. 在比赛控制台看 OBS 当前节目

**导播操作**　打开比赛控制台，右侧预览显示「OBS 节目画面」、当前场景缩略图和场景名，旁边显示推流、录制状态。在 OBS 切到休息场景，两秒左右就能在这里看见休息画面。可返场时，在同一处点击已有的「切回当前比赛布局」。OBS 未连接时，原来的 iframe 继续提供「Overlay 预览」。已连接但取图失败时，保留场景名并显示「暂时读不到画面」。

- 在 `server/obs/controller.js` 复用现有连接、`program`、`programRevision` 和连接代次。用 `GetSourceScreenshot` 截取服务端已知的当前 Program 场景，建议 640px 宽、JPEG。把取图时的场景名和图一起返回。切场景或断线时丢掉迟到的旧图。
- 在 `server/obs/http.js` 加一个本机只读缩略图入口。由比赛页预览区按需读取，约每两秒一次，上一张返回后再取下一张。离开比赛页或标签页隐藏时停止取图。现有 `/api/obs` 继续传轻量状态，截图只发给请求预览的页面。
- 在 `server/obs/socket.js` 的现有订阅上加入 Outputs 类别。连接就绪时通过 `GetStreamStatus`、`GetRecordStatus` 读取初值，此后跟随 `StreamStateChanged`、`RecordStateChanged`。在 `ui/obsControl.ts` 和 `ui/components/OperatorConsole.vue` 接入状态与画面，复用 `canReturn` 和已有返场动作。配置页的 iframe 标作「Overlay 预览」。

## 2. 录制期间自动留下剪辑时间点

**导播操作**　在 OBS 照常开始录制。控制台自动记录开打、重赛开打和全场结果确认。看到精彩片段，点一次「标记精彩时刻」即可。录制结束后展开「录像打点」，点「复制时间轴」即可得到类似下面的文本。

```text
录像 1
00:03:18  HD2 开打
00:05:42  精彩时刻 · HD2
00:07:06  HD2 重赛开打
00:54:20  Winner · 红队 6–4
```

| 标记 | 触发时机 |
| --- | --- |
| 谱面开打 | 自动或人工开打时，用新 `runId` 识别本次开打，显示 Slot 或曲名。自由操作时若没有本局记录，沿用服务端已连续观察到的同房间「准备 → Playing」标记房间谱面，仅写录像时间轴。两种来源对应同一次开打时只记一条。 |
| 重赛开打 | 带 `replayOf` 的局次实际开打。这个时刻只写一条「重赛开打」，方便剪辑直接跳到游戏。 |
| Winner／全场平局 | 现有比赛流程确认全场结果时。覆盖人工确认、Winner 倒计时完成、表演赛平局。单纯切到 Winner 页或取消倒计时均不触发。 |
| 精彩时刻 | 导播点按钮时。带上当前已知谱面，一键完成。 |

- 在 `ObsController.start(store)` 已有的服务端订阅中观察比赛变化。首次接入时若比赛已经在 Playing，就从下一次实际开打开始记录。打开控制台、重复收到同一快照都不会产生新标记。
- 发生标记时立即读 `GetRecordStatus`，以 OBS 返回的 `outputDuration` 毫秒值生成时间码。录制暂停、停止或 OBS 断开期间跳过，恢复后从下一个新事件继续。停录后再开按另一段录像分组，各用自己的时间码。中途接入正在录制的 OBS 时直接沿用它的时间码。若重连时无法辨认是否同一段录像，另起一组并注明「重新接入」。
- 在本机会话数据目录按比赛 ID 保存一份打点 JSON，记录录像分组、时间码、标签和去重用的事件标识。停录、刷新和重启后可读，换场后上一场的文件仍在。写入与比赛保存分开，打点落盘失败在打点区提示。时间轴直接从这份数据生成。首版交付可复制的纯文本，适用于现有录像格式。

## 3. 验收

1. **节目画面选对。** 在 OBS 工作室模式中让 Preview 和 Program 显示不同内容，只切 Preview 时控制台仍显示 Program。将 Program 切到休息，再从控制台返场，核对缩略图和名称同步。断开 OBS 后应看到明确标注的 Overlay 预览。
2. **时间点对得上录像。** 录一段普通开打、同图重赛、手工精彩和 Winner，暂停录像期间触发一次事件，然后停止并另录一段。核对标记数量、分组，并用复制出的时间码在视频里找到相应画面。补测取消 Winner 倒计时和已确认的表演赛平局。
3. **关掉控制台也能打点。** 关闭控制台后触发一次服务端开打，再打开应只有一条。自由操作下，直接接入 Playing 时没有开打标记，随后完整观察到的一次开打有一条。模拟 OBS 暂不可用时比赛仍能正常推进。扩展现成的 `test/obs-fixture.js` 验证这些路径。
4. 运行相关 OBS／会话测试及 `npm run build`，检查 1440px 和 390px 控制台里的预览、返场和复制操作。交付说明分别列出自动化检查结果与实际完成的 OBS 录制验证。

从包含本方案与本轮文档整理的提交创建功能工作树，衔接主线后续改动。动手前读项目 `AGENTS.md`、`README.md`、`DESIGN.md` 及其中关联的 UI 修改说明。工作量集中在现有 OBS 连接、比赛订阅和控制台；每项新增检查都应能指出它避免的具体错误。

协议依据见 [Program 场景](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md#getcurrentprogramscene)、[场景截图](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md#getsourcescreenshot)和[录像状态与时间码](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md#getrecordstatus)。
