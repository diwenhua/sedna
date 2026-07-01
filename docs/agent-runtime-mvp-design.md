# Agent Runtime MVP Design

Sedna should not stop at chat plus memory extraction. The first useful product needs a real agent runtime that can reason about the owner's request, choose safe internal actions, execute them through policy-controlled code, observe results, and update the timeline.

The MVP should implement a graph-native ReAct loop:

```text
owner message
-> agent run
-> context builder
-> planner model
-> action proposal
-> schema validation
-> policy check
-> tool/action executor
-> observation
-> continue or finish
-> timeline, memory, graph, task, and audit updates
```

## Core Rule

The LLM can propose actions. It must not directly mutate the database, memory graph, tasks, settings, workers, tools, or credentials.

All changes go through the Agent Runtime and action executor.

## Agent Run Data

Recommended tables:

- `agent_runs`
- `agent_steps`
- `agent_observations`
- `agent_tool_calls`
- `confirmations`

Recommended fields:

```text
agent_runs:
  id
  conversation_id
  status
  intent
  model_route
  started_at
  ended_at
  error

agent_steps:
  id
  run_id
  step_index
  type
  thought_summary
  action_type
  action_payload_json
  status
  created_at

agent_observations:
  id
  run_id
  step_id
  observation_type
  payload_json
  created_at

agent_tool_calls:
  id
  run_id
  step_id
  tool_name
  input_json
  output_json
  status
  risk
  created_at

confirmations:
  id
  run_id
  action_type
  payload_json
  status
  created_at
  resolved_at
```

## Loop

Each owner message should create an `agent_run`.

The runtime should:

1. save the owner message
2. build bounded context
3. load available tools filtered by policy
4. call the planner model
5. validate the structured step
6. run policy checks
7. execute allowed internal actions
8. write observations
9. decide whether to continue or finish
10. save the assistant reply
11. write timeline events and audit records

Runs must be bounded by `max_steps`, defaulting to 5. A single conversation should process agent runs serially to avoid state conflicts.

## Context Builder

Context should include:

- recent messages
- active memories
- relevant graph nodes and edges
- current projects and tasks
- language settings
- LLM route settings
- available internal tools
- relevant skills
- MCP tools allowed by policy
- privacy and confirmation constraints

Context should be bounded. Do not send the whole database or entire graph to the model.

## Planner Output

The planner should return structured output:

```json
{
  "reply": "string or null",
  "intent": "chat | onboarding | planning | memory_review | task_management | question_answering | tool_use",
  "thought_summary": "audit-safe summary, not hidden chain-of-thought",
  "action": {
    "type": "memory.create_candidate | task.create | task.update_status | graph.link_nodes | event.create | confirmation.request | resource.add | note.summarize | final",
    "payload": {},
    "risk": "low | medium | high",
    "requires_confirmation": false
  }
}
```

The UI may show `thought_summary`. It must not show hidden chain-of-thought.

## Internal Actions

First-version internal tools:

- `memory.create_candidate`
- `task.create`
- `task.update_status`
- `graph.link_nodes`
- `event.create`
- `confirmation.request`
- `resource.add`
- `note.summarize`

First-version blocked external tools:

- `command.run`
- `file.write`
- `email.send`
- browser control
- external publishing
- payment or account operations
- uncontrolled worker execution

## Policy

Default policy:

- low-risk internal actions may auto-execute
- medium-risk actions become suggested actions or confirmation requests
- high-risk actions require explicit confirmation
- external mutating actions are blocked or confirmation-only
- all action attempts produce events
- important changes produce audit records

## Events

Recommended event types:

- `agent.run.started`
- `agent.run.completed`
- `agent.run.failed`
- `agent.step.started`
- `agent.step.completed`
- `agent.action.proposed`
- `agent.action.executed`
- `agent.action.rejected`
- `agent.action.requires_confirmation`
- `agent.observation.created`
- `confirmation.requested`

## Model Route

Add route purpose:

```text
agent_planning
```

If it is not configured, fallback to `chat_reply`.

## Acceptance Criteria

The Agent Runtime MVP is done when:

1. an owner message creates an `agent_run`
2. the run executes at least one plan/action/observation/final loop
3. internal fake provider tests can deterministically create a task from a planning request
4. internal fake provider tests can create a memory candidate from a preference statement
5. actions are executed only through the action executor
6. every run and step is visible through events
7. important actions write audit records
8. `max_steps` prevents infinite loops
9. high-risk actions require confirmation
