# Custom-Match Windows 使用说明

下载 **OCLR-Custom-Match-Windows-x64.zip** 并完整解压，双击 **OCLR-Custom-Match.exe**。Windows 10／11 x64 需要 Microsoft Edge WebView2 Runtime。启动器顶部可切换比赛控制台、Showcase、服务、设置、日志和关于。最小化后继续播出。

1. 在「比赛配置 → 本场资料」填写赛事名称、阶段、BO、队名、BP 和图池。当前支持 3v3 与 4v4 常规布局。首次启动会打开待配置的本地会话。
2. 在桌面「设置」选择常用 `osu!.exe`，启动赛事客户端及 tosu。新会话默认跟随启动器检测的本机 tosu。现有会话沿用保存的地址；可在「比赛配置 → 游戏数据」切换连接方式。
3. 在「比赛配置 → OBS」连接 OBS。默认浏览器控制台为 `http://127.0.0.1:3011/control`，比赛源为 `http://127.0.0.1:3011/overlay`，Showcase 源为 `http://127.0.0.1:3011/showcase?clean=1`。比赛源为 1920×1080，Playing 洞口透明。
4. 端口冲突时在桌面「设置」修改服务端口。重新连接 OBS 后会迁移已识别的本机播出源地址，Program 仍由导播核对。
5. 录制时在 OBS 开始录像。控制台可看 Program 预览、跟随开打和 Winner 打点；临时精彩片段用「标记精彩时刻」。

## 更新与存储

- 退出旧启动器再解压新版。默认比赛仍存放在 `%LOCALAPPDATA%\OCLR\CustomMatchTest`，启动器设置在同级 `CustomMatchTestLauncher`。现有比赛数据与启动器选项随同一用户目录恢复。
- 可在桌面「设置 → 资料存储」启用完全便携模式。第一次复制现有资料后重新打开启动器。之后请连同程序旁的 `OCLR-portable` 和 `OCLR-data` 一起移动。启用后，程序目录中的工具路径使用相对地址。
- 随包 tosu 位于 `tosu/`，有有效的自选路径时优先使用。保留该目录即可直接使用默认配置。若有旧的自选 `tosu.exe`，在桌面「设置」核对所用路径和端口。

## 下载与定制打包

推送到 `test/custom-match` 后，GitHub Actions 按该次推送的提交构建通用包，并上传 ZIP、SHA-256 与原生验收报告。也可在 Actions 手动选择 `test/custom-match` 重新打包。GitHub Releases 中的 Main 便携包由 `release/windows` 发布。

维护者可在具备 Node.js、Python 和 Go 的环境打包：

```sh
python tools/packaging/build_windows.py --custom-match
```

需要预装赛事配置时，传入 `--custom-config` 及所需 ZIP 名称。模板只用于首次创建会话。以下命令保留 MP5 演练入口：

```sh
python tools/packaging/build_windows.py --custom-config configs/mp5-xronicle-swiss-2.json --package-name MP5-Xronicle-Windows-x64
```
