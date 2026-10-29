# Vue 迁移验收

日期：2026-10-27（America/New_York）。本轮由 Codex 直接实现，未使用 DeepSeek。

## 交付范围

- 前端迁移至 Vue 3 + Vite + TypeScript；原版 `design/layout-v1/` 保留作对照。
- 六场景拆成 Vue 组件，Playing/单图结算共用游戏窗口及谱面组件。状态、URL 编解码和 S11 本地演示校验迁入 TypeScript。
- 保留浅紫主题、左红右蓝、共享背景、52s 低强度环境光动画与 reduced-motion CSS。
- Node 服务提供构建 UI，入口与资源均有明确路径范围；API 来源校验、凭证隔离与只读边界保留。
- 锁定依赖版本及 lockfile。TypeScript 固定为 6.0.3；当前 vue-tsc 与 TypeScript 7 的包导出不兼容，不直接升级。

## 已执行的验证

- `npm run build`：Vue 类型检查和 Vite 生产构建通过。
- `npm test`：18 passed，0 failed。包含原 13 项数据/代理测试，以及 URL/零值/未知状态、EX/TB/有效人数/结算总分、Ban 和阶段星位、生产静态资源隔离、缺失构建提示。
- `git diff --check` 通过。
- 生产构建由仅本机匿名测试服务提供（3004 端口），不加载本机凭证；页面无真实 OCLR/tosu 请求。
- `npm run dev` 启动成功，开发页正常渲染 18 个占位图池条目，浏览器无 error/warn；开发服务对项目根环境文件和服务端源码的 `/@fs/` 请求均返回 403。该开发服务已关闭，保留 3004 生产预览。
- 浏览器检查八种常规人数/源比例/EX 组合。原版与 Vue 参考页缩放不同，统一换算到 1920×1080 逻辑画布后最大坐标差小于 0.001px；Playing/单图结算逐窗矩形完全一致。
- 检查六场景均为完整 1920×1080；Mappool、Playing、单图结算共用同一构建背景资产和动画层。
- 控件实测：重复 HD Ban 被拒绝并回显、空 Ban、FM 说明、B 队 EX 激活、双方减员、TB 恢复人数并禁 EX、决赛 7 星、右侧 RTL 星位、切回小组清除越界星数并保留真实 0。
- 快捷键切场景、干净输出与 Esc 恢复正常；双方到场后就绪保持未确认；技术暂停隐藏暂定时长且不消耗战术暂停。
- 浏览器运行时日志无 error/warn。

| 场景 | 新版截图 |
| --- | --- |
| 等待 | [waiting.jpg](waiting.jpg) |
| Mappool | [mappool.jpg](mappool.jpg) |
| Playing | [playing.jpg](playing.jpg) |
| 单图结算 | [map-result.jpg](map-result.jpg) |
| 全场胜利 | [victory.jpg](victory.jpg) |
| 暂停 | [pause.jpg](pause.jpg) |

原始矩形对照与图层记录：[browser-checks.json](browser-checks.json)。截图右侧粉色翻译浮标属于本机浏览器扩展，不是 UI 源码。

## 验收边界

当前仍为示例状态和源画面占位，未接真实赛事数据、真实阵容、控制端同步或实际游戏源。未进行真实 tosu、osu! tourney、OBS、Windows 字体回退及 OBS 动画性能验收。减少动态偏好的 CSS 关闭路径已保留并检查，未切换系统偏好实测。

记录编写时尚未提交、推送或部署；本机生产入口为构建后 `npm start` 的 3001 端口，开发入口为 `npm run dev` 的 3003 端口。本轮 3004 为匿名验证预览。

后续控制台体验改造与设置即时同步见 [志愿直播员控制台验收](../volunteer-console/README.md)；本页保留迁移时的历史验收范围。

2026-10-29 的后续 [动效验收](../motion/README.md) 保留常驻场景与稳定源窗口，补充 200ms 淡化和语义变化强调；八组 Playing / 结算几何差异仍为 0，并实际检查了减少动态效果偏好。该记录独立于本页迁移时的历史范围。
