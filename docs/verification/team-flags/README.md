# 真实队旗接入（Issue #52）

2026-11-16，基于主线 `f4b68fa`，分支 `codex/issue-52-team-flags`。

直播任务的 `nextFixture.home.team`／`away.team` 保留已校验的 `avatarKey`。普通公开队伍目录同样保留版本标识，经本场规范化进入会话、快照和保存文件；旧会话没有该字段时正常使用首字回退。队名和名单修正保留图片，左右换位按队伍 ID 移动，不按队名或选手国家推测队旗。历史归档没有图片字段时不补造。

前端通过本机 `/api/teams/{teamId}/avatar?v={avatarKey}` 读取图片。本机只允许 UUID 队伍 ID 和图片版本，将请求重定向到配置的网站源下相同的公开图片接口，不转发开发者或直播身份码，不接受任意图片 URL。重定向不缓存；版本变化生成新 URL。网站仍决定图片是否公开。

`TeamFlag.vue` 替换原固定 SVG，占位旗不再出现在正式或演示画面。顶部和赢图横幅分别保留 120×72／150×90 容器，图片按原比例 contain，居中留边。加载中、缺字段、单侧／双侧无图、旧归档和自定义表演赛无图片、请求失败均使用深色中性首字标识，不显示破图图标。每个 URL 使用独立图片节点，切换时清除加载状态，迟到的旧请求不能覆盖新图。赢图横幅取触发该次播出时的队伍资料。

网站侧只读复核了 `public-competition.ts`、`competition-read-contracts.ts`、`team-media.ts` 和 `/api/teams/[teamId]/avatar`：当前图片键由 UUID 生成，上传规范化为静态 WebP，公开媒体接口无需 Overlay 凭证。

验证结果：

- `npm run build`：类型检查和生产构建通过。
- `npm test`：551 项通过，0 失败。新增回归覆盖直播任务字段投影、无效键拒绝、显式导入、普通目录、保存恢复、改名保留、换位／版本更换／撤销、旧会话和媒体重定向限制。
- `node tools/verification/team-flags.mjs`：隔离 Chrome 共 10 类检查通过。覆盖独立 `/overlay`、共享父页快照的 `/control` 预览、左右双方赢图横幅、宽／高图片 contain、换位、版本变化、旧请求迟到、无图／404 回退、刷新不重播历史赢图；六场景和八组人数／比例／EX 组合的队旗容器不移动，换旗不重建现有游戏捕获节点。使用减少动态效果，运行时无异常。
- `git diff --check`：通过。

浏览器数据与截图全部使用明确的合成队伍、图片及赢图事件，无真实比赛写入，没有读取本机凭证、连接 tosu 或修改 OBS。复跑先执行 `npm run build`，再运行上述脚本；需要本机 Chrome 和本机端口监听权限。

[原占位旗试排](../team-flag-preview/header.jpg) · [图片加载](overlay-images.png) · [左侧赢图](banner-a.png) · [右侧赢图](banner-b.png) · [无图及失败回退](fallback.png) · [控制台预览](control-preview.png) · [浏览器检查数据](browser-checks.json)

真实图片和播出验收仍待完成：本次只读请求线上匿名 `/api/v1/tournaments/s11/teams` 返回空集合；赛季列表仅 S11 为当前数据库赛事，其他公开季为历史归档，没有从旧赛季补造队旗样本。当前没有可用于本单验收的已公开带图队伍或真实授权直播任务。待网站发布带图双方后，需导入任务核对顶部与双方赢图横幅的实图，并在 Windows OBS 检查实际浏览器源。此限制不应作为媒体接口缺失的结论。本轮未发布 Windows 包，也未将 #52 标记为全部验收完成。
