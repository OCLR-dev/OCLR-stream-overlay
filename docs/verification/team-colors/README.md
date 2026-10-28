# 红蓝队色与游戏窗口收束

2026-10-27（America/New_York），由 Codex 直接调整。

- 增强顶部两侧的浅红/浅蓝背景、队名、星位、窗口边框、图池状态区、等待页标题/头像和比分底色。
- Playing 与单图结算移除窗底整条选手信息栏，包括槽位编号、姓名与角色标签；源画面利用释放的空间，继续保持 contain。外层窗口位置与大小不变。
- 中央品牌、三个核心场景共用的背景和图池列表维持浅紫；既有低强度动效保留。

验证：`npm run build`（含类型检查）、`git diff --check` 通过。浏览器检查八种常规人数/源比例/EX 组合，信息栏数量为 0、游戏源未超出窗口且比例正确，Playing 与结算源窗口逐一对齐。记录见 [browser-checks.json](browser-checks.json)。本轮为视觉调整，未新增或重跑数据层测试；真实 OBS/tosu 未联调。

预览：[Playing](playing.jpg) · [单图结算](map-result.jpg) · [Mappool](mappool.jpg) · [等待](waiting.jpg)。截图中的粉色翻译浮标属于本机浏览器扩展。
