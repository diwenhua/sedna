# Agent Workbench UI Design

Sedna's Web UI should be an Agent Workbench, not only a chat screen.

The owner should see what the agent is doing, which actions it proposed, which actions it executed, what needs confirmation, and which memories, tasks, or graph relationships changed as a result.

## Primary Surfaces

The React Web UI should contain:

- Chat Timeline
- Agent Activity
- Memory Inbox
- Graph View
- Tasks and Suggested Actions
- Settings

## Layout

Recommended desktop layout:

```text
Sidebar
  Conversations
  Memory
  Graph
  Tasks
  Tools
  Settings

Main
  Chat Timeline
  Message Composer

Inspector
  Agent Activity
  selected memory/task/tool/run detail
```

Mobile can collapse the inspector behind tabs. Desktop is the first priority.

## Chat Timeline

Timeline item types:

- `message.user`
- `message.assistant`
- `agent.run_started`
- `agent.step_completed`
- `agent.action_executed`
- `agent.confirmation_required`
- `memory.candidate_created`
- `task.created`
- `graph.updated`
- `tool.called`
- `tool.completed`
- `agent.run_completed`
- `agent.run_failed`

The timeline should show the owner-facing story. Raw logs stay in detail panels.

## Agent Activity

Agent Activity should show:

- current and historical agent runs
- run status: `running`, `waiting_confirmation`, `completed`, `failed`
- each step in the run
- action proposal
- policy result
- observation
- final result

Each step can expand to show:

- step index
- status
- `thought_summary`
- action type
- action payload
- risk
- confirmation requirement
- policy result
- observation summary
- error, if any

Do not show hidden chain-of-thought.

## Memory Inbox

Memory Inbox should show:

- candidate memory label
- type
- risk
- confidence
- evidence quote
- source message
- source agent run and step
- approve, reject, edit, quarantine

Evidence quotes should preserve the original language.

## Tasks And Suggested Actions

Tasks should show:

- title
- status
- source agent run
- related graph nodes
- accept, dismiss, edit

If a dedicated task database is not complete yet, the MVP can render task events and suggested actions from the timeline.

## Graph View

Graph View should show domain views rather than dumping every node:

- Profile
- Project
- Resource
- Worker
- Skill
- Tool

Node and edge details should show:

- status
- confidence
- evidence
- source run
- source step
- last updated time

## Settings

Settings should include:

- language settings
- dynamic LLM provider configuration
- model routes
- MCP servers
- Tool Registry
- Skills
- privacy notes
- future worker settings

## Data Flow

The UI should support incremental updates.

Preferred:

```text
GET /api/timeline/stream
GET /api/agent/runs/:id/stream
```

Acceptable MVP fallback:

```text
GET /api/timeline
GET /api/agent/runs/:id
```

Polling is acceptable until SSE or WebSocket is stable.

## Internationalization

All user-facing labels, buttons, empty states, status labels, and error messages should use the i18n system.

The Agent Workbench must support English and Simplified Chinese.

## Acceptance Criteria

The UI MVP is done when:

1. sending a message shows a new agent run
2. Agent Activity shows at least one step
3. a step can expand to show action, policy, and observation details
4. memory candidates appear in Memory Inbox
5. task actions appear in timeline or task view
6. confirmation requests can be approved or rejected
7. hidden chain-of-thought is not displayed
8. English and Simplified Chinese labels work for main agent surfaces
