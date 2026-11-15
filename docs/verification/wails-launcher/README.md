# Wails Windows 启动器

日期：2026-11-15。范围：替换 Windows 启动界面；Node 比赛服务、浏览器控制台与 OBS 输出保持原实现。

## 实现

- Wails 2.17.1（MIT）+ Vue 3，复用根目录 npm lockfile 与现有 Lucide 图示，独立 Vite 入口。采用 Wails v2 的现有 Windows 生命周期与文件对话框 API；锁定依赖，不引入 v3 迁移。Go 最低版本由依赖要求更新为 1.26，现有 CI 1.27.3 满足要求。
- 概览、设置、日志、关于；固定网页资源嵌入 exe，界面不依赖 Node 就绪。浏览器控制台保持独立，不把比赛会话搬入 WebView。
- 保留 `Local\OCLR.StreamOverlay.Portable` 互斥、原配置目录、后端 build/PID 核对、健康恢复、stdin 关闭退出协议、等待保存以及端口重启确认。
- Native picker 选择程序；Go 重新验证端口和工具类型，公开方法不接受任意 shell、程序路径或 URL。操作串行，停止期间不能发起新操作，退休后端的回调按 PID／地址隔离。
- WebView2 用户数据位于启动器设置目录，独立于比赛数据。生产关闭开发工具、禁止拖入网页，CSP 限定资源来源；inline script 用于 Wails 注入的桥接代码。
- 保留 `--headless` / `--smoke-test`；它们不加载 WebView2，不能替代实际 GUI 验证。

## 构建与测试

```sh
npm ci
npm run build:launcher
cd tools/windows-launcher
go test ./...
cd ../..
python tools/packaging/build_windows.py
```

打包脚本使用 `desktop,production` 标签，嵌入前端并纳入 build identity；收集 Wails 及锁定 Go 模块、Vue 和 Lucide 的许可证。WebView2 缺失时沿用 Wails 官方下载／安装提示，便携包不含浏览器运行时。

本地已完成：前端类型检查、两套 Vue 构建、Windows Go 测试、545 项 Node 测试、便携 ZIP 打包与 13 项隔离启动／恢复验收。测试均为 synthetic；没有实际 tosu、osu!Tourney、OBS 或正式直播联调。

为避免干扰当时正在运行的旧启动器，第一轮便携测试使用链接时替换互斥名称、关闭自动打开浏览器的专用 exe；Node 和界面资源来自相同包。链接变量不是运行时配置，也不向网页暴露。正式包仍使用原互斥与自动浏览器行为。

旧服务退出后，启动轮询优化前的未修改 `OCLR.exe` 与随包 Node 22.23.4 完成全部 13 项隔离验收。轮询优化后，未修改 exe 的重复验收因用户重新打开旧启动器、占用全局单实例锁而超时；没有退出旧服务。去除临时路径后的结果、确切 build identity 与后续隔离锁验收见 [测试结果](results.json)。

实际 WebView2 窗口已确认可以加载并展示真实本机服务状态，示例见 [概览截图](overview.png)。截图使用临时合成比赛与程序路径。

GUI 已检查四页导航、日志读取、无效端口提示、原生重启确认、旧子进程正常退出与新进程重新就绪，以及退出确认后保存并以 exit code 0 结束。设置与日志在独立滚动区域显示，底部服务状态保持可见。

启动体积及耗时初测见 [Win32／Wails 比较](performance.md)。测量发现启动阶段 1 秒状态刷新造成额外等待，已缩短为 100 ms；正常运行仍为 1 秒。用户停止桌面操作后没有继续 GUI 重测，优化后的界面就绪耗时仍待验证。

尚待：缺少 WebView2 的全新 Windows 安装／离线提示验收，以及真实直播员的 tosu／OBS 联调。未改变现有比赛自动化的验收结论。
