# 浅紫视觉验收记录

核对日期：2026-10-27（America/New_York）。前端美术由 DeepSeek Harness（DeepSeek V4.1-Flash 1017）实现，Codex 完成本机集成与浏览器检查。

## 已执行

- Chrome 中检查六个场景的 1920×1080 画布；完整截图见下表。
- Mappool、Playing、单图结算使用相同 SVG、背景位置及尺寸；缓慢环境光位于内容层下方。
- 浅色主题、紫色赛事主色、左红右蓝侧标、星位、玩家框和领先比分均已查看。
- 常规 3v3/4v4 × 4:3/16:9 × 普通/EX 共八种组合，Playing 与单图结算逐窗矩形一致，且与本轮美术修改前记录的坐标一致。
- 控件实测：3v3 开 EX 后双方各 2 路，角色为 T2/T3；TB 恢复双方各 3 路并禁用 EX；重复 HD Ban 被阻止；空 Ban 可选；干净输出、Esc 退出、数字键切场景有效。
- 检查正常动态偏好下的 52s 环境光动画及其层级。减少动态效果的 CSS 关闭规则已复核；未切换系统偏好进行实机验证。
- `npm test`：13 passed，0 failed；`node --check design/layout-v1/app.js` 与 `git diff --check` 通过；SVG XML 可解析。

| 场景 | 完整截图 |
| --- | --- |
| 等待选手 | [light-waiting.jpg](preview/light-waiting.jpg) |
| Mappool | [light-mappool.jpg](preview/light-mappool.jpg) |
| Playing | [light-playing.jpg](preview/light-playing.jpg) |
| 单图结算 | [light-map-result.jpg](preview/light-map-result.jpg) |
| 全场胜利 | [light-victory.jpg](preview/light-victory.jpg) |
| 暂停 | [light-pause.jpg](preview/light-pause.jpg) |

截图为 JPEG，均为 1920×1080。右侧偶见的粉色浏览器翻译浮标和鼠标指针属于本机预览环境，不是 overlay 源码内容。

## 验收边界与后续

当前仍为本地示例数据和源画面占位；未进行真实 tosu、osu! tourney 或 OBS 联调，未验证 OBS 中的字体回退、动画帧率及 GPU 占用。此记录编写时尚未提交或推送。

按用户确认的顺序，先评审并收束 UI，再整体迁移至 Vue 3 + Vite + TypeScript，随后接入真实数据、控制页与 OBS 输出同步。
