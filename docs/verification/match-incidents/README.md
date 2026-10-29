# 本图异常流程验收

日期：2026-10-28（America/New_York）。实现定义见 [异常与观战恢复](../../design/match-incidents.md)。

- `npm run build`：类型检查与生产构建通过。
- `npm test`：62 项通过，含新增 5 项会话状态用例和 1 项真实本机 WebSocket 传输的异常组合用例。测试传输的是合成 tosu 数据。
- 开打前取消保留同一个准备轮次、Pick、后续行动队列和 EX，不生成一次已开打重赛。
- Playing 后非正常退出、一路观战窗口缺失与 tosu 数据丢失会挂起，不根据仍在发送的旧 Ranking / 新 Playing 帧恢复自动计胜。
- 裁判确认重赛建立关联的新尝试和新 run ID；保留原 Pick 与 EX，归还 Ranking 时取出的下一队行动，旧尝试不计胜。
- 观战恢复仅在当前图有效 Playing 时可确认继续；保持原 round / run ID。观战中断期间本局已结束时，人工记录必须填写核对说明。
- 异常持久化恢复、无理由拒绝人工计胜、正常完成后去重计胜通过。

浏览器验收使用独立的 3006 / 24052 模拟服务，不修改用户在 3005 上的模拟比赛。实测“标记开打前取消 → 继续等待本图 → Playing → 模拟 Panic → 标记观战故障 → 确认继续 → Ranking”，界面始终为 #1，最后系列分 1:0，当前动作为下一队 Pick。刷新保留异常；控制台与模拟面板未见前端 error / warn。

- [开打前取消](prestart-abort.png)
- [Panic 与重赛分别处理](panic-recovery.png)

尚未进行真实 osu!tourney / tosu / OBS 联调；合成 Panic 初始化 / 恢复顺序不作为真实客户端行为的证据。
