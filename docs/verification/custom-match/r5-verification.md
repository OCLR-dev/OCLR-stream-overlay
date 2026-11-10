# Windows R5 · 2026-11-06

源码基线：`test/custom-match` / `0033bd8`。

- 类型检查与生产构建：通过。
- 模拟及会话回归：388 项通过，0 失败。
- 3001 固定端口的主线便携生命周期测试：当前 3001 服务正在运行，未纳入本轮回归；本包使用 3011，另行检查其启动、重启和恢复。
- 结算对抗时序：17 项中 15 项通过，`early-ipc`、`coherent-stale` 两项仍可能提前采信完整旧分数。
- 包内后端完整 BO9 演练：通过。使用 MP5 完整资料、HTTP 控制接口和真实本机 WebSocket，在隔离目录运行本次包内后端。
  - Warm-up Playing／Ranking 保留实时分数且不推进正式记录，回房间后退出。
  - Roll、两次 Ban、八张常规图自动开打／计胜／回图池，到达 4:4。
  - 中止后原图重新准备、撤回计胜、重新记胜、修正胜方；重复旧 Ranking 不覆盖人工修正。
  - 独立 TB 自动结算至 5:4，人工展示 Winner。
  - 退出重启逐字节保留会话，恢复九局赛果、中止尝试、Winner 和撤销记录。
- Windows 原生启动、游戏捕获和真实 tosu 最后一路结束时序：今晚在 Windows 测试。

包内后端演练主机：macOS arm64 / Node v24.16.0。Windows 包自带 Node 22.23.4 x64 和 Go 编译的 x64 GUI 启动器。

源码记录：`docs/verification/custom-match/r5-flow.json`、`r5-timing.json`。重跑流程：

```sh
node tools/packaging/check_custom_flow.mjs release/MP5-Xronicle-Windows-x64-20261106-r5 docs/verification/custom-match/r5-flow.json
```
