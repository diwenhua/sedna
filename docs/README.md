# Sedna Documentation

[English](README.md) | [简体中文](README.zh-CN.md)

This directory contains Sedna's current product, architecture, and operating documentation. Start with the documents below instead of treating every file as an independent specification.

## Source Of Truth

When documents overlap, use this order:

1. [Personal Agent Design Checkpoint](personal-agent-design-checkpoint.md) defines the current product direction and system-wide architectural boundaries.
2. [Brain MVP Design](brain-mvp-design.md) defines the first buildable Central Brain slice.
3. Focused MVP design documents refine one subsystem without overriding the two documents above.
4. Usage guides describe the implemented workflow. If a guide and the code disagree, treat the code as current behavior and update the guide in the same change.

The documents are working checkpoints, not frozen specifications. A product-direction change must update the design checkpoint as well as any affected focused document.

## Document Map

### Product And Core Architecture

| Document | Responsibility |
| --- | --- |
| [Personal Agent Design Checkpoint](personal-agent-design-checkpoint.md) | Product positioning, Central Brain authority, canonical graph ownership, distributed Workers, privacy, safety, and long-term direction. |
| [Brain MVP Design](brain-mvp-design.md) | Buildable MVP scope, repository boundaries, data model, APIs, Web UI, Worker position, and acceptance criteria. |

### Focused MVP Designs

| Document | Responsibility |
| --- | --- |
| [LLM Integration MVP](llm-integration-mvp.md) | Provider boundary, conversation flow, context, prompts, privacy, and failure handling. |
| [Dynamic LLM Configuration](dynamic-llm-config-design.md) | Provider presets, model routes, secret handling, settings, and audit. |
| [Agent Runtime MVP](agent-runtime-mvp-design.md) | Graph-native agent loop, context, internal actions, observations, confirmations, and policy. |
| [Agent Workbench UI](agent-workbench-ui-design.md) | Timeline, agent activity, memory, graph, tasks, settings, and UI data flow. |
| [Internationalization MVP](i18n-mvp-design.md) | English and Simplified Chinese UI, reply-language behavior, storage, and API boundaries. |
| [MCP And Skills MVP](mcp-and-skills-mvp-design.md) | MCP host/client support, tool registry, Skills, policy, runtime integration, and UI. |
| [Messaging Channels MVP](message-channels-mvp.md) | DingTalk and Feishu/Lark adapters, owner pairing, channel policy, deduplication, and audit. |

### Operating Guides

| English | 简体中文 | Covers |
| --- | --- | --- |
| [Worker MVP Usage](worker-mvp-usage.md) | [Worker MVP 使用说明](worker-mvp-usage.zh-CN.md) | Running and pairing a local Worker, path scopes, jobs, results, and troubleshooting. |
| [Messaging Channels MVP](message-channels-mvp.md) | [消息渠道 MVP](message-channels-mvp.zh-CN.md) | Configuring, pairing, and safely operating DingTalk and Feishu/Lark channels. |

The messaging document currently serves as both the focused design boundary and the operator guide. Split it only when those two audiences need materially different content.

## Current Delivery Sequence

The practical order for the MVP is:

1. Brain foundation: API, SQLite schema, conversation timeline, memory candidates, and graph query.
2. LLM provider boundary and dynamic real-provider configuration.
3. Agent Runtime loop with safe internal tools.
4. React Agent Workbench.
5. Language and model-provider settings.
6. MCP/Skills registry and conservative tool execution.
7. Worker execution: pair-code enrollment, credentialed heartbeat, policy sync, scoped jobs, events, and audit.
8. DingTalk and Feishu/Lark channels with owner pairing, deduplication, and audit.
9. Broader distributed execution after the Brain loop and Worker guardrails are stable.

This sequence describes dependency order, not a promise that every earlier item is complete.

## Documentation Maintenance

- Keep the root [English README](../README.md) and [Simplified Chinese README](../README.zh-CN.md) aligned when repository-level positioning changes.
- Keep product direction in the design checkpoint; avoid duplicating long architectural explanations in usage guides.
- Update focused designs and their API/data-model examples in the same change as the related boundary.
- Update both language versions of a bilingual guide together.
- Use repository-relative links and verify them before committing.
- Never add credentials, owner identities, private memory, runtime databases, or real artifacts to documentation examples.
- Mark future work explicitly; do not describe planned behavior as implemented behavior.

## First-MVP Non-Goals

- uncontrolled command execution
- unbounded file-write automation
- email sending
- browser control
- payment, account, or production operations
- autonomous high-risk external actions
- full multi-worker orchestration
- exposing Sedna as an MCP server
