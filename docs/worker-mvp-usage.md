# Worker MVP Usage

Sedna Worker is a controlled execution node. It runs on an owner-controlled machine, exposes explicitly scoped local capabilities, and reports status, events, and job results back to the Central Brain.

Workers are not independent brains. They do not write the canonical graph database directly, do not own long-term memory, and do not make global planning decisions.

## Current Capabilities

The Worker MVP exposes only two capabilities to Brain:

- `worker.status`: report worker identity, status, host, OS, capabilities, and recent jobs.
- `agent.execute`: accept a natural-language task and run a local Worker Agent on the worker device.

`file.list`, `file.search`, `file.read`, `file.write`, and `command_run` are not standalone Brain-visible capabilities. They exist only inside the Worker Agent runtime behind `agent.execute`.

Inside `agent.execute`, the Worker Agent can:

- list directories
- search file names
- read text files
- create or update text files
- run shell commands

These operations are bounded by the worker runtime policy: allowed paths, sensitive path blocking, byte/output limits, and job timeouts.

The first MVP intentionally does not support:

- email sending
- browser or app control
- external publishing
- payment, account, or production operations
- autonomous high-risk external execution

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

Then pair the worker. Choose the local folders this worker runtime may access.

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
| `SEDNA_WORKER_ALLOWED_PATHS` | strongly recommended | Path-delimited list of folders the Worker Agent may access. If empty, the runtime falls back to the home directory for searches and does not restrict local paths beyond forbidden-path checks. |
| `SEDNA_WORKER_STATE_PATH` | no | Local ignored state file containing the worker id. Defaults to `apps/worker/.local/worker-state.json`. |
| `SEDNA_WORKER_HEARTBEAT_MS` | no | Heartbeat interval. Defaults to `10000`. |
| `SEDNA_WORKER_POLL_MS` | no | Pending job polling interval. Defaults to `2000`. |
| `SEDNA_WORKER_MAX_READ_BYTES` | no | Default max bytes for internal Worker Agent `file_read`. |
| `SEDNA_WORKER_MAX_WRITE_BYTES` | no | Default max bytes for internal Worker Agent `file_write`. |
| `SEDNA_WORKER_MAX_SEARCH_RESULTS` | no | Default max results for internal Worker Agent `file_search`. |
| `SEDNA_WORKER_MAX_LIST_ENTRIES` | no | Default max entries for internal Worker Agent `file_list`. |
| `SEDNA_WORKER_MAX_COMMAND_MS` | no | Default max runtime for internal Worker Agent `command_run`. |
| `SEDNA_WORKER_MAX_COMMAND_OUTPUT_BYTES` | no | Default max captured output for internal Worker Agent `command_run`. |

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
- configured path scopes
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

When at least one worker is online and Brain Agent mode is available, Brain dispatches `agent.execute` jobs through `worker_dispatch_task`.

Example prompts:

```text
Search my local files for README.
List /Users/example/Projects/my-project.
Read /Users/example/Projects/my-project/README.md.
Update /Users/example/Projects/my-project/notes.md with a short summary.
Run npm test in /Users/example/Projects/my-project and summarize the failures.
```

Brain will:

1. choose an online worker
2. check that `agent.execute` is enabled
3. create an `agent.execute` worker job
4. let the Worker Agent decide how to use local files or shell commands
5. use the worker `answer` / `steps` as tool observations for the final reply
6. write worker job events and audit records

If no worker is online, Brain must not invent local file results.

## Create A Job Manually

You can also drive the Worker MVP directly through Brain API for debugging.

List workers:

```bash
curl -s http://127.0.0.1:8787/api/workers
```

Create an `agent.execute` job:

```bash
curl -s -X POST http://127.0.0.1:8787/api/worker-jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "worker_id": "worker_xxx",
    "capability": "agent.execute",
    "input": {
      "goal": "List direct children under /absolute/allowed/path",
      "context": "Owner asked from chat"
    },
    "timeout_ms": 120000
  }'
```

Inspect a worker and its recent jobs:

```bash
curl -s http://127.0.0.1:8787/api/workers/worker_xxx
```

## Safety Rules

Worker execution is intentionally scoped:

- Brain dispatches only `agent.execute`; local file and command tools are internal to the Worker Agent.
- The worker runtime enforces `SEDNA_WORKER_ALLOWED_PATHS` when it is configured.
- Brain stores and displays worker path scopes for owner policy management; the current runtime policy is still driven by the worker environment variables.
- File writes are text-only and capped by `SEDNA_WORKER_MAX_WRITE_BYTES`.
- Shell command execution is capped by timeout and output limits.
- `agent.execute` is bounded by job timeout and returns `answer`, `steps`, and errors.
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

If a worker task fails, check:

- The requested path is inside one of the allowed paths.
- The path is not a forbidden secret/runtime/build path.
- Brain chat LLM is configured in Settings.
- The worker has `agent.execute` enabled.
- The worker is online and polling jobs.

If you need to re-register a local development worker, remove the ignored local worker state file configured by `SEDNA_WORKER_STATE_PATH`, or the default `apps/worker/.local/worker-state.json`, and restart the worker.
