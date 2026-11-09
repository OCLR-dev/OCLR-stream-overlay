# Windows 发布分支

日常开发和合并使用 `main`。需要 Windows 包时，将确认要发布的提交推进到 `release/windows`，该次推送才会自动验证、打包并发布 Pre-release。

| 操作 | Windows 行为 |
| --- | --- |
| 推送 `main` 或普通功能分支 | 不自动打包发布 |
| 提交面向 `main` 的 PR | 保留 Windows 验证与构建产物，不发布 Release |
| 推送 `release/windows` | 仅打包该次推送的最新提交，验证成功后发布 Pre-release |
| 手动运行 Windows portable validation | 仅验证并提供构建产物，不发布 Release |

## 发布已确认的 main 版本

```sh
git fetch origin
git switch release/windows
git merge --ff-only origin/main
git push origin release/windows
```

首次在本机使用该远端分支时，可用 `git switch --track origin/release/windows` 建立本地跟踪分支。没有本地修改时再切换分支。

也可以将已确认的更早提交快进到发布分支；不要求每个 main 提交都发布。如果快进失败，先检查两边历史，不使用强制推送覆盖已发布历史。

## 版本与验证

- 重构版从 `v0.1.0` 开始，后续为 `v0.1.1`、`v0.1.2`，按该系列已存在的最大补丁号递增。旧 `v0.0.x` 标签保留，不参与新系列编号；main 的提交数量不影响版本。
- 同一提交已经有 Windows 版本标签时，重跑沿用原版本，不重复增加版本号。
- 发布流程串行排队，正在打包及等待中的发布不会因下一次推送被取消。
- 一次推送即使包含多个开发提交，也只为分支顶端提交制作一个包。
- Windows 构建、测试、ZIP 校验和原生启动验证继续全部执行；通过后才上传 Release。
- GitHub Release 的源码 SHA、标签归属及已有产物检查保持有效，不覆盖指向其他提交的版本标签。

`release/windows` 初次建立在切换流水线前的 main 上，只建立发布入口，不立即制作新包。以后推进到包含新流水线的 main 提交时，才触发第一次专用分支发布。
