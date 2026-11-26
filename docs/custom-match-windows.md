# Custom-Match Windows 使用说明

适用 Windows 10 / 11 x64。直播电脑需要 Microsoft Edge WebView2 Runtime、osu!stable 和 OBS Studio。便携包含启动器、服务和 tosu，可直接在 Windows 启动。

## 1. 下载、解压与启动

1. 从赛事组织者领取便携包，或在 [Custom-Match 的 GitHub Actions](https://github.com/OCLR-dev/OCLR-stream-overlay/actions/workflows/windows-portable.yml?query=branch%3Atest%2Fcustom-match+event%3Apush) 打开最新成功的 Windows 打包记录，下载 `OCLR-Custom-Match-Windows-x64` 产物。
2. 把便携 ZIP 完整解压到一个文件夹，保留随包的 `tosu/` 等目录，双击 **OCLR-Custom-Match.exe**。如提示缺少 WebView2，安装 Microsoft Edge WebView2 Runtime 后重新打开。
3. 等「服务」页显示就绪，再切到比赛控制台。启动器可最小化，浏览器也可通过 `http://127.0.0.1:3011/control` 打开控制台。

## 2. 录入本场比赛和 BP

首次启动进入本地待配置会话。在「比赛配置 → 本场资料」填写以下内容。赛事资料由主办方提供，直接保存到本机。

| 项目 | 填写方法 |
| --- | --- |
| 赛事与赛制 | 填赛事标题、阶段和奇数 BO（1–31），选择本场的 3v3 或 4v4 常规布局。 |
| 队伍与名单 | 填左侧红队和右侧蓝队的播出队名及名单。名单也用于 Winner 画面。 |
| 图池 | 每行填写 `标签 谱面ID 标题`，标题可省略。支持 NM、HD、HR、DT、FM、CA 和 TB。 |
| BP | 双方各 Ban 一次、随后交替 Pick 的赛事可选对应预设。其他赛制在「本场 BP 规则」逐行录入动作。 |

在 Roll 分别确认先 Ban 和先 Pick 的队伍，按本场规则使用所需的先手。开始 BP 后，如要修正顺序，使用「纠错：修改后续 BP 顺序」。完整动作格式、TB 和重赛操作见 [自定义赛事配置](custom-match.md#bp-格式)。

## 3. 连接赛事客户端和 tosu

1. 在桌面「服务 → 比赛工具 → osu!Tourney」点击「选择 osu!.exe」，选中用于比赛观战的 `osu!.exe`。启动 osu!tourney 并进入本场房间，再在桌面「服务」打开 tosu。
2. 在「比赛配置 → 游戏数据」核对连接。Windows 新会话默认跟随启动器检测的本机 tosu，旧会话沿用保存的连接方式。如使用手填地址，随包 tosu 的默认地址是 `ws://127.0.0.1:24050/websocket/v2`。
3. 在比赛现场确认房间左右队伍、Now Playing 和连接状态。开播前用一局测试核对开打、比分及结算。需要人工补做时，按裁判核对的动作或赛果处理。

## 4. 配置 OBS 并试录

1. 将 OBS 基础画布设为 1920×1080。在「工具 → WebSocket 服务器设置」启用服务和密码认证。在「比赛配置 → OBS」输入本机 OBS 端口和密码并连接。
2. 创建比赛场景，或绑定本场的现有场景。手动添加浏览器源时，用 `http://127.0.0.1:3011/overlay`，宽 1920、高 1080，把游戏捕获放在浏览器源下方，对齐 Playing 的透明区域。
3. 逐路核对红方和蓝方的游戏窗口，在 OBS 混音器确认 Client 0 应用音频和实际电平。用 OBS Program 核对观众画面。广告或休息后，可在控制台点「切回当前比赛布局」。
4. 在 OBS 开始录像。服务会记录观察到的开打、重赛和全场结果。临时片段点「标记精彩时刻」，停录后在「录像打点」点「复制时间轴」。

## 5. 播放 Showcase 回放

1. 启动普通 osu!stable，预先安装要演示的谱面，并让 tosu 读取该客户端。在桌面「服务 → 比赛工具 → osu!Tourney」确认回放使用的 `osu!.exe`。
2. 在「Showcase」手动录入演示图池，或从控制台复制已加载图池。把本地 `.osr` 拖到对应 Slot，或点「选文件」。补入的文件保留到更换演示图池或退出服务，重新开播时请重新核对清单。
3. 在 Showcase 的 OBS 设置中创建场景并启用自动过场。来源从上到下为过场、普通 osu! 的游戏捕获和 Showcase 背景。手动添加背景浏览器源时，用 `http://127.0.0.1:3011/showcase?clean=1`。
4. 切到 OBS Program，看到「遮挡已确认」后点「播放下一张」。可用「设为下一张」指定已就绪的回放，或用「重播本张」重播当前谱面。

## 更新与存储

- 直播结束先停止录制，再退出启动器。再次打开会恢复已保存的比赛。
- 更新时，先退出旧启动器，再把新版解压到新目录。默认赛事数据在 `%LOCALAPPDATA%\OCLR\CustomMatchTest`，启动器设置在同级的 `CustomMatchTestLauncher`。备份时先退出，再复制这两个目录。
- 可在桌面「设置 → 资料存储」启用完全便携模式。第一次复制现有资料后重新打开启动器。移动或更新时，连同程序旁的 `OCLR-portable` 和 `OCLR-data` 一起搬迁。启用后，程序目录中的工具路径使用相对地址。

## 常见问题

| 看到的情况 | 怎么处理 |
| --- | --- |
| 页面关了 | 从桌面启动器重新切到比赛控制台。 |
| 服务端口被占用 | 在桌面「设置」改服务端口。重新连接 OBS 后核对已识别的本机来源地址和 Program，手动添加的来源也要逐一确认。 |
| tosu 没有当前读数 | 在桌面「服务 → 比赛工具 → tosu」核对应用程序路径和端口。存在有效的自选路径时会优先使用，再到「比赛配置 → 游戏数据」确认 WebSocket 地址。 |
| Showcase 缺回放 | 核对谱面已装进普通 osu!stable，把对应的本地 `.osr` 补到该 Slot。 |
| 比赛记录无法读取 | 保留数据目录，请维护者检查。 |

## 下载与定制打包

推送到 `test/custom-match` 后，GitHub Actions 按该次推送的提交构建通用包，并上传 ZIP、SHA-256 与原生验收报告。也可在 Actions 手动选择 `test/custom-match` 重新打包。

维护者可在具备 Node.js、Python 和 Go 的环境打包。

```sh
python tools/packaging/build_windows.py --custom-match
```

需要预装赛事配置时，传入 `--custom-config` 及所需 ZIP 名称。模板只用于首次创建会话。以下以 MP5 演练包为例。

```sh
python tools/packaging/build_windows.py --custom-config configs/mp5-xronicle-swiss-2.json --package-name MP5-Xronicle-Windows-x64
```
