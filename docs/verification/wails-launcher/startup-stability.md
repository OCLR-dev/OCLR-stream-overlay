# Windows 启动稳定性复测

2026-11-19，在同一台 Windows 11 x64（AMD Ryzen 9 7950X）上复现、修复并复测快速重开延迟。原 Win32 对照为 `d6f9df4`，主线 Windigo 对照为 `0014963`。各组使用 Go 1.26.5 构建，随包 Node 22.23.4、服务代码和网页资源一致。

## 定位与修复

单次 6.4 秒的异常可重复出现。加上启动阶段时间戳后，共用目录的 24 次正常退出重开里有 4 次在 **6,359–6,494 ms** 就绪。四次的 WebView2 环境回调均出现在启动后 36–44 ms，Windows 前端初始化完成却在 6,125–6,241 ms。此时 Node 还未启动。换成同一执行文件、每次使用新缓存目录，24 次重开全部在 **425–491 ms** 就绪。

这组对照把触发条件收敛到快速重开时复用同一 WebView2 目录。WebView2 可以为相同目录复用浏览器进程，进程退出后才释放目录资源。实测没有进一步区分运行时内部的等待或重试。 [Microsoft WebView2 进程事件](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-related-events)

每次启动现在创建独立的 `WebView2Sessions/session-*/data`，避免与上次进程共用。启动后在后台清理超过一小时且未被使用的专用缓存。启动器设置、比赛数据及旧版缓存目录继续保留。Go 回归验证了新目录隔离、活跃目录保护、刚退出目录保留及过期缓存清理。

## 多轮测量

| 场景 | Wails 重开次数 | 中位数 | P95 | 最慢 |
| --- | ---: | ---: | ---: | ---: |
| 与 Win32／Windigo 交替，等待 250 ms | 20 | 432 ms | 443 ms | 447 ms |
| 正常退出，服务退出后立即重开 | 30 | 466.5 ms | 499 ms | 500 ms |
| 正常退出，等待 250 ms 再重开 | 30 | 438 ms | 487 ms | 490 ms |
| 强制结束测试窗口，等待服务退出后立即重开 | 20 | 473 ms | 481 ms | 509 ms |
| 全部重开 | 100 | 449.5 ms | 487 ms | 509 ms |

100 次均未再出现超过一秒的启动。每轮另计一次空白设置目录首启，Wails 四次为 421–774 ms。首启没有清空系统磁盘缓存，也没有重启 Windows。

| 同机交替测试（中位数） | 原 Win32 | Windigo | Wails |
| --- | ---: | ---: | ---: |
| 界面就绪 | 252.5 ms | 214 ms | 432 ms |

Wails 同轮仍比原 Win32 慢约 180 ms，测试中的 6 秒级延迟已消失。界面就绪按 Vue 更新且完成两次 animation frame 后的标记衡量。原生版在更新就绪状态后记录。正常退出走原保存和退出流程，测试版仅自动确认对话框，三版都关闭自动打开浏览器。全部样本、各阶段统计和包信息见 [原始数据](startup-stability.json)。

## 复现

构建便携包后，从仓库根目录运行：

```sh
node tools/packaging/prepare_launcher_benchmark.mjs
node tools/packaging/benchmark_launcher.mjs --samples 20
node tools/packaging/benchmark_launcher.mjs --samples 30 --gap 0 --wails-only
node tools/packaging/benchmark_launcher.mjs --samples 30 --gap 250 --wails-only
node tools/packaging/benchmark_launcher.mjs --samples 20 --gap 0 --wails-only --force-exit
```

脚本使用自身的单实例锁、设置和端口，结果写入 `.local/launcher-benchmark`。另外，正式生产 exe 与随包 Node 通过全部 14 项便携验收，Go 回归和构建通过。实机范围覆盖已安装 WebView2 的这台 Windows。缺少 WebView2 的安装／离线流程和真实 osu!／tosu／OBS 联调仍待验收。
