# 网站自动授权与直播任务选择（#3）

2026-10-31，基于 main `adb633f`。网站配套：OCLR-website #616。

- 完整 `npm test`：218 项通过；`npm run build`（含 `check`）：通过。
- 最后调整刷新期间任务选择保留后，相关 streaming/session 回归 68 项通过。
- 两端实际 UI（网站 React `StreamingConnect` 与 overlay Vue `StreamingAccess`）在 Chrome 1440px、390px 验证：打开登录窗口、网站授权点击、精确 origin/window/state 回接、自动关闭窗口、自动出现两个任务、选择第二项、缺少赛制仍能导入、断开后保留本场；手动复制重连也不覆盖本场，凭证输入立即清空。无 pageerror 或横向溢出。
- 浏览器结果：[JSON](browser-results.json)、[桌面](tasks-1440.png)、[手机](tasks-390.png)。使用临时本机服务、内存会话和合成 HTTPS 授权/任务响应；未读取 `.env.local`，未登录真实网站、未发行真实凭证或更改现有服务。
- 安全及资料回归覆盖：一次性 state、错误赛季/伪造/重放/取消、授权隔离、多任务选择和翻页、缺少规则保留人工阶段与人数、失效清空、断开保留本场、API 契约及大小限制、初始化后导入与撤销。

旧 `streaming-api/` 截图及记录是上一版手动复制/单个下一场的历史证据；本次以此目录及 `docs/streaming-api.md` 为准。

网站新连接页需与本次 overlay 更新一同安装；未部署，真实 osu! 登录、Streamer 续租/撤销及 OBS 联调仍需使用者验收。新增中文提示待审阅。CI 以 PR 的确切提交实况为准。
