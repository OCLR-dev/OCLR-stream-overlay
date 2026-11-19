# Wails 与原生启动器：优化后复测

日期：2026-11-19。Windows 11 专业工作站版 10.0.26300，AMD Ryzen 9 7950X，Go 1.26.5。原 Win32 取自 `d6f9df4`，当前 Windigo 取自主线 `0014963`。三组均使用本次相同 Node 22.23.4、服务代码与网页资源。

## 结论

启动时状态轮询改成 100 ms 后，Wails 完整界面就绪中位数为 **408 ms**，比原 Win32 多 **159 ms**，比当前 Windigo 多 **192 ms**。此前 Wails 初测为 1,353 ms；历史测试的服务版本和浏览器负载不同，这个前后变化不能当成严格受控的加速比例。

7 次快速正常退出重开中，Wails 有 **1 次耗时 6,411 ms**，其余 6 次为 401–521 ms。全部样本计入统计，没有删去离群值。额外等待发生在首次界面标记之前，根因尚未确认；目前不能以中位数宣称启动稳定性已和原生版一致。

## 启动测量

完整 GUI 交替各 7 次，先为每组运行一次空白配置目录。每次测到界面就绪后，以测试钩子确认正常退出并等待 Node 保存，进程关闭及端口释放后间隔 250 ms。交替顺序包含连续两次 Wails，覆盖快速重开。三组都禁用自动开浏览器，不计浏览器页面加载。

| 阶段（中位数） | 原 Win32 | 当前 Windigo | Wails 优化后 |
| --- | ---: | ---: | ---: |
| 本机 HTTP 服务 ready | 220 ms | 189 ms | 342 ms |
| 首次界面标记 | 84 ms | 79 ms | 314 ms |
| 界面显示服务可用 | 249 ms | 216 ms | 408 ms |
| 界面可用范围 | 248–251 ms | 211–242 ms | 401–6,411 ms |

首次空白配置目录的单次界面就绪分别是 896 / 792 / 765 ms（Win32 / Windigo / Wails）。这不是清空磁盘缓存或重启 Windows 后的冷启动，不足以推断首次安装时谁更快。

HTTP 由外部程序轮询 `/api/health`；Win32 在 `UpdateWindow` 后记录，Windigo 在首次背景绘制后记录，Wails 在 Vue 更新并经过两次 animation frame 后回传。以上是合成时间标记，不是 Windows 合成器的精确像素呈现时间。正常退出的自动确认仅存在于临时测量源码，生产确认对话框另经 GUI 检查。

原始数据：[正常退出重测](performance.json)。在修正退出方式前，还做过强制结束测试，Wails 7 次中 4 次超过 4 秒，保留在 [强制结束记录](performance-forced-exit.json)；不能将这些数值混入正常退出统计。正常退出也出现一次长尾，因此尚未证明只由强制结束引起。

## 体积

| 项目 | 原 Win32 | 当前 Windigo | Wails |
| --- | ---: | ---: | ---: |
| OCLR.exe | 7,020,032 B / 6.69 MiB | 7,156,224 B / 6.82 MiB | 11,610,112 B / 11.07 MiB |
| 同内容 ZIP | 37,086,711 B / 35.37 MiB | 37,134,772 B / 35.41 MiB | 38,792,973 B / 37.00 MiB |

相对原 Win32，exe 增加 4.38 MiB，ZIP 增加 1.63 MiB（4.6%）。Wails 解压文件总计 96.37 MiB。WebView2 Runtime 及其使用后产生的缓存不包含在这些数值内。

对照 ZIP 只替换原生 exe，其余随包内容相同；保留 Wails 的说明、许可和 manifest，仅供控制变量测体积，不能发布。本次 Wails 正式包 SHA-256：`45d823e3f435fc36db15c614dcda9f8e5831fda457038857eac3c1d3ea3b7711`。build identity：`7a8d7bc5bdfbd5b17ed45c1646e9257d5065096eeac04e19f0098b48d1c3ad5e`。

## 复现与后续

在 Windows 完成便携包构建后，从仓库根目录运行（Go 在 PATH 中）：

```sh
node tools/packaging/prepare_launcher_benchmark.mjs
node tools/packaging/benchmark_launcher.mjs
```

脚本从固定 Git 提交读取两种原生源码，将所有测量钩子和程序放在 `.local/launcher-benchmark`，使用独立互斥与数据目录；结果写入该目录的 `results.json`。它会短暂打开测试窗口，退出只处理自己创建的进程，不关闭外部直播服务。若性能测量时其他构建或测试正在运行，应等它们结束后再测。

功能对齐见 [验收记录](README.md)。正式替换前需要定位快速重开长尾，补齐缺少 WebView2 的安装／离线体验与真实直播机联调。原初测保留在 [2026-11-15 记录](performance-20261115.md)及[原始样本](performance-20261115.json)。
