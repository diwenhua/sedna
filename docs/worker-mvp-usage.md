# Worker MVP Usage

Sedna Worker is a controlled execution node. It runs on an owner-controlled machine, exposes explicitly scoped local capabilities, and reports status, events, and job results back to the Central Brain.

Workers are not independent brains. They do not write the canonical graph database directly, do not own long-term memory, and do not make global planning decisions.

## Current Capabilities

The Worker MVP supports only read-only capabilities:

- `worker.status`: report worker identity, status, host, OS, capabilities, and recent jobs.
- `file.list`: list file and directory metadata directly under an allowed directory. It does not read file contents.
- `file.search`: search file names and metadata inside allowed paths. It does not read file contents.
- `file.read`: read one allowed file with a maximum byte limit.

The first MVP intentionally does not support:

- `file.write`
- `command.run`
- email sending
- browser or app control
- external publishing
- payment, account, or production operations
- autonomous high-risk execution

## Start Brain And Web

Install dependencies first:

```bash
pnpm install
```

Start the Brain API:

```bash
pnpm dev:brain
```

Start the Web UI in another terminal:

```bash
pnpm dev:web
```

The default local URLs are:

- Brain API: `http://127.0.0.1:8787`
- Web UI: `http://127.0.0.1:5173`

## Pair And Start A Local Worker

Create a one-time pair code on Brain:

```bash
curl -s -X POST http://127.0.0.1:8787/api/workers/pair-codes \
  -H 'Content-Type: application/json' \
  -d '{"ttl_ms":600000}'
```

Then pair the worker. Choose the local folders this worker is allowed to read. The worker and Brain both enforce the allowlist.

```bash
SEDNA_BRAIN_URL=http://127.0.0.1:8787 \
SEDNA_WORKER_NAME="Local Worker" \
SEDNA_WORKER_ALLOWED_PATHS="$HOME/Documents:$HOME/Projects" \
pnpm dev:worker pair --code <PAIR-CODE>
```

After pairing, start the worker runtime:

```bash
pnpm dev:worker
```

On macOS and Linux, `SEDNA_WORKER_ALLOWED_PATHS` uses `:` as the path separator. On Windows, use `;`.

Pairing saves `worker_id` and this worker's own credential in ignored local state. After startup, the worker declares capabilities, sends heartbeats, polls pending jobs, executes supported jobs, and posts results back to Brain.

## Worker Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `SEDNA_BRAIN_URL` | yes | Brain API base URL, for example `http://127.0.0.1:8787`. |
| `SEDNA_WORKER_NAME` | no | Display name shown in the Web UI. |
| `SEDNA_WORKER_ALLOWED_PATHS` | yes for file capabilities | Path-delimited list of folders the worker may read. |
| `SEDNA_WORKER_STATE_PATH` | no | Local ignored state file containing the worker id. Defaults to `apps/worker/.local/worker-state.json`. |
| `SEDNA_WORKER_HEARTBEAT_MS` | no | Heartbeat interval. Defaults to `10000`. |
| `SEDNA_WORKER_POLL_MS` | no | Pending job polling interval. Defaults to `2000`. |
| `SEDNA_WORKER_MAX_READ_BYTES` | no | Default maximum bytes for `file.read`. |
| `SEDNA_WORKER_MAX_SEARCH_RESULTS` | no | Default maximum results for `file.search`. |
| `SEDNA_WORKER_MAX_LIST_ENTRIES` | no | Default maximum entries for `file.list`. |

Do not commit `.env`, worker state files, local databases, private paths, or credentials.

## Remote Worker Setup

For another machine to connect, Brain must listen on an address reachable from that machine. Use a trusted LAN or VPN only.

On the Brain machine:

```bash
HOST=0.0.0.0 \
PORT=8787 \
pnpm dev:brain
```

On the Worker machine:

```bash
SEDNA_BRAIN_URL=http://<brain-lan-ip>:8787 \
SEDNA_WORKER_NAME="Office Worker" \
SEDNA_WORKER_ALLOWED_PATHS="/absolute/allowed/path" \
pnpm dev:worker pair --code <PAIR-CODE>
```

Then run:

```bash
pnpm dev:worker
```

Pair codes are one-time use. After pairing, Brain only accepts this worker's saved credential; heartbeat, job polling, capability sync, path scope sync, and job result submission return `401` without the correct credential.

Do not expose the MVP Brain API directly to the public internet.

## View Workers In The Web UI

Open the Web UI and go to the Workers tab:

```text
http://127.0.0.1:5173/workers
```

The page shows:

- worker online/offline status
- host and OS
- last heartbeat
- declared capabilities
- allowed read-only paths
- recent jobs and job results
- revoke action

Worker job events also appear in the timeline/audit surfaces as the Agent Runtime integration grows.

## Revoke A Worker

Click the revoke action on a worker in the Web Workers page to remove it from the active worker list, mark it as `revoked`, and clear its credential hash in Brain. That worker's saved local credential can no longer heartbeat, poll jobs, or submit job results.

You can also call the API directly:

```bash
curl -s -X DELETE http://127.0.0.1:8787/api/workers/<worker-id>
```

On the worker machine, remove local pairing state:

```bash
pnpm dev:worker unpair
```

Revoked workers are hidden from the active worker list but remain in Brain for audit and history. They are not physically deleted.

## Use Worker From Chat

When at least one worker is online, Brain can use the worker for basic read-only local file actions from the chat flow.

Supported chat-triggered actions:

- listing a local directory through `file.list`
- local file name search through `file.search`
- reading an explicit local file path through `file.read`

Example prompts:

```text
Search my local files for README.
Find package.json in the local project.
List /Users/example/Projects/my-project.
Read /Users/example/Projects/my-project/README.md.
```

Brain will:

1. choose an online worker
2. check the worker capability and allowed read-only path scopes
3. create a worker job
4. wait briefly for the worker result
5. pass the worker observation into the assistant reply context
6. write worker job events and audit records

If no worker is online, no worker action is executed. If the worker job fails or times out, the assistant reply still proceeds without treating the worker result as trusted context.

## Create A Read-Only Job Manually

You can also drive the Worker MVP directly through Brain API for debugging.

List workers:

```bash
curl -s http://127.0.0.1:8787/api/workers
```

Create a `file.list` job:

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

Create a `file.search` job:

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

Create a `file.read` job:

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

Inspect a worker and its recent jobs:

```bash
curl -s http://127.0.0.1:8787/api/workers/worker_xxx
```

## Safety Rules

Worker file capabilities are intentionally narrow:

- File access must stay inside enabled read-only worker path scopes.
- `file.search` returns file metadata only and does not read file contents.
- `file.list` returns direct child metadata only and does not read file contents.
- `file.read` is limited by `max_bytes` and may truncate large files.
- Jobs must use declared capabilities.
- Jobs have timeouts.
- Job lifecycle changes write events and audit records.
- Workers cannot grant themselves new permissions.

The worker refuses sensitive or noisy paths, including:

- `.env`
- `.ssh`
- private keys and certificate key files
- credential or secret files
- SQLite/runtime database files
- `.git`
- `node_modules`
- `dist`
- `build`

## Troubleshooting

If the worker does not appear in the UI, check:

- Brain is running at `SEDNA_BRAIN_URL`.
- The worker terminal is still running.
- The worker can reach the Brain API.
- `SEDNA_WORKER_ALLOWED_PATHS` points to existing absolute paths.

If a file job is rejected, check:

- The requested path is inside one of the allowed paths.
- The path is not a forbidden secret/runtime/build path.
- The capability name is exactly `file.search` or `file.read`.
- The worker is online and polling jobs.

If you need to re-register a local development worker, remove the ignored local worker state file configured by `SEDNA_WORKER_STATE_PATH`, or the default `apps/worker/.local/worker-state.json`, and restart the worker.
