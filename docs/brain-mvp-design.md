# Sedna Brain MVP Design

This document defines the first implementation slice for Sedna. It turns the current product checkpoint into a buildable MVP without trying to implement the entire distributed agent system at once.

## Goal

The first version should prove that Sedna can understand its owner through conversation and turn that understanding into visible, editable, auditable memory.

The MVP is not a generic chat app and not a full distributed automation system. It is the smallest useful Central Brain loop:

```text
owner conversation
-> timeline events
-> candidate memory extraction
-> graph storage with evidence
-> review and correction
-> future replies use confirmed and high-confidence memory
```

## Scope

The MVP includes:

- a Central Brain API server
- a Web UI served as the primary client
- a graph-native Agent Runtime with safe internal actions
- SQLite-backed canonical memory graph storage
- conversation timeline
- event and audit records
- candidate memory extraction from user messages
- Memory Inbox for review
- simple domain graph views
- Worker MVP registry, pair-code enrollment, policy-scoped Worker Agent jobs, and audit
- dynamic LLM provider and model route configuration
- MCP and Skills registry foundations
- DingTalk and Feishu/Lark messaging channels with owner pairing, allowlists, deduplication, and audit

The MVP does not include:

- autonomous high-risk external actions
- production command execution
- email sending
- browser control
- full multi-worker orchestration
- mobile apps
- Electron as an architectural requirement
- a dedicated graph database or vector database

## Monorepo Shape

Use one repository with separate runnable apps and shared packages:

```text
sedna/
  apps/
    brain/
    web/
    worker/
    cli/

  packages/
    protocol/
    memory/
    policy/
    shared/

  docs/
  examples/
  data/        ignored local runtime data
```

Recommended first implementation order:

1. `packages/protocol`
2. `packages/memory`
3. `packages/policy`
4. `apps/brain`
5. `apps/web`
6. `apps/worker` policy-scoped Worker Agent runtime
7. `apps/cli` after pairing and local operations are better defined

The current implementation should treat the following design documents as MVP slices:

- [LLM Integration MVP](llm-integration-mvp.md)
- [Dynamic LLM Configuration Design](dynamic-llm-config-design.md)
- [Agent Runtime MVP Design](agent-runtime-mvp-design.md)
- [Agent Workbench UI Design](agent-workbench-ui-design.md)
- [Internationalization MVP](i18n-mvp-design.md)
- [MCP And Skills MVP Design](mcp-and-skills-mvp-design.md)
- [Messaging Channels MVP](message-channels-mvp.md)

## Technology Recommendation

Use TypeScript for the first version.

Current baseline:

- package manager: `pnpm`
- monorepo: pnpm workspaces
- server runtime: Node.js
- API framework: Fastify
- database: SQLite
- migrations: repository-managed SQLite schema/migrations
- Web UI: React + Vite
- graph visualization: React Flow or Cytoscape.js
- localization: typed translation dictionaries or a lightweight i18n library
- shared schemas: Zod

The important boundary is to keep protocol, memory, and policy types shared between Brain, Web, and Worker from the start.

## Core Data Model

Start with a small schema. Do not create every future table immediately.

Initial tables:

- `conversations`
- `messages`
- `events`
- `nodes`
- `edges`
- `evidence`
- `memory_candidates`
- `profiles`
- `profile_attributes`
- `profile_attribute_history`
- `audit_log`
- `workers`
- `worker_capabilities`
- `worker_path_scopes`
- `worker_jobs`
- `worker_events`
- `channel_configs`
- `channel_pair_codes`
- `channel_conversation_bindings`
- `channel_messages`
- `settings`

Core graph fields:

```text
nodes:
  id
  type
  label
  payload_json
  status
  confidence
  scope_type
  scope_id
  origin
  created_at
  updated_at
  expires_at

edges:
  id
  source_node_id
  relation
  target_node_id
  payload_json
  status
  confidence
  scope_type
  scope_id
  created_at
  updated_at

evidence:
  id
  source_type
  source_id
  quote
  artifact_ref
  created_at
```

`payload_json` is acceptable in the first version because the graph will evolve. Stable fields stay relational; changing domain-specific fields live in JSON until patterns settle.

Owner Profile attributes are graph nodes linked by `has_attribute` edges from the `owner_profile` node. `profiles` keeps lightweight owner metadata; `profile_attribute_history` keeps change history keyed by graph node id. LLM extraction proposes profile patches; the Brain profile service decides merge, replace, conflict, review, confirmation, evidence, history, events, and audit.

Memory retrieval should return a bounded, evidence-backed subgraph rather than only matching node labels. The MVP query starts from relevant active nodes, expands active relationships in either direction for at most two hops, caps the total number of returned nodes, and includes only evidence referenced by nodes or edges in that subgraph. Returned paths must preserve edge direction so the Agent can explain relationships without reversing their meaning.

## Memory Candidate Lifecycle

Conversation should not directly mutate active long-term memory.

Use this lifecycle:

```text
observed
-> candidate
-> active
-> superseded / expired / rejected / quarantined
```

Default policy:

- low-risk, high-confidence memories can be auto-promoted
- medium-risk memories go to Memory Inbox
- high-risk memories require explicit confirmation
- conflicts enter quarantine
- rejected memories should remain as tombstones unless the owner requests permanent deletion

Risk examples:

- low: UI style, communication style, content preferences
- medium: work habits, tool preferences, project context
- high: security rules, forbidden paths, identity facts, permissions, automation policy

## Event Timeline

Everything important should produce events before it becomes UI.

Core MVP event types:

- `conversation.created`
- `message.created`
- `memory.candidate_created`
- `memory.promoted`
- `memory.rejected`
- `memory.quarantined`
- `node.created`
- `edge.created`
- `task.suggested`
- `worker.registered`
- `worker.heartbeat`
- `worker.online`
- `worker.offline`
- `worker.capability.updated`
- `worker.path_scope.updated`
- `worker.job.created`
- `worker.job.started`
- `worker.job.completed`
- `worker.job.failed`
- `audit.recorded`

The Web UI should render user-facing events as timeline items. Raw audit records remain inspectable but are not the normal reading experience.

## Brain API

Initial API surface:

```text
POST   /api/conversations
GET    /api/conversations
GET    /api/conversations/:id
POST   /api/conversations/:id/messages

GET    /api/timeline
GET    /api/events

GET    /api/memory/candidates
POST   /api/memory/candidates/:id/approve
POST   /api/memory/candidates/:id/reject
PATCH  /api/memory/candidates/:id

GET    /api/graph
GET    /api/graph/nodes/:id
GET    /api/graph/views/:view

GET    /api/workers
POST   /api/workers/pair-codes
GET    /api/workers/pair-codes
POST   /api/workers/pair
GET    /api/workers/:id
PATCH  /api/workers/:id
DELETE /api/workers/:id
POST   /api/workers/:id/revoke
POST   /api/workers/:id/heartbeat
POST   /api/workers/:id/capabilities
POST   /api/workers/:id/capabilities/sync
PATCH  /api/workers/:id/capabilities/:capabilityId
POST   /api/workers/:id/path-scopes
PATCH  /api/workers/:id/path-scopes/:scopeId
DELETE /api/workers/:id/path-scopes/:scopeId
GET    /api/workers/:id/policy
GET    /api/workers/:id/agent-llm
GET    /api/workers/:id/jobs/pending
POST   /api/workers/:id/jobs/:jobId/start
POST   /api/workers/:id/jobs/:jobId/complete
POST   /api/workers/:id/jobs/:jobId/fail
POST   /api/worker-jobs
GET    /api/audit

GET    /api/channels
PATCH  /api/channels/:platform
POST   /api/channels/:platform/pair-codes
POST   /api/channels/:platform/reconnect

GET    /api/settings
PATCH  /api/settings
```

Streaming updates can be added with Server-Sent Events first:

```text
GET /api/timeline/stream
```

WebSocket can be introduced when worker execution needs bidirectional interaction.

## Web UI MVP

The first Web UI should have four primary surfaces:

1. Chat Timeline
   - owner messages
   - assistant replies
   - memory and graph activity events
   - confirmation prompts

2. Memory Inbox
   - candidate memories
   - evidence quote
   - risk/confidence/status
   - approve, reject, edit, quarantine

3. Graph View
   - domain filters: Profile, Project, Resource, Worker
   - nodes and edges
   - evidence side panel
   - status and confidence

4. Agent Activity
   - what Sedna extracted
   - what it promoted
   - what it rejected or quarantined
   - why an item needs attention

5. Settings
   - interface language
   - assistant reply language
   - model/provider configuration status
   - privacy and data handling notes

The UI should not try to show the full graph all at once. Domain views are the default.

The Web UI should be implemented as an Agent Workbench rather than a chat-only page. The detailed UI design is defined in:

- [docs/agent-workbench-ui-design.md](agent-workbench-ui-design.md)

The Web UI must support English and Simplified Chinese in the MVP. Language switching is defined in:

- [docs/i18n-mvp-design.md](i18n-mvp-design.md)

## Worker MVP Position

Workers are part of the architecture from the beginning, but uncontrolled automation is not the first proof point.

The Worker MVP should model workers as graph and policy entities while allowing Brain to dispatch a bounded local Worker Agent:

- worker identity
- display name
- environment
- location
- status
- declared capabilities
- allowed scopes
- risk policy

The first implementation includes:

- worker table
- worker capability table
- worker path scopes
- worker jobs
- worker events
- pair-code enrollment
- credentialed worker authentication
- heartbeat endpoint
- worker policy sync
- pending job polling
- job start/complete/fail result reporting
- worker nodes in graph view
- Workers page in the Web UI

The supported Worker MVP capabilities are:

- `worker.status`
- `agent.execute`

`agent.execute` accepts a natural-language task from Brain and runs a local Worker Agent on the worker device. Inside that Worker Agent, local tools may list, search, read, write files, and run shell commands, but only within the runtime policy:

- path allowlist from `SEDNA_WORKER_ALLOWED_PATHS`; Brain stores and displays path scopes for owner policy management, while the current runtime policy is driven by worker environment variables
- sensitive path blocking for secrets, credentials, runtime databases, `.git`, dependency folders, and build output
- max read/write/output limits
- job timeout
- worker credential authentication
- Brain-side job events and audit records

`file.list`, `file.search`, `file.read`, `file.write`, and command execution are not standalone Brain-visible worker capabilities in the current MVP. They are internal Worker Agent tools behind `agent.execute`.

The Worker MVP intentionally does not support email sending, browser control, app control, external publishing, payment/account actions, or autonomous high-risk external operations.

Background service installation, richer confirmation policy for mutating local actions, artifact transfer, and full multi-worker orchestration remain future slices.

Usage instructions are documented in:

- [Worker MVP Usage](worker-mvp-usage.md)
- [Worker MVP Usage zh-CN](worker-mvp-usage.zh-CN.md)

## LLM Integration

The MVP must include real conversation capability through an LLM provider boundary. A chat UI with only mocked replies is not enough to prove Sedna's core value.

The detailed LLM MVP plan is defined in:

- [docs/llm-integration-mvp.md](llm-integration-mvp.md)
- [docs/dynamic-llm-config-design.md](dynamic-llm-config-design.md)

The detailed Agent Runtime plan is defined in:

- [docs/agent-runtime-mvp-design.md](agent-runtime-mvp-design.md)

The Brain should require a configured real provider:

- `openai`: real provider for actual conversation
- additional adapters through dynamic provider configuration

Configuration:

```text
LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=...
```

Assistant replies should follow the configured assistant reply language. The UI language and assistant reply language are related but separate settings.

The MVP should route all LLM work through a small internal service boundary:

```text
owner message
-> context builder
-> assistant reply prompt
-> assistant message
-> extraction prompt
-> structured candidate memories
-> policy classification
-> graph mutation proposal
```

The model should return structured output validated by Zod before writing anything.

No candidate should become active without policy evaluation.

The first implementation can be synchronous. Streaming, embeddings, local models, and multi-provider routing are out of scope for this MVP.

## Privacy And Local Data

Runtime data remains ignored:

```text
data/
server/data/
apps/brain/data/
worker/.local/
.env
*.sqlite
*.db
```

The repository can include:

- migrations
- schemas
- sample config
- test fixtures without private data
- mocked conversations

## Acceptance Criteria

The MVP is useful when a fresh user can:

1. open the Web UI
2. talk to Sedna about goals, projects, preferences, and constraints
3. see candidate memories extracted from the conversation
4. approve, reject, or edit those memories
5. see approved memories in a graph view
6. ask a later question and get a response influenced by approved memory
7. inspect why Sedna believes something
8. see an audit trail of important memory changes
9. switch the Web UI between English and Simplified Chinese
10. choose whether assistant replies follow the interface language, English, or Simplified Chinese
11. pair a local worker with a short-lived pair code and see its status in the Web UI
12. dispatch a policy-scoped `agent.execute` job to an online worker and inspect the job result and audit trail

## Next Design Slice

After this MVP design is accepted, the next document should define the implementation plan:

- exact TypeScript stack
- workspace files
- initial database migrations
- API contracts
- UI routes and components
- test strategy
- first end-to-end demo path
