# Wails Windows 启动器

更新：2026-11-19。Wails 分支已整合主线 `0014963`，以 Wails 2.17.1 + Vue 3 替换原生启动界面。Node 服务、比赛数据与浏览器控制台沿用当前主线，OBS 继续使用原地址。

## 功能对齐

以主线 Windigo 启动器及原 Win32 版为依据逐项核对。以下功能已实现；真实游戏与 OBS 联调仍单列验收。

| 原生启动器能力 | Wails 对应实现与证据 |
| --- | --- |
| 概览、设置、日志、关于 | 四页导航，已检查实际 WebView2 窗口 |
| 启动 Node、自动打开系统浏览器控制台 | 保留后端启动流程及固定 `/control` 地址；控制台继续独立运行 |
| 单实例、版本和 PID 检查 | 保留原互斥名称、同版本服务复用与旧版本拒绝；便携测试通过 |
| 服务端口保存、冲突报错、确认后重启 | 使用原端口文件；先保存后停服，保留比赛记录；Go 测试及此前 GUI 重启验证 |
| 复制 OBS／全部地址 | 固定控制台、Overlay、Showcase 三种地址，随端口更新 |
| tosu／osu!stable 路径记忆 | 原设置文件兼容；原生选择器从上次目录打开；取消不改设置 |
| tosu 进程与端口检测 | 保留路径匹配、`tosu.env` 校验、端口同步；区分文件缺失、缺少端口和无效端口 |
| 启动 tosu 与异常退出提示 | 重检运行状态，显示异常退出；未检测到 osu! 时建议先开 Tourney，默认取消；确认后再次检查避免重复启动 |
| 生成 tournament.cfg／打开 Tourney | 保留授权赛季、配置备份、运行中不覆盖及启动逻辑；原 Go 测试保留 |
| 健康失败、恢复、子进程退出 | 保留健康监测和日志；旧 PID／地址回调不能覆盖新状态 |
| 日志预览与完整文件 | 有界预览；系统文件关联失败时使用 Notepad 备用 |
| 项目主页、构建标识、MIT 版权 | 已补齐主线新内容，见 [关于截图](about-20261119.png) |
| 退出确认、保存、只停止自身服务 | 实际 GUI 确认退出后 exit 0；Node 保存并退出，外部 osu!／tosu 不被停止 |
| headless、smoke-test、便携包许可 | 保留原验证模式；MIT、第三方声明及所有锁定 Go 模块许可随包分发 |

Go 暴露固定操作，不接受网页传入任意程序路径、shell 或 URL。文件路径来自原生选择器，并在 Go 再次校验。操作串行；关闭期间拒绝新操作。前端资源内嵌在 exe，CSP 限定本机资源，禁止拖入网页，生产关闭开发工具。

WebView2 配置位于启动器设置目录，比赛仍使用原 `%LOCALAPPDATA%\OCLR\StreamOverlay`。WebView2 Runtime 由系统提供，不包含在 ZIP 中。

## 构建与本次验证

```sh
npm ci
npm run build:launcher
cd tools/windows-launcher
go test ./...
cd ../..
python tools/packaging/build_windows.py
```

构建使用 Go 1.26+、`desktop,production` 标签，前端资源和 Go 依赖纳入 build identity。沿用根 npm lockfile、Vue 和 Lucide，不新增另一套前端依赖。

2026-11-19 本机完成：两套 Vue 类型检查与构建、Go 测试、580 项 Node 测试；使用未修改的生产 exe 与随包 Node 22.23.4 完成 14 项便携验收。覆盖中文／空格路径、单实例、会话及撤销恢复、SSE、端口占用、旧后端拒绝、损坏数据保留、tosu 端口、健康恢复及退出。去除临时路径的结果见 [本次记录](results-20261119.json)。

实际 GUI 使用隔离设置与测试专用互斥，界面和业务源码与生产包相同；检查四页、原生文件选择器、tosu 提示与取消、MIT 信息、日志加载，以及退出确认后保存并正常结束。没有启动真实 osu!／tosu 或连接 OBS。2026-11-15 的端口重启等历史验收保留在 [旧记录](results.json)和[概览截图](overview.png)。

## 替换验收状态

功能覆盖已对齐，替换验收仍为 **partial**。优化后完整 GUI 就绪中位数为 408 ms，原 Win32 为 249 ms，当前 Windigo 为 216 ms；但 7 次快速正常退出重开中有 1 次 Wails 达 6.4 秒，原因尚未确认。完整方法、全部样本和大小见 [性能比较](performance.md)。

正式替换前仍需：排查快速重开长尾、全新／缺少 WebView2 的 Windows 安装与离线提示，以及真实 tosu／osu!Tourney／OBS 直播机联调。本分支未推进 `release/windows` 或发布版本。
