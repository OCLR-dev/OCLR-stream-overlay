# Match Chat 时间、Bot 与直播槽位颜色

对应 [Issue #28](https://github.com/OCLR-dev/OCLR-stream-overlay/issues/28)。实现位于 `ui/matchChat.ts`，由现有共享输出调用；`src/tosu.js` 新增保留 `ipcId`，不改变自动化、计分或会话持久化。

## 显示规则

- 时间列显示上游消息时间，完整时钟为 `HH:mm:ss`。只有时分时显示 `HH:mm:--`，缺失／无效时显示 `--:--:--`；ISO 时间须带明确时区，按直播机时区显示。没有生成替代时间。
- `bot` 或不区分大小写的 BanchoBot 昵称优先黄色。
- 其他昵称与最新客户端姓名匹配，只有当前布局前 N 个真实 IPC 槽位内的有效选手按客户端 `left`／`right` 显示红蓝。正常 6／8 人为 `ipcId` 0–5／0–7；EX 跟随实际窗口数。编号缺失或空槽不补位；未匹配、重复姓名或槽位外用户显示灰色。
- 时间单独占一列，昵称和消息自然换行；420×138 固定尺寸、场景间组件常驻、贴底和最近最多 100 条保持。

## 验证

- 新增 8 项针对性测试：真实槽位编号投影与无效值、6／8 人边界、布局变化、换位、空位、不完整数据、Bot 优先级、重复姓名、时间精度及 ISO 时间。
- 完整 `npm test`：452 项通过。最后补充的时间括号校验由 8 项针对性测试再次通过验证；`git diff --check` 通过。
- `npm run check` 与隔离生产构建通过。构建输出为 `.local/issue-28/dist`，没有覆盖运行中服务的 `dist`。
- 1920×1080 无头 Chrome 的 21 组检查通过：6／8 人的四种昵称颜色、真实 DOM 时间、已有消息换位／离槽更新、六画面同一聊天组件与位置、3v3／4v4 × 4:3／16:9 × EX 开关的八组捕获区域不变、超长昵称／消息与无空格链接换行、缺失秒数、刷新保留原消息时间与比赛记录、过期数据清空聊天。浏览器无运行异常。
- [6 人聊天](chat-6.png) · [8 人聊天](chat-8.png) · [长消息](long-messages.png) · [8 人全画幅](slots-8.png) · [浏览器量测](browser-checks.json)。

截图和量测使用隔离内存会话、明确的合成消息与选手，经过当前 `normalizeTosuV2` → 共享会话 SSE → 正式 `/overlay`。没有接入正在运行的比赛或读取凭证；真实 Windows／tosu／OBS 联调仍待现场验收，尤其要核对现场 tosu 的时间是否含秒。

tosu 官方类型提供字符串 `timestamp` 与客户端 `ipcId`；stable 路径从游戏聊天文字提取时间，并非生成独立的高精度消息时间。参考：[v2 类型](https://github.com/tosuapp/tosu/blob/master/packages/tosu/src/api/types/v2.ts)、[聊天与客户端映射](https://github.com/tosuapp/tosu/blob/master/packages/tosu/src/api/utils/buildResultV2.ts)、[stable 聊天读取](https://github.com/tosuapp/tosu/blob/master/packages/tosu/src/memory/stable.ts)。
