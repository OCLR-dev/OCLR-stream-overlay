# 2026-11-15 表演赛反馈调查与修复

基于当前远端 `release/windows` 的 `f4b68fa`（v0.2.2）。修复位于 `codex/showmatch-1115-fixes`，尚未发布 Windows 包。

用户补充：今晚使用最新发布包；Roll 已设置先 Pick，但仍须在 Mappool 手工确认首张 Pick，之后才会自动跟随。没有当晚 tosu 采样。本次复现证明下面的代码路径能够产生该现象，不能证明它是当晚唯一发生的路径。

## 1. 开打前的 MOD 参数

原链路在正式模式下只显示 tosu。`normalizeTosuV2()` 仅在赛事 IPC 3／4 时汇总选手参数；准备期 `liveBeatmap()` 使用管理端根谱面的参数。管理端未应用对应 MOD 时，HR／DT 槽位便会显示 NM 参数，直至实际开打。

本轮复用已有的官方 `.osu` 下载、限流、缓存与 rosu-pp-js 4.0.1 工作线程计算。有效房间处于准备期 IPC 1／2 时，NM／HD／HR／DT 按槽位模组显示星级、CS／HP／AR／OD、变速 BPM，底栏注明「HR 参数预览」等。时长使用同图 tosu 的末物件时间再除以模组速率。切图或修改 MOD 立即清除旧值；下载失败时不使用根谱面的 NM 数据填补。

Playing／Ranking 使用实际选手参数，不用计算值填补缺失项。FM／TB 不根据分组猜实际 MOD；原模拟器计算模式保留。大星数块与参数行使用同一份显示结果。

## 2. Match Chat 的秒数

核查了 tosu 官方实现 `1d811dd90af00c7f0d8551a0735d9ce779a6e773`：

- [stable 聊天读取](https://github.com/tosuapp/tosu/blob/1d811dd90af00c7f0d8551a0735d9ce779a6e773/packages/tosu/src/memory/stable.ts#L1127)：从游戏聊天显示文字中分离时间和发言者。
- [v2 赛事输出](https://github.com/tosuapp/tosu/blob/1d811dd90af00c7f0d8551a0735d9ce779a6e773/packages/tosu/src/api/utils/buildResultV2.ts#L770)：将该时间文字直接输出为 `timestamp`，没有另一个包含秒数的字段。
- 本项目 `src/tosu.js` 保留该字段，`ui/matchChat.ts` 对带秒时钟显示真实秒数；只有时分时显示 `HH:mm:--`。模拟器的 ISO 时间含秒，不代表真实 stable 聊天也含秒。

因此来源只有时分时，现有 `--` 表示秒数未知，不能从这份数据还原；本轮不使用本机接收时间补造秒数。没有当晚原包，无法直接核对直播机的原始字符串及 tosu 版本。现象与来源精度不足一致，本轮保留现有展示规则。

## 3. OBS 游戏音频

旧实现采集或复用桌面播放设备，没有针对 osu!tourney Client 0 绑定；配置了全局桌面音频时还会直接跳过添加来源。它不能保证采集到 Client 0 实际使用的播放路径。

[OBS 官方应用音频实现](https://github.com/obsproject/obs-studio/blob/master/plugins/win-wasapi/win-wasapi.cpp#L1479)提供 `wasapi_process_output_capture`，接受 `window` 与标题匹配优先级。本轮在 OBS 提供该来源时：

- 两套预设共用一个「OCLR · osu!tourney 音频」，按音频来源自身的窗口列表匹配唯一 Client 0，保留标题前空格等原始编码。
- 该来源独立于视频槽位；EX 隐藏 A1 或改变上场窗口，不关闭 Client 0 音频。八路视频捕获不再额外采集音频。
- 旧预设重连时自动补齐，不需要再点创建；每 6 秒重新核对窗口，缺失或重名时清空绑定并等待，不回退到其他 osu!.exe。
- 两套比赛场景内本项目旧桌面来源停用。导播全局桌面音频、手建来源和其他场景保留；发现全局桌面音频时明确提示核对重复收音。
- 创建中断有本机进度记录，重试复用来源；不重置既有窗口几何和解锁状态。自建场景不自动添加音频。

若 OBS 不提供应用音频来源，保留旧桌面兼容方式，并显示升级提示。本机没有 Windows osu!tourney，以上只通过模拟 OBS 协议验证；Client 0 实际有声、切换连续和无重音仍待 Windows 直播机试听。此次未连接或修改真实 OBS。

## 4. 第一张 Pick 必须手点

定向复现顺序：房间先选好首图 → 本机建立该谱面的观察基线 → Roll 设置先 Pick → 谱面 ID 不再变化。原代码会建立首个 BP 动作，但自动 BP 只消费之后的谱面 ID 变化；旧图不产生新事件，因此首张停住。手动确认第一 Pick 后，后续换图都产生新事件，所以后续自动流程正常。

修复仅在本次明确 Roll 操作新建首个自动 Pick 时建立一次内存意图。后续准备房间的同图数据仍须至少两帧并稳定 400ms，才按已确认的 Pick 方应用。也支持 Roll 后才收到第一份准备房间数据。之后沿用原来的换图、开打、Ranking 和后续动作流程。

未确认先 Pick 时不猜队伍。池外图、重复谱面 ID 对应多个槽位、已 Ban／已使用图、动作已改变等仍按原校验处理。Playing／Ranking 不代替准备期确认；跨重启、来源断线或恢复旧会话不重放该意图。不创建错过的开打记录或赛果。

## 验证

- `npm run build`（含类型检查）：通过。
- `npm test`：555 项通过，0 失败；使用最新版原有的隔离端口便携包测试，未停用现有 3001 服务。
- 新回归覆盖准备期 HR／DT、进入 Playing 后切换来源、错图／缺参数／未知 FM、首图已选后确认先手、首帧基线、重复帧、动作变更、重启、Playing／Ranking、防抖中开打等。
- OBS 回归覆盖单一共享音源、EX 隐藏 Client 0 视频、旧桌面迁移、重连自动补齐、来源重名、Client 0 缺失／歧义、标题带空格、创建中断恢复，以及导播自建同名音源保留。
- 隔离 Chrome：1920×1080 准备期 HR 预览 → Playing 实际参数，1440／390 宽设置页音频状态，无横向溢出；启用减少动态效果。使用明确标记的合成几何和信号，未连接真实赛事、tosu、OBS 或凭证。

[准备期 HR](ready-hr-1920.png) · [Playing 实际参数](playing-hr-1920.png) · [OBS 设置 1440](obs-1440.png) · [OBS 设置 390](obs-390.png) · [浏览器读数](browser-checks.json)
