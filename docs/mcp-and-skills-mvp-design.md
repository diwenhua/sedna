# MCP And Skills MVP Design

Sedna should support common agent ecosystem configuration: MCP servers, tools, resources, prompts, and reusable skills.

The first version should make Sedna an MCP host/client. Exposing Sedna itself as an MCP server can come later.

## Goal

Sedna should be able to:

- configure MCP servers
- discover MCP tools, resources, and prompts
- register them into a unified Tool Registry
- expose safe tools to the Agent Runtime
- execute MCP tools through policy-controlled Tool Executor
- manage built-in and local skills
- show MCP and skill activity in the React Agent Workbench

## Core Abstraction

The Agent Runtime should see one Tool Registry.

Tool sources:

- `internal`
- `mcp`
- `skill`

Unified tool shape:

```json
{
  "id": "string",
  "source": "internal | mcp | skill",
  "source_id": "string",
  "name": "string",
  "title": "string",
  "description": "string",
  "input_schema": {},
  "output_schema": {},
  "risk_level": "low | medium | high",
  "requires_confirmation": true,
  "enabled": true
}
```

The planner only sees tools that are enabled and allowed by policy.

## MCP Scope

First version supports:

- stdio MCP server config
- Streamable HTTP MCP server config
- capability discovery
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `prompts/list`
- `prompts/get`
- connection status
- tool refresh
- basic error handling

Out of scope:

- MCP sampling
- MCP elicitation
- MCP Apps/widgets
- full OAuth flow
- long-running MCP task protocol
- exposing Sedna as an MCP server

## Data Model

Recommended tables:

- `mcp_servers`
- `mcp_tools`
- `mcp_resources`
- `mcp_prompts`
- `skill_definitions`
- `skill_runs`

Recommended fields:

```text
mcp_servers:
  id
  name
  transport
  command
  args_json
  url
  headers_json
  enabled
  trust_level
  status
  last_connected_at
  created_at
  updated_at

mcp_tools:
  id
  server_id
  name
  title
  description
  input_schema_json
  output_schema_json
  risk_level
  enabled
  requires_confirmation
  last_seen_at

skill_definitions:
  id
  name
  description
  source_type
  instruction_markdown
  required_tools_json
  risk_level
  enabled
  created_at
  updated_at
```

## API

Recommended API:

```text
GET    /api/mcp/servers
POST   /api/mcp/servers
PATCH  /api/mcp/servers/:id
DELETE /api/mcp/servers/:id
POST   /api/mcp/servers/:id/test
POST   /api/mcp/servers/:id/refresh
GET    /api/mcp/servers/:id/tools
GET    /api/mcp/servers/:id/resources
GET    /api/mcp/servers/:id/prompts

GET    /api/tools
GET    /api/tools/:id
POST   /api/tools/:id/test
PATCH  /api/tools/:id/policy

GET    /api/skills
POST   /api/skills
PATCH  /api/skills/:id
DELETE /api/skills/:id
POST   /api/skills/:id/test
```

## Skills

A skill is:

```text
instruction + workflow + required tools + safety policy + examples
```

Skill file format:

```markdown
---
name: planning
description: Help Sedna turn owner goals into tasks and next actions.
risk_level: low
required_tools:
  - task.create
  - suggest_action
---

# Instructions

# When To Use

# Workflow

# Verification
```

Built-in skills:

- onboarding
- memory-review
- planning
- resource-learning
- code-review-method

## Security

Default rules:

- MCP servers are untrusted by default
- untrusted tools require confirmation by default
- MCP tool descriptions are not policy
- MCP resources are untrusted input
- secrets and headers are never returned to the frontend in plaintext
- private memory, credentials, `.env`, runtime databases, and worker-local sensitive content are not sent automatically
- tool calls write events and audit records
- failed tool calls become observations, not agent runtime crashes

## Agent Runtime Integration

Flow:

```text
context builder
-> load enabled tools and skills
-> policy filter
-> planner sees available tools
-> planner proposes tool call or skill run
-> Tool Executor validates input
-> policy check
-> confirmation if needed
-> internal/MCP/skill dispatch
-> observation
-> next agent step
```

## React UI

Settings should include:

- MCP Servers
- Tool Registry
- Skills

Agent Activity should show:

- MCP tool call
- skill selected
- skill run started/completed/failed
- tool result
- observation
- confirmation required

## Events

Recommended events:

- `mcp.server.created`
- `mcp.server.updated`
- `mcp.server.connected`
- `mcp.server.failed`
- `mcp.tools.refreshed`
- `mcp.tool.called`
- `mcp.tool.completed`
- `mcp.tool.failed`
- `skill.created`
- `skill.updated`
- `skill.enabled`
- `skill.disabled`
- `skill.run.started`
- `skill.run.completed`
- `skill.run.failed`
- `tool.policy.updated`

## Acceptance Criteria

The MCP and Skills MVP is done when:

1. Settings can add an MCP server config
2. the server can be tested
3. tools can be refreshed into Tool Registry
4. Agent Runtime can see policy-filtered MCP tools
5. Tool Executor executes MCP tools instead of the LLM calling them directly
6. high-risk MCP tools require confirmation
7. built-in skills are visible in Settings
8. Agent Activity shows tool and skill execution
9. secrets are redacted from frontend responses and logs
