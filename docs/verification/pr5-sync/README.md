# PR #5 同步到自定义测试分支

日期：2026-11-02（America/New_York）。来源：[PR #5](https://github.com/OCLR-dev/OCLR-stream-overlay/pull/5)，主线合并提交 `179a988`；测试分支基线 `b1aac7d`。

同步等待页选手身份卡、头像与封面、名单 UID 输入、图池封面／难度名／模组配色和新版网格。只移植该 PR 的差异，不合入其他 main 历史。

三处冲突的处理：保留 CA 分类；名单格式化与自定义阶段／BO／BP 字段并存；新增玩家图片路由，但不引入测试版已移除的直播授权模块。开发代理默认指向自定义服务 3011，README 使用 `npm run custom`，避免连接普通模拟会话。

## 验证

- `npm run build`：类型检查和生产构建通过。
- `npm test`：357 passed，0 failed、0 skipped。包括自定义赛事、MP5 模板、BP／TB、纠错、真实本机 WebSocket、玩家图片和名单输入用例。
- `git diff --check` 通过。
- 3020 端口内存会话，从仓库现有 MP5 完整配置载入 17 图；未读取现有比赛文件或环境凭证，未接 tosu。
- 生产 `/overlay`：1920×1080；17 图全部显示，含两个 CA 条目；5 列、7 行，无卡片滚动溢出；浏览器 error 日志为空。
- `/control` 显示自定义赛事标题、瑞士轮、BO9、先赢 5 图和全部 CA 条目。点击等待后共享输出同步显示新版身份卡与两侧聊天，Stream Chat 内容为空。空名单保持未知，不伪造选手。

[图池截图](mappool.png) · [等待截图](waiting.png)

现有 3011 服务与比赛文件未改动、未重启；未重新制作 Windows 包。本记录仅证明源码回归及隔离浏览器预览，不代表真实 Windows／osu!tourney／tosu／OBS 联调验收。
