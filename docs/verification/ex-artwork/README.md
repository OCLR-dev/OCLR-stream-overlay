# EX 常用操作与谱面封面

日期：2026-10-29～30（America/New_York）。

## 行为

- EX 开启／关闭移到顶部常用区，双方按钮、当前开启方和次数加减常驻。点击立即同步；开关不扣次数、不切画面，普通准备期且有次数时可开启，TB 禁用；开打后可关闭。更多调整保留次数输入修正。
- 播出页场景旁 EX 标记、Playing 的 EX 标签和图池开启方文字跟随红／蓝开启方；关闭恢复普通状态，TB 使用粉色。场景旁 EX 保留开启队伍的提示和可访问名称。
- Playing 封面、MOD 标签和 NOW PLAYING 读取本局条目完整 label（HR1、HR2 等），配色与图池共用变量；没有本局时显示「—」，不推造编号。卡片保持 x=460、y=928、1000×138。
- 图池缩略图与 Playing 使用同一图片组件。当前图在真实 tosu、有效房间、同一谱面的条件下读取配置的 tosu 背景接口；下载过程中换图或换房间则舍弃该响应。模拟器不提供真实本地背景。
- 官方封面只使用已知或核对后的 BeatmapSetID。已发布图池的 metadata.setId 保留；历史资料只有 BeatmapID 时，从 `https://osu.ppy.sh/osu/{id}` 获取公开谱面元数据，核对返回 BeatmapID 后读取 BeatmapSetID。封面地址固定为 `https://assets.ppy.sh/beatmaps/{setId}/covers/cover.jpg`，不使用第三方镜像，也不要求新增 osu! OAuth 凭证。
- 元数据请求去重、串行且间隔至少 1 秒，成功缓存 24 小时，失败缓存 1 分钟；缓存有条目上限。tosu 背景只接收有大小上限的常见栅格图，缓存最多 8 张。请求仅限当前图池的谱面；不接受客户端提供文件路径、任意远端地址或 query，不转发 OCLR 凭证。
- 图片尚未加载、删除、断网或失败时使用现有渐变占位，不显示破图，不修改赛果。Ban 的图片继续变暗，Pick 不灰化。卡片使用懒加载，Playing 与图池切换同谱面时可复用已缓存封面。

参考：[tosu 官方文件接口](https://github.com/tosuapp/tosu#api)、[osu! 官方封面字段](https://osu.ppy.sh/docs/index.html#beatmapset)。

## 验证

- `npm run build`（含 Vue 类型检查）、`git diff --check` 通过。
- `npm test`：134 项通过，0 失败。新增 7 项验证：图集 ID 与难度 ID 分离、并发去重和缓存过期、错误／超大元数据、图池与路径限制、同图 tosu 背景、错误／过期／模拟来源、下载期间换图后的缓存保护，以及历史查询不改变原比赛。
- 所有实际按钮操作在临时的独立内存会话进行，使用明确的「验证左队／验证右队」，只复用已知真实图池，不写原比赛、不请求赛事远端、不读取凭证。
- 浏览器实际开启左队、换右队、减少次数至 0、关闭，再尝试开启耗尽队伍；耗尽方不可开启。开启和换方不自动减次数，独立输出 3v3→EX 2v2→3v3 同步正常。准备 TB 后双方开启按钮禁用并说明原因；切回普通图后正常。
- Playing 实测 HR1、HR2 完整标签、橙色右侧槽位与真实官方封面加载成功，封面 naturalWidth=900。
- 图池 20 张官方封面实际全部加载成功；Ban 图片为 brightness(.35) saturate(.4)，Pick 无灰化滤镜。
- EX 标记实测红队边框 rgb(255,77,109)、蓝队边框 rgb(61,139,255)，可访问名称包含实际开启方；关闭后变为普通且移除队伍属性：[颜色量测](ex-badge-colors.json)。
- 1440px 桌面与 390px 窄屏检查，窄屏正文宽度为 390px，按钮均在视口内且可直接操作。
- 八组常规人数／EX／游戏源比例组合中，Playing 与单图结算逐窗口矩形差异均为 0：[geometry.json](geometry.json)。

截图：[顶部 EX 常用按钮](ex-controls.jpg)、[390px 常用区](ex-controls-mobile.jpg)、[HR2 封面与完整标签](playing-hr2.jpg)、[图池封面](mappool.jpg)、[红队 EX 标记](ex-red.jpg)、[蓝队 EX 标记](ex-blue.jpg)。

## 边界

官方封面已在本机浏览器实际加载；tosu 本地背景的匹配、回退及换图竞态使用模拟 HTTP 响应验证。本机运行的是模拟 tosu，未声称完成真实 Windows tosu／osu!tourney 背景读取或 OBS 实机验收。现有比赛与模拟房间在同端口重启后核对保留，比赛文件和会话快照均与重启前相同；房间仅新增服务重连说明：[恢复核对](restoration.json)。

本次未重新生成 Windows ZIP、发布 Release、修改 OBS 场景或推流／录制。
