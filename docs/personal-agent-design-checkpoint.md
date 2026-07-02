# Sedna Design Checkpoint

This document records the current product and engineering consensus. It is a working checkpoint, not a final implementation spec.

## Product Positioning

The project is a single-owner, self-hosted personal assistant agent server.

It is not a SaaS product and not a multi-user collaboration system. Each person deploys their own instance. The code is reusable, while the data is private to that deployed instance.

The core product is a central agent brain plus distributed workers.

The central server is the brain. It owns understanding, memory, planning, permissions, orchestration, and audit.

Workers are the hands. They run on the owner's devices or environments and expose controlled local capabilities. Web, Electron, CLI, and messaging clients are access points. Electron is not the architectural center.

## Core Goal

The assistant should learn and understand the owner while already doing safe, auditable work inside the system.

The first version focuses on:

- understanding the owner
- building a private profile
- tracking projects, goals, tasks, preferences, constraints, and success criteria
- producing useful next-step suggestions
- automatically maintaining memory, graph structure, tasks, goals, resources, and summaries inside the system
- supporting low-risk, auditable, reversible internal actions
- coordinating controlled distributed workers for safe, scoped device-local work
- preserving enough structure and permission boundaries to support future external action execution

The first version is understanding-first, but not analysis-only. It should let the agent organize, update, and maintain the owner's private system with clear audit trails. External actions remain restricted by risk and confirmation policy.

## Deployment Model

The tool should run as a self-hosted server that can be deployed on any always-available machine:

- VPS
- home server
- Mac mini
- NAS
- other personal infrastructure

The first-class deployment model is single-owner self-hosting.

## Central Brain And Distributed Workers

The system should be designed from the beginning as one brain with multiple hands.

The central brain:

- talks with the owner
- owns and maintains the canonical memory graph database
- understands goals, tasks, resources, preferences, constraints, and tools
- plans multi-step work
- decides which worker or tool is relevant
- evaluates permissions and risk
- requests owner confirmation when required
- writes audit records
- aggregates results from workers
- exposes the only API that can mutate canonical graph state

Distributed workers:

- run on owner-controlled devices or environments
- connect outbound to the central brain
- declare their capabilities
- execute scoped local operations
- return results, artifacts, logs, and errors
- do not own long-term memory or global planning
- do not write the canonical graph database directly
- can keep local cache, local session memory, and pending sync queues
- submit events, observations, and memory proposals to the brain API

Some workers may also run a local device agent.

A device agent is not a second central brain. It is a local interface and routing layer that can:

- accept local conversations from the owner on that device
- handle low-risk local-only tasks
- use local worker capabilities
- maintain local session context
- create events and memory proposals
- sync summaries, events, and audit records to the central brain
- escalate global, cross-worker, high-risk, or unclear tasks to the central brain

The central brain remains the authority for canonical memory, global planning, cross-device coordination, permissions, and audit.

Example workers:

- home Mac mini worker
- office computer worker
- VPS worker
- NAS worker
- browser worker
- mobile or lightweight notification worker

The assistant should be able to reason about tasks that require multiple workers. For example:

```text
Owner asks: send file A from home Mac mini and file B from office computer to a recipient.

Brain:
  understand request
  identify required workers
  check file access policy
  check email/send policy
  ask for confirmation if required
  dispatch read tasks to workers
  collect artifacts
  prepare email draft
  require confirmation before sending
  audit all steps

Workers:
  read allowed local files
  return artifacts or secure references
```

Workers should not expose open public ports by default. They should maintain outbound authenticated connections to the central server, such as WebSocket or a polling channel.

Each worker should have:

- worker_id
- display name
- environment type
- location or place context
- device or host metadata
- online/offline status
- capability declarations
- allowed path or resource scopes
- risk policy
- token or credential identity
- last_seen_at

Worker capabilities should be explicit, typed, and policy-controlled. Examples:

- file.read
- file.search
- file.write
- command.run
- browser.open
- screenshot.capture
- app.control
- email.draft
- email.send
- network.fetch

Each capability should define:

- input schema
- output schema
- risk level
- whether it is read-only or mutating
- whether it requires confirmation
- allowed scopes
- audit requirements
- timeout and retry behavior

The graph should represent workers and their environments:

```text
Worker: home-mac-mini --located_at--> Location: home
Worker: office-computer --located_at--> Location: office
Worker: home-mac-mini --can_access--> PathScope: home-documents
Worker: office-computer --can_access--> PathScope: office-projects
Tool: email --requires_confirmation_for--> Action: send
Task --requires_worker--> Worker: home-mac-mini
Task --requires_worker--> Worker: office-computer
```

Distributed execution must be part of the first architectural design, not a future bolt-on.

## Worker Pairing And Connection

Workers should be easy to install and pair from a terminal.

The target experience should be similar to:

```bash
npx @cosmosmesh/sedna-worker pair https://brain.example.com --code 7K4D-M2Q9
```

Or:

```bash
npx @cosmosmesh/sedna-worker pair https://brain.example.com
```

Then the worker shows a pairing code and the owner approves the device in the Web UI.

Pairing flow:

```text
Owner opens Web UI
-> clicks Add Device
-> server generates short-lived pairing code
-> owner runs worker pair command on target device
-> worker generates local keypair
-> worker sends public key, hostname, OS, device metadata, and requested capabilities
-> Web UI shows pending worker request
-> owner approves device
-> owner sets display name, location, allowed capabilities, allowed paths, and risk policy
-> server issues worker identity
-> worker stores local private key and config
-> worker connects outbound to server
```

Pair codes should be short-lived and single-use. Pair codes are only for enrollment and should not become long-lived credentials.

After pairing, worker authentication should use a device identity such as a locally generated keypair and server-issued credential. The server stores the worker public identity and can revoke it.

Local worker files may live under:

```text
~/.sedna-worker/config.json
~/.sedna-worker/identity.key
```

The first worker package should support:

```bash
npx @cosmosmesh/sedna-worker pair <server-url> [--code <pair-code>]
npx @cosmosmesh/sedna-worker run
npx @cosmosmesh/sedna-worker status
npx @cosmosmesh/sedna-worker logout
```

Later it can support background service installation:

```bash
npx @cosmosmesh/sedna-worker install-service
npx @cosmosmesh/sedna-worker uninstall-service
```

On macOS this can install a launchd service. On Linux this can install a systemd service.

Worker connection model:

- Workers use outbound authenticated connections only.
- Worker-to-server interactive communication should use WebSocket.
- Web UI updates can use WebSocket or Server-Sent Events.
- Artifacts should use HTTPS upload/download or another dedicated artifact channel, not large WebSocket payloads.

The initial Brain-visible worker capabilities should be conservative:

- worker.status
- agent.execute

`agent.execute` may run a local Worker Agent that uses internal file tools and shell commands on the worker device. Those local tools are not standalone Brain capabilities; they must stay behind worker credentials, path/runtime policy, sensitive-path blocking, job timeouts, audit records, and owner-visible worker configuration.

Higher-risk capabilities such as browser control, email.send, external publishing, payment/account actions, or production operations require explicit owner enablement and policy configuration.

Worker registration and pairing should produce audit records.

## Worker Configuration After Pairing

After pairing, ongoing worker configuration should primarily happen in the Central Brain Web UI, not through manual edits on each device.

The worker device should only need lightweight local operations:

```bash
npx @cosmosmesh/sedna-worker pair <server-url> [--code <pair-code>]
npx @cosmosmesh/sedna-worker run
npx @cosmosmesh/sedna-worker install-service
```

The Web UI should provide worker management:

- display name
- location or environment
- enabled capabilities
- allowed paths and resource scopes
- forbidden paths and resource scopes
- confirmation policy per capability
- artifact retention policy
- pause, revoke, rotate credential
- recent worker jobs and audit trail

Configuration should be stored centrally. Workers receive an effective policy snapshot from the brain when they connect and when policy changes.

There should be two layers of enforcement:

- Brain-side policy: authoritative evaluation before dispatching jobs
- Worker-side guardrails: local safety checks that prevent path escape, forbidden resource access, dangerous commands, or stale policy use

The worker's local policy snapshot is not the source of truth. It is a safety and offline/runtime guardrail.

The product should support natural-language policy configuration. For example:

```text
Allow home-mac-mini to read Documents and Downloads, but never touch .ssh or any .env file.
```

The brain should convert this into a policy proposal, show the owner the structured result, and apply it only after confirmation.

The UI should expose policy through multiple views:

- Worker Settings: per-device capabilities, paths, status, and credentials
- Policy Center: global rules for sensitive paths, sending data, command execution, and external actions
- Graph View: visual relationships such as worker can_access path_scope or email.send requires_confirmation

## Canonical Graph Ownership

The system should present one complete visible memory graph to the owner, but there must be only one canonical graph authority.

The central brain owns the canonical graph database. All clients and workers interact with graph state through the central brain API.

Allowed access pattern:

```text
Web UI -> Central Brain API -> Canonical Graph DB
Device Agent -> Central Brain API -> Canonical Graph DB
Worker Runtime -> Central Brain API / Worker Channel -> Canonical Graph DB
CLI -> Central Brain API -> Canonical Graph DB
```

Disallowed access pattern:

```text
Worker -> direct database write
Device Agent -> direct database write
Web UI -> direct database write
```

This keeps memory merging, conflict handling, permission checks, and audit in one place.

Workers may produce:

- events
- observations
- local session summaries
- device-local memory candidates
- artifact metadata
- worker job results

Workers submit these to the brain. The brain validates scope, risk, conflicts, visibility, and sync policy before updating the canonical graph.

The central graph can include global and device-scoped knowledge in one visible graph:

```text
User --prefers--> detailed architecture discussion              [global]
User --works_on--> PersonalAgent                                [global/project]
User --uses_storage_location--> Home Archive                    [device: home-mac-mini]
Home Archive --available_on--> Worker: home-mac-mini            [device-scoped]
Office Repo Path --available_on--> Worker: office-computer      [device-scoped]
Article --contains--> Code Optimization Method                  [resource]
```

Every node and edge should carry scope and authority metadata:

- scope_type
- scope_id
- origin_worker_id
- authority
- visibility
- sync_policy

Example:

```json
{
  "node_type": "path_scope",
  "label": "Home Archive",
  "scope_type": "device",
  "scope_id": "home-mac-mini",
  "origin_worker_id": "home-mac-mini",
  "authority": "device-local",
  "visibility": "metadata_only",
  "sync_policy": "sync_metadata_only"
}
```

Device-local and local-only information can still appear in the global graph as metadata or placeholders. Sensitive local content should not be uploaded by default. The graph may show that a resource exists on a worker without storing the resource contents centrally.

If the owner asks to inspect local-only detail, the brain should request it from the relevant worker through policy-controlled worker jobs.

## First-Run Understanding Flow

The system needs an explicit first-run state machine:

```text
not_started -> understanding -> configured -> active
```

When a new instance has no owner profile, it enters the understanding phase automatically.

The understanding phase is not a static questionnaire. It is a product-level onboarding flow with state, artifacts, and completion criteria.

## Free-Form Graph Onboarding

The onboarding should not force the owner to fill a long fixed form.

Users may answer casually, incompletely, minimally, or out of order. The assistant should extract useful structure from free-form conversation and gradually build a graph of understanding.

The flow should be:

```text
owner free-form input
-> extract candidate graph nodes and edges
-> store candidates with evidence and confidence
-> identify missing high-value context
-> ask one targeted follow-up question
-> update graph
-> repeat until a minimum usable profile exists
```

The minimum usable profile should include:

- the owner's primary goal for using the assistant
- at least one current project or focus area
- several preferences, constraints, or success criteria
- the expected role of the assistant in the first phase
- a human-readable understanding summary confirmed by the owner

## What The Assistant Needs To Understand

The system should build an executable user profile rather than a decorative preference list.

Core areas:

- goals: what the owner wants to improve
- work context: projects, repositories, tools, languages, environments, data sources
- decision preferences: when to ask, when to proceed, how conservative to be, explanation depth, testing expectations
- constraints: forbidden directories, forbidden operations, data that must not be uploaded, actions that require confirmation
- success criteria: what counts as done for different task types
- learning context: resources the owner reads, tools the owner uses, concepts the owner values, and methods that should be reused in future tasks

## Graph Memory Rationale

A graph is valuable because understanding the owner is incomplete, uncertain, evolving, and contextual.

The graph should make it easy to:

- add small pieces of understanding from messy conversation
- revise or supersede old memories
- represent conflicts instead of blindly overwriting facts
- scope preferences to projects, tools, or task types
- explain why the assistant believes something
- identify missing context and choose the next best question
- connect resources the owner consumed to useful concepts, methods, task patterns, and future work
- later connect suggested actions and skills to profile knowledge

Graph is not a replacement for text memory. Text stores detail and evidence. Graph stores relationships, constraints, routing, and explainability.

## Resource, Knowledge, And Method Memory

Understanding the owner includes understanding what the owner has read, watched, used, learned, and found valuable.

The system should not store articles and documents as inert blobs. It should decompose useful resources into reusable knowledge and connect that knowledge to future work.

The graph should represent at least four layers:

- Resource layer: articles, documents, videos, papers, books, issues, PRs, code repositories, notes, and conversations
- Knowledge layer: insights, concepts, principles, examples, and claims extracted from resources
- Method and skill layer: reusable methods, checklists, playbooks, and workflows derived from knowledge or successful tasks
- Application layer: projects, goals, tasks, task patterns, suggested actions, and tools where the knowledge can be applied

Example:

```text
Owner --read--> Article
Article --contains--> Insight
Insight --supports--> Principle
Article --describes--> Method
Method --applies_to--> TaskPattern
CurrentTask --matches--> TaskPattern
Assistant --suggests_reference--> Method
Method --supported_by--> Evidence
```

For example, if the owner read an article about code optimization several days ago, and later starts a code optimization task, the assistant should be able to connect:

```text
Article about code optimization
-> insight: optimize only after measuring
-> principle: establish a baseline first
-> method: measure, locate hotspot, refactor in small steps, verify with tests
-> applies_to: code optimization task pattern
-> current task: optimize this module
```

The assistant can then suggest the relevant method and explain where the suggestion came from.

Resource-derived knowledge should still be governed:

```text
resource added or mentioned
-> candidate insights, principles, methods, and examples extracted
-> evidence attached
-> applicability linked to task patterns, projects, tools, or preferences
-> important items reviewed or confirmed
-> promoted to active knowledge or skill
```

Not every resource should become durable knowledge. The system should preserve resource metadata broadly, but only promote valuable insights, methods, principles, and skills into active memory.

Additional node types that should be supported:

- resource
- artifact
- concept
- insight
- principle
- method
- example
- task_pattern
- tool

This resource-to-method path belongs in the first understanding phase because it helps the assistant learn not only who the owner is, but what the owner is learning and how that learning should influence future work.

## Storage Direction

The central brain should own the canonical memory database.

The first version can use SQLite for the central server database, but not as a simple key-value store.

SQLite should model a temporal, evidence-backed canonical memory graph.

The database should live on the central brain server, for example:

```text
server/data/sedna.sqlite
```

Workers and clients should not connect to this database directly. They should use the central brain API.

Initial tables should include:

- profiles
- conversations
- messages
- nodes
- edges
- evidence
- node_evidence
- edge_evidence
- memories
- resources
- artifacts
- concepts
- insights
- principles
- methods
- task_patterns
- projects
- goals
- tasks
- suggested_actions
- skills
- action_capabilities
- workers
- worker_capabilities
- worker_sessions
- worker_jobs
- artifacts
- audit_log
- events
- notifications
- confirmations

Important fields for nodes, edges, and memories:

- type
- label or structured payload
- scope
- confidence
- status
- temporal context
- spatial or environment context
- created_at
- updated_at
- expires_at
- confirmed_by_user
- evidence references

Typical statuses:

- candidate
- active
- rejected
- superseded
- expired

The first version does not need a dedicated graph database, vector database, or external memory SaaS. The schema should leave room for embeddings and future migration to Postgres, pgvector, or a dedicated memory system.

Workers may keep local storage, but only for non-authoritative runtime needs:

- local cache
- recent worker jobs
- local session context
- device-local temporary memory
- pending event queue
- pending memory proposals
- local capability metadata
- offline retry state

Worker local storage is not the canonical memory graph. When connectivity returns, pending events and proposals should be submitted to the brain API for validation and merge.

## Temporal And Spatial Context

A real owner exists in time, place, device, and environment. The graph should preserve this context from the beginning.

Time determines whether a memory is still relevant. Place and environment determine whether a suggestion or action is feasible.

Nodes, edges, evidence, events, and actions should support temporal context:

- created_at
- updated_at
- observed_at
- valid_from
- valid_until
- expires_at
- recurrence_rule

They should also support lightweight spatial or environment context:

- place type, such as home, office, travel, server, online, or unknown
- device or host
- deployment environment
- tool availability
- worker availability
- network or access constraints

The first version does not need GPS-level location. It should support semantic places and environments.

Useful first-version questions enabled by this model:

- What has the owner been focused on recently?
- Which memories have not been confirmed for a long time?
- Which tools are only available on the deployed server?
- Which worker can access the required local file or tool?
- Which tasks are appropriate in the current environment?
- Which resources or methods were learned recently and apply to the current task?

## Memory Governance

The assistant should not silently mutate its long-term understanding.

The preferred lifecycle is:

```text
conversation or task trace
-> candidate memory extraction
-> evidence attachment
-> conflict and duplicate detection
-> user confirmation for important items
-> promotion to active memory
```

Each durable memory should be auditable. The owner should be able to see what the assistant believes, where it came from, and whether it is confirmed.

Candidate memory confirmation should not require the owner to approve every extracted fact one by one.

The system should use a memory policy engine that classifies each candidate by risk, confidence, conflict status, evidence quality, and future behavioral impact.

Recommended memory states:

- observed: weak signal captured from conversation or behavior
- candidate: potentially useful memory that may be used for low-risk personalization
- active: confirmed or high-confidence memory that can influence decisions
- rejected: explicitly rejected by the owner
- superseded: replaced by newer or more scoped memory
- expired: no longer fresh enough to influence decisions
- quarantined: conflicted, risky, or unclear memory that should not be used yet

Recommended risk levels:

- low: music, video, content, UI, and communication preferences
- medium: work preferences, tool preferences, project context, success criteria
- high: constraints, security rules, permissions, identity information, long-term goals, and automation policy

The default policy should be:

- Low-risk memories can be stored automatically as observed or candidate.
- Medium-risk memories can be stored as candidates and reviewed in batches.
- High-risk memories require explicit confirmation before becoming active.
- Conflicting memories enter quarantine until resolved by evidence, scoping, or owner review.
- Old memories should decay, expire, or become stale rather than influencing the assistant forever.

Owner review should happen through low-friction surfaces:

- Memory Inbox: recent candidate memories waiting for review
- Digest Review: daily or weekly summary of what the assistant learned
- Inline Confirmation: confirmation only when an uncertain memory is about to affect an important decision
- Implicit Feedback: accepted, ignored, corrected, or rejected suggestions become evidence

Deletion should also be governed. Logical deletion should preserve tombstones for auditability. Permanent deletion should be available for privacy-sensitive data when explicitly requested by the owner.

## Self-Optimization Model

Self-optimization should be governed and auditable, not black-box self-modification.

Use a three-layer model:

- Profile: learn the owner, preferences, constraints, projects, and success criteria
- Skill: learn reusable workflows and playbooks from successful tasks
- Replay/Eval: validate whether a candidate improvement is safe and useful

The loop should be:

```text
task or conversation trace
-> extract candidate experience
-> classify as profile knowledge, project knowledge, skill, or constraint
-> check conflicts and safety boundaries
-> validate through evidence, replay, or user confirmation
-> write to memory graph or skill registry
```

The assistant should submit improvement proposals rather than directly rewriting its own behavior.

## Human-On-The-Loop Autonomy

The product should follow a human-on-the-loop model rather than a human-in-the-loop model.

The assistant should work continuously by default:

- observing conversations and task traces
- extracting candidate memories
- organizing graph nodes and edges
- merging duplicates
- detecting conflicts
- decaying stale memories
- creating and updating internal tasks and goals
- generating summaries, digests, and next-step suggestions
- connecting resources, methods, task patterns, and current work

The owner should not approve every small operation. The owner should supervise, correct, and authorize only when needed.

Owner intervention should be concentrated around:

- high-risk memories
- unresolved conflicts
- low-confidence memories that will affect important decisions
- external actions
- cross-worker orchestration
- irreversible changes
- security or privacy boundaries
- periodic review of what the assistant has learned or changed

The system should expose an autonomy policy with levels such as:

- observe_only: record weak signals without changing active memory
- suggest: generate suggested actions or changes without applying them
- organize: update internal graph structure, summaries, and low-risk metadata
- auto_promote_low_risk: activate low-risk, high-confidence memories
- require_confirmation: pause before important or risky changes
- execute_with_confirmation: future external execution after explicit approval
- execute_auto: future low-risk external execution after policy allows it

The first version should support the early autonomy levels:

- observe_only
- suggest
- organize
- auto_promote_low_risk
- require_confirmation

It should not support automatic high-risk external execution.

## Action Layer Direction

The first version should include actions, but actions must be scoped by risk and reversibility.

Internal system actions can be performed automatically when low-risk, auditable, and reversible. Examples:

- create or update memory candidates
- promote low-risk memories according to policy
- merge duplicate memories
- quarantine conflicting memories
- create or update projects, goals, and tasks
- add resources and extract insights, principles, methods, and task patterns
- generate daily or weekly digests
- generate plans, summaries, and next-step suggestions
- update graph relationships and domain views
- assign low-risk internal jobs to known workers when policy permits

These actions must write audit records and be visible in the UI.

Some internal actions should be allowed but reviewable:

- creating tasks
- updating task status
- archiving stale goals
- promoting medium-risk memories
- changing task priority
- marking a method as applicable to a task pattern

External actions should be limited in the first version. User-initiated external inspection and worker-local execution may be allowed with clear disclosure and policy controls. Examples:

- reading a URL provided by the owner
- processing an uploaded or selected document
- summarizing a resource
- performing a read-only inspection
- reading an allowed local file through a registered worker
- searching an allowed directory through a registered worker
- editing a text file through a registered worker when the path is allowed and policy permits it
- running a bounded shell command through a registered worker when policy permits it

Write, send, delete, publish, commit, payment, account, production, or irreversible actions require explicit confirmation and may be deferred out of the first implementation.

The system should still model future external actions through structured suggested actions:

```json
{
  "type": "create_task",
  "title": "Draft the personal agent server design",
  "status": "suggested",
  "requires_confirmation": true
}
```

Future action capabilities may include:

- running scripts
- operating repositories
- invoking coding agents
- reading and writing files
- controlling browsers
- integrating calendars, messages, notes, and external tools
- coordinating multiple workers in one task

The system must keep permission boundaries explicit from the beginning.

The key first-version rule is:

```text
understanding-first, with safe internal actions
external inspection and worker-local execution only when owner-initiated or clearly approved
external write/change/send/delete actions require confirmation
distributed worker jobs must be scoped, authenticated, audited, and policy-checked
```

## Agent Runtime Direction

The assistant should be implemented as an agent runtime, not as a single chat completion plus post-processing.

The runtime should follow a bounded ReAct-style loop:

```text
owner message
-> context builder
-> planner model
-> action proposal
-> policy check
-> action/tool execution
-> observation
-> continue or final reply
```

The LLM can propose actions, but it must not directly mutate canonical memory, tasks, graph state, settings, tools, workers, or credentials. All state changes must pass through structured executors, policy checks, events, and audit records.

The first safe internal actions are memory candidate creation, task creation, task status updates, graph linking, event creation, confirmation requests, resource addition, and note summarization.

The React Web UI should expose this as an Agent Workbench. The owner should see agent runs, steps, action proposals, policy decisions, observations, confirmations, and results without exposing hidden chain-of-thought.

## MCP And Skills Direction

Sedna should support common agent ecosystem extensions through MCP and Skills.

The first version should make Sedna an MCP host/client:

- configure MCP servers
- discover tools, resources, and prompts
- register discovered tools in a unified Tool Registry
- expose only policy-approved tools to the Agent Runtime
- execute MCP tools through Tool Executor, not direct model access
- show tool calls, observations, failures, and confirmations in Agent Activity

Skills should be treated as reusable workflows:

```text
instruction + workflow + required tools + safety policy + examples
```

The first version can support built-in and local markdown skills. A marketplace, automatic skill evolution, and exposing Sedna itself as an MCP server can come later.

MCP server outputs, tool descriptions, resources, prompts, and annotations are untrusted input. They cannot override Sedna's policy, privacy rules, confirmation requirements, or canonical memory governance.

## Distributed Execution Safety

Distributed workers increase capability and risk. Safety must be part of the first design.

Rules:

- Workers default to outbound connections only.
- Each worker has a unique credential and can be revoked.
- Capabilities are allowlisted, not inferred.
- File and resource scopes are allowlisted.
- Mutating actions require confirmation unless explicitly allowed by policy.
- Sending data outside the owner's system requires confirmation.
- Artifacts should use secure transfer, expiring references, or encrypted storage.
- All worker jobs must produce audit records.
- The central brain decides, workers execute.
- Workers do not independently expand their permissions.
- The owner can pause or disable any worker.

The first implementation can start with one local Worker Agent, but the architecture should already support multiple workers and cross-worker tasks.

## Conversation, Events, And Notifications

Distributed workers require a first-class event and notification system.

The product should not be a generic chat app. It should provide an agent-native conversation timeline that combines:

- owner messages
- assistant messages
- system events
- worker job updates
- task cards
- confirmation cards
- artifact cards
- memory cards
- action result cards
- notifications that require attention

The internal system should distinguish:

- messages: user-visible conversation entries
- events: internal facts about what happened
- audit_log: durable audit records for important operations
- notifications: user attention items
- confirmations: explicit decisions requested from the owner

Workers should not reply directly to the owner. Workers report events to the central brain. The brain updates state, writes audit records, decides next steps, and turns relevant events into user-facing timeline messages or notifications.

Flow:

```text
Worker
-> event
-> central brain
-> task/job state update
-> audit log
-> assistant-readable summary
-> conversation timeline message
-> notification if attention is required
```

Typical event types:

- task.created
- task.planned
- worker.job.dispatched
- worker.job.started
- worker.job.progress
- worker.job.completed
- worker.job.failed
- artifact.created
- confirmation.requested
- confirmation.approved
- confirmation.rejected
- memory.candidate_created
- memory.promoted
- memory.quarantined
- action.suggested
- action.executed

The owner should not see raw worker logs by default. The brain should summarize worker progress and results into readable timeline entries, while preserving full logs and audit records for inspection.

Example:

```text
Owner: Find invoice PDFs on the home Mac mini.

Assistant: I will search the allowed folders on home-mac-mini. This is read-only, so I can proceed.

System: Job dispatched to home-mac-mini.
System: home-mac-mini is searching Documents and Downloads.
System: Found 3 candidate PDF files.

Assistant: I found 3 likely invoice files. Do you want me to prepare a list or attach them to a draft email?
```

The first version should support an event-driven UI. The web client should receive timeline updates through WebSocket or Server-Sent Events. Workers should connect to the server through an authenticated outbound channel, preferably WebSocket for interactive jobs.

Notifications should be stored as structured records:

- id
- type
- severity
- title
- body
- related_event_id
- related_task_id
- related_worker_job_id
- requires_attention
- status
- created_at
- read_at

Notification types:

- info
- warning
- approval_required
- error
- digest

The conversation timeline should support continuing from any event. The owner should be able to approve, reject, ask follow-up questions, inspect evidence, or open related graph nodes directly from the timeline.

## Local Device Conversations

Workers that include a device agent may expose a local conversation entry point, such as a CLI, tray app, local web view, or desktop app.

This is useful when the owner is physically using a device and wants fast local interaction without every step feeling like a remote request.

Local device conversations should follow a routing policy:

- local_only: low-risk task involving only the current device and allowed resources
- local_with_sync: local task can be handled locally, but events and summaries should sync to the brain
- brain_required: task needs global memory, cross-worker coordination, long-term planning, or canonical graph updates
- confirmation_required: task is risky, mutating, external-facing, or policy-controlled
- blocked: task violates policy or lacks required permissions

Examples:

```text
Find invoice PDFs in Downloads on this Mac.
-> local_with_sync

Summarize this local document.
-> local_with_sync if allowed by policy

Send this file with an office computer file to a client.
-> brain_required and confirmation_required
```

Local conversations should not create an independent long-term assistant personality.

Sync policy:

- Local raw conversation can be configurable: sync_full, sync_summary, metadata_only, or local_only.
- Events and audit for worker actions should sync to the central brain.
- Memory candidates generated locally should be submitted to the brain API.
- Device-local facts can appear in the canonical graph with device scope and visibility metadata.
- Sensitive local content should not be uploaded unless policy and owner approval allow it.

The owner should be able to see local conversations in the central timeline when sync policy allows it. If only summaries are synced, the central timeline should make that clear.

## Privacy Principles

Private owner data must not be committed to the repository.

The repository should contain:

- source code
- schema
- sample configuration
- documentation

The deployed instance should contain:

- owner profile
- conversations
- memory graph
- projects, goals, tasks
- credentials and local settings

Private data should live outside tracked source files, under a dedicated data directory. Secrets belong in environment variables or secret storage, not source code.

Future work should include encrypted backup and restore.

## Interface Direction

The first primary client should be a Web UI served by the personal agent server.

The UI should be chat-first, with supporting panels for:

- current understanding summary
- memory candidates
- confirmed owner profile attributes with open vocabulary keys
- projects, goals, and tasks
- next-step suggestions
- conflicts or uncertain memories requiring review
- agent activity: what the assistant automatically learned, changed, merged, expired, or quarantined
- pending confirmations for high-risk memories or actions
- worker status, capabilities, recent jobs, and pending worker confirmations
- settings for interface language, assistant reply language, provider status, and privacy preferences

Electron can remain optional and should not drive the core architecture.

The product should support English and Simplified Chinese from the first Web UI version. UI language, assistant reply language, and memory evidence language should be treated as separate concepts.

## Memory Graph Visualization

The owner should be able to see the assistant's current understanding as an interactive graph.

This is important for trust. The graph view makes memory visible, editable, and explainable instead of hiding it behind chat responses.

The graph visualization should show the canonical memory graph through domain views rather than dumping every node at once.

Recommended graph views:

- Profile View: goals, preferences, constraints, communication style, success criteria
- Work Context View: projects, repositories, current focus, blockers, recent decisions
- Tool View: commonly used tools, capabilities, permissions, environments, risks
- Learning View: resources, articles, insights, methods, principles, task patterns
- Goal/Task View: goals, tasks, milestones, suggested actions, blockers
- Skill View: reusable workflows, playbooks, validation steps, failure modes
- Time View: recent changes, stale memories, recurring patterns, upcoming review needs
- Environment View: server, devices, places, availability, access constraints
- Worker View: registered workers, capabilities, allowed scopes, online status, recent jobs

The graph UI should support:

- filtering by view, type, status, confidence, source, time, and scope
- showing node and edge evidence
- promoting observed or candidate memories
- rejecting or quarantining memories
- editing labels, scopes, and structured payloads
- resolving conflicts by scoping, superseding, or rejecting memories
- showing why a memory is active and where it came from
- showing which memories influenced a suggestion
- showing which graph changes were made automatically by the assistant
- undoing or reverting recent internal graph changes when possible
- showing which workers can perform an action and why
- showing worker job history and audit trails

The graph should not replace chat. Chat is the main interaction surface. The graph is the inspection, correction, and trust surface.

## Current Architectural Direction

Move toward a server-first structure:

```text
sedna/
  apps/
    brain/
    worker/
    web/
    cli/
  packages/
    protocol/
    memory/
    policy/
    shared/
  docs/
  data/        ignored private local data
```

The current implementation baseline is TypeScript with a pnpm workspace, Fastify for the Brain API, React + Vite for the Web UI, and SQLite-backed local runtime storage.

## Open Questions

- How should Brain policy and worker runtime policy converge so path scopes are enforced consistently on both sides?
- What confirmation model should apply to mutating Worker Agent actions such as file writes and shell commands?
- How much of the onboarding should be LLM-driven versus rule-driven?
- What is the first minimum useful graph schema?
- How should memory review and confirmation appear in the UI?
- What authentication is needed for a single-owner self-hosted server?
- What is the simplest backup and restore mechanism for private data?
