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
- SQLite-backed canonical memory graph storage
- conversation timeline
- event and audit records
- candidate memory extraction from user messages
- Memory Inbox for review
- simple domain graph views
- worker registry and capability model as data structures only

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
6. `apps/worker` minimal registry/mock only
7. `apps/cli` after pairing and local operations are better defined

## Technology Recommendation

Use TypeScript for the first version.

Recommended baseline:

- package manager: `pnpm`
- monorepo: pnpm workspaces
- server runtime: Node.js
- API framework: Fastify or Hono
- database: SQLite
- migrations: Drizzle Kit or Kysely migrations
- Web UI: React + Vite
- graph visualization: React Flow or Cytoscape.js
- shared schemas: Zod

The exact framework can still be finalized before implementation. The important choice is to keep protocol, memory, and policy types shared between Brain and Web from the start.

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
- `audit_log`
- `workers`
- `worker_capabilities`

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
POST   /api/workers/register-mock
GET    /api/audit
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

The UI should not try to show the full graph all at once. Domain views are the default.

## Worker MVP Position

Workers are part of the architecture from the beginning, but full execution is not the first proof point.

The MVP should model workers as graph and policy entities:

- worker identity
- display name
- environment
- location
- status
- declared capabilities
- allowed scopes
- risk policy

The first implementation can include:

- worker table
- worker capability table
- mock worker registration endpoint
- worker nodes in graph view

Real pairing and read-only file search can be the next slice after Brain memory is useful.

## LLM Integration

The MVP must include real conversation capability through an LLM provider boundary. A chat UI with only mocked replies is not enough to prove Sedna's core value.

The detailed LLM MVP plan is defined in:

- [docs/llm-integration-mvp.md](llm-integration-mvp.md)

The Brain should support both:

- `mock`: deterministic provider for tests and local demos without secrets
- `openai`: real provider for actual conversation

Configuration:

```text
LLM_PROVIDER=mock | openai
OPENAI_API_KEY=...
OPENAI_MODEL=...
```

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

## Next Design Slice

After this MVP design is accepted, the next document should define the implementation plan:

- exact TypeScript stack
- workspace files
- initial database migrations
- API contracts
- UI routes and components
- test strategy
- first end-to-end demo path
