# WinUI 3 Windows 便携版原型

原型用 WinUI 3 的 NavigationView 保留「概览」「设置」「日志」「关于」。`OCLR.exe` 启动同目录的 `OCLR-core.exe`，通过子进程标准输入和输出传递操作与状态。Go 继续管理单实例、Node 服务启动、健康检查、端口重启、tosu、osu!Tourney 与本机日志。

启动器沿用 `%LOCALAPPDATA%\OCLR\StreamOverlayLauncher` 下的 `service-port.txt` 和 `settings.json`。比赛仍保存在 `%LOCALAPPDATA%\OCLR\StreamOverlay`。端口保存成功后才停止自己的旧 Node 子进程。原型与原启动器共用单实例保护。

## 构建和试用

构建机使用 .NET SDK 10、Go、Python、Node 和 npm。首次构建执行 `npm ci`。

```powershell
python tools/packaging/build_windows.py
python tools/packaging/build_windows.py --winui-prototype
```

将 `OCLR-WinUI-Prototype-Windows-x64.zip` 完整解压，再双击 `OCLR.exe`。ZIP 随附自包含的 .NET、Windows App SDK、Go 和 Node。原型走独立的 GitHub Actions 工作流，输出 ZIP、SHA-256 校验文件及测试报告。

## 同机比较

两种包使用同一份前后端及 Node 22.23.4。启动时间从创建 `OCLR.exe` 进程计到本机健康检查返回就绪。“有窗口”另确认出现可见主窗口，两者各测一次。“无窗口”交错测量五次，取中位数。本机比较使用独立单实例名称，避免干扰正在运行的直播服务。

| 项目 | Win32 | WinUI 3 |
| --- | ---: | ---: |
| ZIP 大小 | 36.4 MiB | 123.2 MiB |
| 无窗口启动至服务就绪 | 160 ms | 204 ms |
| 有窗口启动至服务就绪 | 190 ms | 555 ms |

本机已确认两个启动器都能显示窗口与加载控制台，WinUI 3 从旧格式读取程序路径和端口，通过 Go 重启后旧端口关闭、比赛文件字节保持一致。原型工作流为解压后的启动器、Go 及 Node 进程阻挡非回环出站连接，以同包 Node 验证阻挡，再执行同一组检查。独立的干净 Windows 10／11 实机部署仍待测。
