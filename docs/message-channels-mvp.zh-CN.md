# 消息渠道 MVP

Sedna 可以把钉钉和飞书/Lark 作为 Owner 的对话入口。两个适配器都使用平台提供的出站长连接，因此 Brain 接收聊天消息时不需要开放公网 Webhook。

消息平台只是渠道，不是系统权威。它们不能直接写规范记忆，也不能绕过 Brain 调用 Worker。所有被接受的消息都会进入现有的 Brain 会话流、策略检查、事件和审计边界。

## 当前支持范围

- 钉钉企业内部应用机器人 Stream 模式
- 飞书/Lark 企业自建应用机器人 WebSocket 长连接
- 文本消息
- 单聊十分钟一次性 Owner 配对码
- 显式用户 allowlist
- 群聊 allowlist，默认全部关闭
- 群聊默认必须 @机器人
- 持久化消息去重
- 按渠道会话和发送者隔离 Brain 会话
- Web 设置页展示连接状态和最近错误
- Secret 保存在被忽略的 Brain runtime 数据库中，API 不会返回明文

图片、语音、文件、流式卡片、定时主动通知和审批卡片属于后续切片。

## 配置钉钉

1. 在钉钉开发者后台创建企业内部应用。
2. 添加机器人能力，并把消息接收模式设为 Stream 模式。
3. 发布应用，并把 Owner 账号加入可见范围。
4. 复制 Client ID/AppKey 和 Client Secret/AppSecret。
5. 在 Sedna Web 设置中打开“消息渠道 → DingTalk”，填写凭据并启用。

## 配置飞书或 Lark

1. 在飞书/Lark 开发者后台创建企业自建应用。
2. 启用机器人，并按照后台提示授予收发消息权限。
3. 订阅接收消息事件，选择长连接/WebSocket 接收方式。
4. 发布应用，并把 Owner 账号加入可用范围。
5. 复制 App ID 和 App Secret。
6. 在 Sedna Web 设置中打开“消息渠道 → Feishu / Lark”，填写凭据并启用。

当前适配器默认使用中国大陆飞书 API 域名；可选择的 Lark 国际域名是后续能力。

## 绑定 Owner

渠道状态变为 `connected` 后：

1. 在 Web 设置页点击生成配对码。
2. 在与机器人的单聊中发送页面展示的命令，例如：

   ```text
   /pair 123456
   ```

3. 配对码只能使用一次，十分钟后过期。
4. 平台用户 ID 会进入渠道 allowlist，并写入审计记录。

未知用户不能进入 Agent 流。群聊消息还必须同时满足：发送者已绑定、群 ID 已加入 allowlist，并且在启用 mention gate 时明确 @机器人。

## 运行和安全边界

- Brain 只向消息平台建立出站 TLS/WebSocket 连接。
- 平台凭据不得提交到仓库，保存后也不会由 API 返回给浏览器。
- 收到平台消息后先快速确认投递，再异步执行 Agent 流程。
- 处理前先在 SQLite 中 claim 外部消息 ID，防止平台重试造成重复动作。
- 渠道消息会记录外部身份以及对应的 Brain 会话和消息引用。
- 即使消息来自已绑定账号，文本仍然是不可信输入，不能绕过策略与确认。
- 对话内容和回复会经过所选消息平台；默认不应向渠道发送敏感本地文件或 Secret。

## 相关 API

```text
GET  /api/channels
PATCH /api/channels/:platform
POST /api/channels/:platform/pair-codes
POST /api/channels/:platform/reconnect
```

当前 `platform` 支持 `dingtalk` 和 `feishu`。
