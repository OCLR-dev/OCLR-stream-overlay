# Windows 便携版谱面图片请求导致服务退出

## 问题与修复

基线：`e52dd726e70404f9160702e7f35b1bf5a90a89ef`（PR #19 的 Windows 预览版）。

便携入口先创建 HTTP 服务并绑定固定端口，然后恢复比赛并赋值 `config.session`。原图片处理器在创建时捕获空的 `session`，后续不会重新读取 `config.session`。控制台或输出请求 `/api/beatmaps/{id}/cover`、背景或元数据时，`matchingLive` 解构空快照抛出 TypeError；HTTP 异步处理器没有兜底，Node 因未处理的拒绝退出。原生启动窗口随后显示“本机服务已停止”。只要浏览器恢复后再次请求图片，重启仍会重复。

图片处理器改为逐次取得当前会话；会话尚未附加时返回 404。初始化后只使用当前图池，撤销后可重新读取恢复的图池。HTTP 请求的未预期异常返回脱敏的 `REQUEST_FAILED`，不终止整个服务。未改动比赛文件格式、初始化存档和撤销逻辑。

## 本机验证

- 修复前通过与便携入口相同的“先创建处理器、后附加会话”顺序复现 `Cannot destructure property 'live' of 'snapshot' as it is null`。
- `npm run build` 通过。
- `npm test`：412 项全部通过。
- 新增处理器回归覆盖未加载会话、后附加图池、初始化与撤销；真实 HTTP 检查覆盖图片请求异常脱敏及服务继续响应。
- 便携服务子进程检查覆盖图池封面、持久化重启、程序目录更新、初始化后旧图返回 404、健康检查与撤销恢复封面。

Windows 原生 ZIP 验证脚本也新增 cover/list/fullsize/background、初始化、撤销和重启后的封面检查，由 Windows Actions 执行。本机为 macOS，以上本机结果不等同于 Windows GUI、真实 tosu／OBS 验收。
