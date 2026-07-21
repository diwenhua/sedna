# Messaging Channels MVP

Sedna can use DingTalk and Feishu/Lark as owner-facing conversation entry points. Both adapters use the platforms' outbound long-connection mode, so the Brain does not need a public webhook endpoint for incoming chat messages.

Messaging platforms are channels, not authorities. They never write canonical memory or invoke Worker capabilities directly. Every accepted message enters the existing Brain conversation flow, policy boundary, event stream, and audit log.

## Supported slice

- DingTalk enterprise internal application bot through Stream Mode
- Feishu/Lark self-built application bot through WebSocket long connection
- text messages
- direct-message owner pairing with a ten-minute one-time code
- explicit allowed-user list
- group allowlist, disabled by default
- required bot mention in groups by default
- durable inbound-message deduplication
- one Brain conversation per channel conversation and sender
- connection state and last error in Web Settings
- secrets stored in the ignored Brain runtime database and never returned by the API

Images, audio, files, streaming cards, scheduled outbound notifications, and approval cards are later slices.

## Configure DingTalk

1. Create an enterprise internal application in the DingTalk developer console.
2. Add the bot capability and select Stream Mode for message receiving.
3. Publish the application to the owner account or required visibility range.
4. Copy the Client ID/AppKey and Client Secret/AppSecret.
5. In Sedna Web Settings, open **Messaging channels → DingTalk**, enter the credentials, and enable the channel.

## Configure Feishu or Lark

1. Create a self-built application in the Feishu/Lark developer console.
2. Enable the bot capability and grant the message receive/send permissions required by the console.
3. Subscribe to the message receive event and select long-connection/WebSocket delivery.
4. Publish the application to the owner account or required visibility range.
5. Copy the App ID and App Secret.
6. In Sedna Web Settings, open **Messaging channels → Feishu / Lark**, enter the credentials, and enable the channel.

The current adapter targets the mainland Feishu API domain. A selectable Lark international domain is a follow-up.

## Pair the owner

After the channel reports `connected`:

1. Click the pair-code button in Web Settings.
2. Direct-message the bot with the displayed command, for example:

   ```text
   /pair 123456
   ```

3. The code can be used once and expires after ten minutes.
4. The platform user ID is added to the channel allowlist and recorded in audit.

Unknown users cannot enter the Agent flow. Group messages additionally require the sender to be paired, the group ID to be explicitly allowed, and the bot to be mentioned when mention gating is enabled.

## Runtime and security

- The Brain opens only outbound TLS/WebSocket connections to the messaging platforms.
- Platform credentials are never committed and are never returned to the browser after save.
- Inbound delivery is acknowledged promptly; Agent work continues asynchronously.
- External message IDs are claimed in SQLite before processing to prevent retry-driven duplicate actions.
- Each channel message stores its external identity and resulting Brain conversation/message references.
- Text from a paired account is still untrusted input and cannot bypass policy or confirmation.
- Conversation content and replies transit the selected messaging provider. Sensitive local files and secrets should not be sent to a channel by default.

## Relevant API

```text
GET  /api/channels
PATCH /api/channels/:platform
POST /api/channels/:platform/pair-codes
POST /api/channels/:platform/reconnect
```

Supported platform values are `dingtalk` and `feishu`.
