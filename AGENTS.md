# OCLR 直播项目

这是独立于 OCLR-website、mainsheet 和 owc-background 的新项目。修改前阅读 README.md 与 DESIGN.md。

- 当前包含数据基础层与 `design/layout-v1/` 独立 UI 线框，尚未接线。不要主动套用其他项目皮肤或接入真实数据；修改 UI 前阅读该目录的 `layout-plan.md`。
- 使用 OCLR 线上只读 API 与 tosu，禁止生成静态 bracket 数据、写线上业务数据、猜正式结果或复制其他赛季补空。
- `.env.local` 为本机配置；当前通过路径引用同级网站的已有凭证文件。Key 不进入浏览器、源码、URL、日志和测试样本。不要读取后打印凭证。
- 现有其他项目和 Downloads 内参考项目均不在本次修改范围内。
- 通过 src/index.js 提供 UI 订阅入口；来源、缺失/零值、实时/过期/错误状态必须明确。
- 测试：`npm test`；启动：`npm start`。无第三方依赖，不需要安装包。
- 后续增加 UI 静态目录时保持显式服务范围，禁止公开项目根目录与凭证文件。
- 真实 tosu/OBS 联调和画面验收必须单独报告，不以合成测试代替。
