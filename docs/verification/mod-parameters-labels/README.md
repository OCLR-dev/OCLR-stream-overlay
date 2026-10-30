# 模组参数与图池标签

日期：2026-10-30（America/New_York）。

## 最终行为

- 正式 Playing 参数继续默认读取本局匹配且新鲜的 tosu 数据，不自动回退到文件或本地计算结果。
- 模拟测试从官方 `.osu` 文件计算完整谱面的星级及 NM／HD／HR／DT 后的 CS、HP、AR、OD、BPM，标注「测试 · HR 参数」等；不再将 NM 原始值作为 HR 数值显示。FM／TB 没有统一的已指定模组组合时，明确显示「测试 · NM 基准」。末物件时长继续只读 tosu。
- 计算器锁定 `rosu-pp-js@4.0.1`，使用 stable 模式；星级由难度算法计算，AR／OD 包含倍速的影响，DT 的 BPM 按实际 clockRate 调整。它是测试用计算口径，正式读数仍以现场 tosu 为准。
- 计算放在单独的 Worker 线程，串行并设 5 秒超时，不阻塞比分和 SSE。拒绝可疑或无物件谱面；按谱面文件内容和 mod 分别缓存，并发相同任务去重。仅保留最多 8 份原始文件，失败短暂缓存，换图或修改 mod 时立即清除旧参数。
- 测试参数接口为 `/api/beatmaps/{id}/metadata/{NM|HD|HR|DT}`，只允许当前图池中存在的谱面／mod 组合；重复谱面 ID 的不同槽位不会共用错误的 mod 缓存。封面和参数复用同一官方文件查询。
- Mappool 左侧原 01／02 直接换成完整且带 MOD 色的 NM1／HD2／HR3 等标签，右侧移除重复标签，仅保留标题、补充信息和 Ban／Pick。整卡背景、队色边框和 Ban 压暗保持。

实现依据：[rosu-pp-js 官方文档](https://github.com/MaxOhn/rosu-pp-js)。完整谱面解析后调用 Difficulty 与 BeatmapAttributesBuilder，不用固定星级或按比例猜星级。

## 实测与回归

- 当前 HR1（2477308），同一官方文件计算：NM ★6.41448、CS 4、HP 5、AR 9、OD 9；HR ★6.84569、CS 5.2、HP 7、AR 10、OD 10、BPM 190。界面显示 ★6.85，并标注「测试 · HR 参数」。
- 切换到真实 DT1 后显示 ★6.82、CS 4、HP 6、AR 9.67、OD 9.78、BPM 249，HR 数值没有残留。
- 20 个图池条目左侧都显示完整槽位标签，宽度检查无截断；右侧重复标签节点为 0，20 张整卡背景实际加载成功。
- 3v3／4v4、4:3／16:9、普通／EX 共 8 种布局中，Playing 与 Map Result 的游戏画面位置和尺寸差均为 0。
- `npm run build`（含 Vue 类型检查）、`git diff --check` 通过。
- `npm test`：147 项通过，0 失败。新增覆盖实际 WASM 的 HR／DT 星级及属性、文件与 mod 缓存隔离、无效输入后的恢复、池内 mod 访问限制，以及 UI 不使用缺失或错误 mod 的计算。原正式 tosu 优先、真实 0、部分字段缺失、错图清除等用例保留。
- 便携生命周期测试从中文／空格路径下的独立安装副本加载 Worker 和 WASM 并完成 HR 计算，随后验证原启动、重启与数据保留流程。打包脚本包含 WASM、JS 包及 MIT 许可证，Windows 实机验证脚本也加入离线计算检查。

浏览器截图与量测：[HR 参数](hr-parameters.jpg)、[DT 参数](dt-parameters.jpg)、[图池槽位标签](mappool.jpg)、[浏览器检查](browser-checks.json)。这些检查使用临时内存会话和明确的测试队名，未在原比赛中换图、改分或切换模式。

原 3007 服务已加载新版本。[恢复检查](restoration.json)确认保存文件、比赛会话及模拟房间均保留（仅服务重启提示不同）。随后只读检查原服务，HR1 已显示上述 HR 参数。

## 边界

已验证本机实际谱面文件和 WASM 计算，未完成真实 Windows tosu／osu!tourney／OBS 联调。Windows ZIP 的打包规则已更新，本次未重新生成 ZIP 或发布 Release。
