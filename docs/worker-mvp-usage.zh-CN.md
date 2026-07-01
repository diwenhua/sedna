# Worker MVP 使用说明

Sedna Worker 是受控执行节点。它运行在用户自己控制的设备上，只暴露明确授权的本地能力，并把状态、事件和任务结果回传给 Central Brain。

Worker 不是独立大脑。它不能直接写规范记忆图数据库，不拥有长期记忆，也不负责全局规划。

## 当前能力

Worker MVP 只支持只读能力：

- `worker.status`：上报 worker 身份、状态、主机、系统、能力和最近任务。
- `file.list`：列出允许目录下的直接子文件/子目录元数据，不读取文件内容。
- `file.search`：在允许路径内搜索文件名和元数据，不读取文件内容。
- `file.read`：读取一个允许路径内的文件，并受最大字节数限制。

第一版明确不支持：

- `file.write`
- `command.run`
- 邮件发送
- 浏览器或 App 控制
- 对外发布
- 支付、账号或生产操作
- 自动高风险执行

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

然后在 worker 机器上配对。先选择这个 worker 可以读取的本地目录。Worker 和 Brain 都会检查 allowlist。

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
| `SEDNA_WORKER_ALLOWED_PATHS` | 文件能力需要 | worker 可读取目录列表，按系统路径分隔符分隔。 |
| `SEDNA_WORKER_STATE_PATH` | 否 | 本地忽略的 worker id 状态文件。默认是 `apps/worker/.local/worker-state.json`。 |
| `SEDNA_WORKER_HEARTBEAT_MS` | 否 | heartbeat 间隔，默认 `10000`。 |
| `SEDNA_WORKER_POLL_MS` | 否 | 轮询 pending job 间隔，默认 `2000`。 |
| `SEDNA_WORKER_MAX_READ_BYTES` | 否 | `file.read` 默认最大读取字节数。 |
| `SEDNA_WORKER_MAX_SEARCH_RESULTS` | 否 | `file.search` 默认最大结果数。 |
| `SEDNA_WORKER_MAX_LIST_ENTRIES` | 否 | `file.list` 默认最大条目数。 |

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
- 允许读取的路径
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

当至少有一个 worker 在线时，Brain 可以在聊天流程中调用 worker 执行基础只读本地文件动作。

当前支持从对话触发：

- 通过 `file.list` 列出本地目录
- 通过 `file.search` 搜索本地文件名
- 通过 `file.read` 读取明确给出的本地文件路径

示例：

```text
帮我在本地搜索 README
在本地项目里找 package.json
列出 /Users/example/Projects/my-project 下面有哪些文件
读取 /Users/example/Projects/my-project/README.md
```

Brain 会：

1. 选择一个在线 worker
2. 检查 worker capability 和只读 allowed path scope
3. 创建 worker job
4. 短时间等待 worker 返回结果
5. 把 worker observation 放入 assistant reply context
6. 写入 worker job events 和 audit records

如果没有 worker 在线，就不会执行 worker action。如果 worker job 失败或超时，assistant reply 仍会继续生成，但不会把失败结果当作可信上下文。

## 手动创建只读任务

你也可以直接通过 Brain API 派发 worker job，便于调试 Worker 基础链路。

查看 workers：

```bash
curl -s http://127.0.0.1:8787/api/workers
```

创建 `file.list` 任务：

```bash
curl -s -X POST http://127.0.0.1:8787/api/worker-jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "worker_id": "worker_xxx",
    "capability": "file.list",
    "input": {
      "path": "/absolute/allowed/path",
      "max_entries": 100
    },
    "timeout_ms": 30000
  }'
```

创建 `file.search` 任务：

```bash
curl -s -X POST http://127.0.0.1:8787/api/worker-jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "worker_id": "worker_xxx",
    "capability": "file.search",
    "input": {
      "query": "README",
      "paths": ["/absolute/allowed/path"],
      "max_results": 20
    },
    "timeout_ms": 30000
  }'
```

创建 `file.read` 任务：

```bash
curl -s -X POST http://127.0.0.1:8787/api/worker-jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "worker_id": "worker_xxx",
    "capability": "file.read",
    "input": {
      "path": "/absolute/allowed/path/README.md",
      "max_bytes": 200000
    },
    "timeout_ms": 30000
  }'
```

查看某个 worker 和最近任务：

```bash
curl -s http://127.0.0.1:8787/api/workers/worker_xxx
```

## 安全规则

Worker 文件能力刻意保持很窄：

- 文件访问必须在启用的只读 worker path scope 内。
- `file.search` 只返回文件元数据，不读取内容。
- `file.list` 只返回直接子项元数据，不读取内容。
- `file.read` 受 `max_bytes` 限制，大文件会截断或被拒绝。
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

如果文件任务被拒绝，检查：

- 请求路径是否在 allowlist 内。
- 请求路径是否属于被禁止的 secret/runtime/build 路径。
- capability 名称是否正好是 `file.search` 或 `file.read`。
- worker 是否在线并正在轮询任务。

如果本地开发需要重新注册 worker，可以删除被忽略的本地 worker state 文件，也就是 `SEDNA_WORKER_STATE_PATH` 指向的文件，或默认的 `apps/worker/.local/worker-state.json`，然后重启 worker。
