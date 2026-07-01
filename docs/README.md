# Sedna Documentation

This directory contains Sedna's current product and engineering design documents.

## Read First

- [Personal Agent Design Checkpoint](personal-agent-design-checkpoint.md): long-term product and architecture direction.
- [Brain MVP Design](brain-mvp-design.md): first buildable implementation slice.

## MVP Design Slices

- [LLM Integration MVP](llm-integration-mvp.md): provider boundary, conversation flow, prompts, privacy, and failure handling.
- [Dynamic LLM Configuration Design](dynamic-llm-config-design.md): configurable providers, model routes, presets, and secret handling.
- [Agent Runtime MVP Design](agent-runtime-mvp-design.md): graph-native ReAct loop, internal actions, observations, confirmations, and audit.
- [Agent Workbench UI Design](agent-workbench-ui-design.md): React UI surfaces for timeline, agent activity, memory, graph, tasks, and settings.
- [Internationalization MVP](i18n-mvp-design.md): English and Simplified Chinese UI and assistant reply language settings.
- [MCP And Skills MVP Design](mcp-and-skills-mvp-design.md): MCP host/client support, tool registry, skills, policy, and UI configuration.
- [Worker MVP Usage](worker-mvp-usage.md): how to run a local read-only worker, configure allowed paths, create jobs, and inspect results.
- [Worker MVP Usage zh-CN](worker-mvp-usage.zh-CN.md): Simplified Chinese worker usage guide.

## Current Implementation Priority

The practical build order should be:

1. Brain foundation: API, SQLite schema, timeline, memory candidates, graph query.
2. LLM provider boundary and dynamic real-provider configuration.
3. Agent Runtime loop with safe internal tools.
4. React Agent Workbench.
5. Settings for language and dynamic LLM configuration.
6. MCP/Skills registry and conservative tool execution.
7. Worker MVP read-only execution: registration, heartbeat, allowed paths, `file.search`, `file.read`, job events, and audit.
8. Worker pairing and broader distributed execution after the Brain loop is stable.

## Non-Goals For The First MVP

- uncontrolled command execution
- file write automation
- email sending
- browser control
- payment, account, or production operations
- autonomous high-risk external actions
- full multi-worker orchestration
- exposing Sedna as an MCP server
