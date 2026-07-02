# Worker MVP 使用说明

Sedna Worker 是受控执行节点。它运行在用户自己控制的设备上，只暴露明确授权的本地能力，并把状态、事件和任务结果回传给 Central Brain。

Worker 不是独立大脑。它不能直接写规范记忆图数据库，不拥有长期记忆，也不负责全局规划。

## 当前能力

Worker MVP 对 Brain 只暴露两个 capability：

- `worker.status`：上报 worker 身份、状态、主机、系统、能力和最近任务。
- `agent.execute`：接收自然语言任务，在 worker 设备上运行本地 Worker Agent。

`file.list` / `file.search` / `file.read` / `file.write` / `command_run` 不是 Brain 可见的独立 capability，只作为 `agent.execute` 背后的 Worker Agent 内部工具存在。

在 `agent.execute` 内部，Worker Agent 可以：

- 列目录
- 搜索文件名
- 读取文本文件
- 创建或更新文本文件
- 执行 shell 命令

这些操作会受到 worker runtime policy 限制：允许路径、敏感路径阻断、读写/输出大小上限和 job timeout。

第一版明确不支持：

- 邮件发送
- 浏览器或 App 控制
- 对外发布
- 支付、账号或生产操作
- 自动高风险外部执行

## 启动 Brain 和 Web

先安装依赖：

```bash
pnpm install
```

启动 Brain API：

```bash
pnpm dev:brain
```

另开一个终端启动 Web UI：

```bash
pnpm dev:web
```

默认本地地址：

- Brain API：`http://127.0.0.1:8787`
- Web UI：`http://127.0.0.1:5173`

## 配对并启动本地 Worker

先在 Brain 上创建一次性 pair code：

```bash
curl -s -X POST http://127.0.0.1:8787/api/workers/pair-codes \
  -H 'Content-Type: application/json' \
  -d '{"ttl_ms":600000}'
```

然后在 worker 机器上配对。先选择这个 worker runtime 可以访问的本地目录。

```bash
SEDNA_BRAIN_URL=http://127.0.0.1:8787 \
SEDNA_WORKER_NAME="Local Worker" \
SEDNA_WORKER_ALLOWED_PATHS="$HOME/Documents:$HOME/Projects" \
pnpm dev:worker pair --code <PAIR-CODE>
```

配对成功后启动 worker runtime：

```bash
pnpm dev:worker
```

macOS 和 Linux 下，`SEDNA_WORKER_ALLOWED_PATHS` 用 `:` 分隔多个路径。Windows 下用 `;`。

配对会保存 `worker_id` 和该 worker 专属 credential 到本地 ignored state。启动后，worker 会声明能力、定时 heartbeat、轮询 pending jobs、执行支持的任务，并把结果回传给 Brain。

## Worker 环境变量

| 变量 | 是否必需 | 说明 |
| --- | --- | --- |
| `SEDNA_BRAIN_URL` | 是 | Brain API 地址，例如 `http://127.0.0.1:8787`。 |
| `SEDNA_WORKER_NAME` | 否 | Web UI 中显示的 worker 名称。 |
| `SEDNA_WORKER_ALLOWED_PATHS` | 强烈建议 | Worker Agent 可访问目录列表，按系统路径分隔符分隔。如果为空，搜索默认从 home 目录开始，runtime 除 forbidden path 检查外不会限制本地路径。 |
| `SEDNA_WORKER_STATE_PATH` | 否 | 本地忽略的 worker id 状态文件。默认是 `apps/worker/.local/worker-state.json`。 |
| `SEDNA_WORKER_HEARTBEAT_MS` | 否 | heartbeat 间隔，默认 `10000`。 |
| `SEDNA_WORKER_POLL_MS` | 否 | 轮询 pending job 间隔，默认 `2000`。 |
| `SEDNA_WORKER_MAX_READ_BYTES` | 否 | Worker Agent 内部 `file_read` 默认最大读取字节数。 |
| `SEDNA_WORKER_MAX_WRITE_BYTES` | 否 | Worker Agent 内部 `file_write` 默认最大写入字节数。 |
| `SEDNA_WORKER_MAX_SEARCH_RESULTS` | 否 | Worker Agent 内部 `file_search` 默认最大结果数。 |
| `SEDNA_WORKER_MAX_LIST_ENTRIES` | 否 | Worker Agent 内部 `file_list` 默认最大条目数。 |
| `SEDNA_WORKER_MAX_COMMAND_MS` | 否 | Worker Agent 内部 `command_run` 默认最大执行时长。 |
| `SEDNA_WORKER_MAX_COMMAND_OUTPUT_BYTES` | 否 | Worker Agent 内部 `command_run` 默认最大输出捕获字节数。 |

不要提交 `.env`、worker state、本地数据库、私有路径或凭据。

## 远程 Worker 设置

如果要让另一台机器连接 Brain，Brain 必须监听这台机器可访问的地址。只建议在可信局域网或 VPN 内测试。

Brain 机器：

```bash
HOST=0.0.0.0 \
PORT=8787 \
pnpm dev:brain
```

Worker 机器：

```bash
SEDNA_BRAIN_URL=http://<brain-lan-ip>:8787 \
SEDNA_WORKER_NAME="Office Worker" \
SEDNA_WORKER_ALLOWED_PATHS="/absolute/allowed/path" \
pnpm dev:worker pair --code <PAIR-CODE>
```

然后运行：

```bash
pnpm dev:worker
```

Pair code 是一次性的。配对成功后，Brain 只接受这个 worker 本地保存的专属 credential；heartbeat、job polling、capability sync、path scope sync 和 job result 上报如果没有正确 credential 都会返回 `401`。

不要把 MVP Brain API 直接暴露到公网。

## 在 Web UI 查看 Worker

打开 Web UI，然后进入 Workers 页面：

```text
http://127.0.0.1:5173/workers
```

这个页面会显示：

- worker 在线/离线状态
- 主机和系统
- 最近 heartbeat
- 已声明能力
- 已配置 path scopes
- 最近任务和任务结果
- 解除关联按钮

随着 Agent Runtime 集成推进，worker job 事件也会进入 timeline/audit 相关视图。

## 解除 Worker 关联

在 Web Workers 页面点击某个 worker 的解除关联按钮，会把它从当前活跃 Worker 列表中移除，同时把 Brain 中的 worker 状态改为 `revoked` 并清除该 worker 的 credential hash。这个 worker 本地保存的旧 credential 将不能继续 heartbeat、poll job 或回传结果。

也可以直接调用 API：

```bash
curl -s -X DELETE http://127.0.0.1:8787/api/workers/<worker-id>
```

在 worker 机器上清理本地配对 state：

```bash
pnpm dev:worker unpair
```

`revoked` worker 会从活跃 Worker 列表隐藏，但会保留在 Brain 中用于审计和历史查看，不会被物理删除。

## 在对话中使用 Worker

当至少有一个 worker 在线且 Brain Agent 可用时，Brain 通过 `worker_dispatch_task` 向 Worker 下发 `agent.execute` job。

示例：

```text
帮我在本地搜索 README
列出 /Users/example/Projects/my-project 下面有哪些文件
读取 /Users/example/Projects/my-project/README.md
把 /Users/example/Projects/my-project/notes.md 更新成一个简短总结
在 /Users/example/Projects/my-project 里运行 npm test 并总结失败原因
```

Brain 会：

1. 选择一个在线 worker
2. 检查 worker 是否启用 `agent.execute`
3. 创建 `agent.execute` worker job
4. Worker 本地 Agent 自行决定如何使用本地文件或 shell 命令
5. 把 worker 返回的 `answer` / `steps` 作为 tool observation 供 Brain 总结
6. 写入 worker job events 和 audit records

如果没有 worker 在线，Brain 不会编造本地文件结果。

## 手动创建任务

你也可以直接通过 Brain API 派发 worker job，便于调试 Worker 基础链路。

查看 workers：

```bash
curl -s http://127.0.0.1:8787/api/workers
```

创建 `agent.execute` 任务：

```bash
curl -s -X POST http://127.0.0.1:8787/api/worker-jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "worker_id": "worker_xxx",
    "capability": "agent.execute",
    "input": {
      "goal": "列出 /absolute/allowed/path 下的直接子文件和目录",
      "context": "Owner asked from chat"
    },
    "timeout_ms": 120000
  }'
```

查看某个 worker 和最近任务：

```bash
curl -s http://127.0.0.1:8787/api/workers/worker_xxx
```

## 安全规则

Worker 执行能力刻意保持受限：

- Brain 只派发 `agent.execute`；本地文件和命令工具只存在于 Worker Agent 内部。
- 配置了 `SEDNA_WORKER_ALLOWED_PATHS` 时，worker runtime 会据此限制路径访问。
- Brain 会保存并展示 worker path scopes，方便用户管理策略；当前 runtime 实际执行策略仍由 worker 环境变量驱动。
- 文件写入仅支持文本，并受 `SEDNA_WORKER_MAX_WRITE_BYTES` 限制。
- Shell 命令执行受 timeout 和输出大小限制。
- `agent.execute` 受 job timeout 限制，返回 `answer`、`steps` 和错误信息。
- Job 必须使用 worker 已声明的能力。
- Job 必须有 timeout。
- Job 生命周期会写入 event 和 audit。
- Worker 不能给自己扩权。

Worker 会拒绝敏感或噪音路径，包括：

- `.env`
- `.ssh`
- 私钥和证书 key 文件
- credential 或 secret 文件
- SQLite/runtime 数据库文件
- `.git`
- `node_modules`
- `dist`
- `build`

## 排查问题

如果 UI 里看不到 worker，检查：

- Brain 是否运行在 `SEDNA_BRAIN_URL`。
- worker 终端是否还在运行。
- worker 是否能访问 Brain API。
- `SEDNA_WORKER_ALLOWED_PATHS` 是否是存在的绝对路径。

如果 worker 任务失败或被拒绝，检查：

- 请求路径是否在 allowlist 内。
- 请求路径是否属于被禁止的 secret/runtime/build 路径。
- Brain Settings 里已配置 chat LLM。
- worker 已启用 `agent.execute`。
- worker 在线并正在轮询任务。

如果本地开发需要重新注册 worker，可以删除被忽略的本地 worker state 文件，也就是 `SEDNA_WORKER_STATE_PATH` 指向的文件，或默认的 `apps/worker/.local/worker-state.json`，然后重启 worker。
