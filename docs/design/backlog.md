# 项目待办与设计索引

## 下一项实施

**控制台 OBS 节目画面与录像打点 · 待实施。** 现有控制台能读 OBS 节目场景名、手动返场，并预览比赛 Overlay。下一步是在现有预览区显示 Program 缩略图，并按 OBS 录像时间记录开打、重赛、全场结果和手动精彩时刻。[实施方案与验收场景](obs-program-recording-plan.md)

## 已有功能与现场反馈

| 主题 | 当前主线可用的功能 | 记录 |
| --- | --- | --- |
| 决胜图 | 正赛到达决胜比分后，单独准备本场唯一 TB；表演赛按其规则和裁判决定操作 | [TB 验收](../verification/tiebreaker/README.md) |
| BP 与操作提示 | 已确认的 Ban/Pick 跟随比赛，当前步骤显示下一项可做的操作；准备图与房间谱面不同时可人工纠正 | [当前操作约定](../main-operator-contract.md) |
| 比赛聊天 | 按最新匹配到的直播槽位为选手昵称着色，BanchoBot 单独着色 | [聊天规则与验证](../verification/issue-28/README.md) |
| 表演赛现场反馈 | BP 队列、星级、聊天留白等原始反馈与对应修复分开记录 | [现场调查](../verification/showmatch-issues-2026-11-08/README.md) · [已做的修复](../verification/showmatch-issues-2026-11-08/FIXES.md) |
| Showcase | 手动录入、复制或从网站导入图池；通过 OBS 在换 rep 时遮挡游戏并展示图池进度 | [授权导入](../streaming-api.md#从网站导入-showcase-图池) · [过场验收](../verification/showcase-cover/integration/README.md) |

图池排版先用已有的完整 MP5 小图池，需要更大规模时选明确赛季的完整历史图池。BP 在直播中实时进行，只展示已确认的谱面。局部文案或样式改动检查受影响画面；改动比赛流程或捕获区时，验证对应的状态转换或布局组合。

## 查阅早期方案

- 视觉与版式的历次调整见[直播画面设计沿革](../history/broadcast-design.md)。
- 控制台形成过程见[控制台初版方案](operator-console-plan.md)、[BP 跟随设计](bp-automation-plan.md)和[早期 tosu 调查](tosu-auto-scene-research.md)。
- [状态机设计草案](automation-state-machine-refactor.md)记录重构前的结构，[实现与验证](../verification/automation-state-machine-refactor/README.md)记录落地的规则和数据迁移。
- [MP5 源码对照](mp5-reference-review.md)记录其他赛事的操作方式。正赛与表演赛按本项目的[比赛规则实现](../../server/session/rules.js)运行。
