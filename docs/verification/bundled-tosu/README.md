# Launcher 图标与随包 tosu（#71、#72）

日期：2026-11-19。

## 实现

- Wails 左上角及关于页使用同一份 `tools/windows-launcher/assets/oclr-stream.ico`，正方形、等比显示，不再使用广播图标。
- Windows 打包每次查询 tosu 最新正式 release。GitHub 提供的资产 SHA-256 校验通过后才使用缓存或下载内容；检查 Windows AMD64 exe，并保留 ZIP 内配套文件。查询、资产选择、摘要或解压失败使打包失败。
- `tosu/bundled-release.json` 记录打包版本、资产及源代码摘要；`licenses/tosu/` 包含对应源代码 ZIP 与授权文本。运行后自动更新的版本不冒充打包版本。
- 上游没有 `tosu.env` 时，新包加入用户提供的完整默认配置。启动器以程序所在目录启动 tosu，只读取端口，不改写配置。
- 有效自定义路径优先；未选择或路径失效时回退到 launcher 同目录的 `tosu/tosu.exe`。自动路径不写成永久绝对路径，选择 osu! 时也不把它误存为自定义 tosu 路径。

## 验证

- `npm run build`、`npm run build:launcher`：通过，含 TypeScript 检查；图标作为构建资源打包。
- `npm test`：583 项通过。首次受限环境的回环连接测试失败，允许本机回环连接后完整重跑通过。
- Go launcher 测试与 Python 打包测试：覆盖自定义路径优先、失效回退、整包移动、中文／空白路径、完整 CRLF env 保留、最新版重新解析、资产缓存校验及无效 ZIP 拒绝。测试数据为 **synthetic**。
- 实际官方下载与 Windows 打包：成功取得 tosu `v4.26.3`，资产 SHA-256 `700063da6377c5f69985e09b0d30d575d27653519d7a3b1154bc11f1f9bd5752`；对应源码提交 `1d811dd90af00c7f0d8551a0735d9ce779a6e773`。

- Windows 原生包验证：17 项通过，涵盖中文／空白路径、首次默认 tosu 端口、自定义端口、迁移、重启、退出与数据保留。使用真实 Windows/Node/launcher，赛事与服务故障数据为 **synthetic**，未启动真实 tosu 或连接游戏。去除临时路径的结果见 [windows-native.json](windows-native.json)。

## 验收边界

桌面视觉检查的应用程式存取授权逾时，未完成截图、高 DPI 及不同窗口尺寸目视验收。未进行真实 osu!tourney／OBS／OCLR 联调；上述合成测试和打包验证不能替代这些验收。
