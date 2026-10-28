# OCLR 直播项目

这是独立于 OCLR-website、mainsheet 和 owc-background 的新项目。修改前阅读 README.md 与 DESIGN.md。

- 当前前端为 `ui/` 内的 Vue 3 + Vite + TypeScript，数据基础层 `src/` 尚未接入画面。`design/layout-v1/` 保留迁移前的视觉参考；后续 UI 修改以 `ui/` 为准，先读参考目录的 `layout-plan.md` 和 `docs/verification/vue-migration/README.md`。
- 使用 OCLR 线上只读 API 与 tosu，禁止生成静态 bracket 数据、写线上业务数据、猜正式结果或复制其他赛季补空。
- `.env.local` 为本机配置；当前通过路径引用同级网站的已有凭证文件。Key 不进入浏览器、源码、URL、日志和测试样本。不要读取后打印凭证。
- 现有其他项目和 Downloads 内参考项目均不在本次修改范围内。
- 通过 src/index.js 提供 UI 订阅入口；来源、缺失/零值、实时/过期/错误状态必须明确。
- 首次安装 `npm ci`；开发 `npm run dev`；类型检查 `npm run check`；构建 `npm run build`；测试 `npm test`；构建后启动 `npm start`。保留 `package-lock.json`，不要自行升级工具链大版本。
- 正式本机服务只提供 `dist/index.html` 和显式允许的 `dist/assets/` 文件；开发服务根目录限制为 `ui/`，禁读环境文件。禁止公开项目根目录与凭证文件。
- 六场景保持挂载，游戏窗口按选手槽位标识使用稳定 key；比分/场景变化不能用 innerHTML 重建窗口。按八组人数/源比例组合检查 Playing 与单图结算同位同尺寸。
- Playing / 单图结算不显示窗底选手信息栏（A1/B1、姓名、Captain/T1 等）；等待页仍保留选手卡。左红右蓝须有明显的顶部铺色和窗口边框，按用户提供 HTML 的深紫参考实现，中央与共用背景使用深紫。
- 真实 tosu/OBS 联调和画面验收必须单独报告，不以合成测试代替。
- 后续目标是直播员可实际使用的控制台与播出流程，功能设计见 `docs/design/operator-console-plan.md`。控制台通过共享状态驱动 OBS 中同一个浏览器源换画面，不引入 OBS 场景切换或 OBS 确认流程。主流程为双方到场 → Roll 确认先手 → BP → Playing 循环 → Winner；单图结算和暂停为辅助显示。跨页面同步、真实数据和媒体接入必须分别验收，不能用本页演示状态变化代替。
