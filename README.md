# Sedna

[English](README.md) | [简体中文](README.zh-CN.md)

Sedna is a single-owner, self-hosted personal assistant agent system.

The project is being rebuilt from a clean direction. The goal is not to create a generic chatbot, SaaS assistant, or Electron desktop wrapper. The goal is to build a reusable open-source framework that each person can deploy as their own private assistant.

## Current Direction

Sedna is designed around:

- a **Central Brain** that owns memory, planning, permissions, orchestration, and audit
- **Distributed Workers** that run on owner-controlled devices and expose scoped local capabilities
- a **canonical memory graph** owned by the Central Brain
- an **agent-native conversation timeline** with events, notifications, confirmations, artifacts, and task updates
- **human-on-the-loop autonomy**, where the agent works proactively while the owner supervises high-risk decisions
- privacy-first self-hosting, where private owner data stays outside the repository

## Product Principles

- **Single owner, not SaaS**: one deployed instance serves one person.
- **Reusable code, private data**: the project can be copied and deployed by others, but each instance has its own private profile, memory, policies, workers, and artifacts.
- **Server first**: the core product is the Central Brain server. Web, CLI, Electron, mobile, and messaging clients are access points.
- **One visible memory graph**: the owner should see a unified graph containing global, device-scoped, project, resource, task, skill, and worker-related knowledge.
- **Central graph authority**: workers and clients never write the canonical graph database directly. They submit events, observations, and memory proposals through the Brain API.
- **Safe distributed execution**: workers are controlled hands, not independent brains. They execute scoped jobs under policy and audit.
- **Understanding first, but not analysis-only**: the first version should learn the owner while also doing safe, auditable internal actions.

## Design Checkpoint

The current product and architecture documents are:

- [docs/README.md](docs/README.md)
- [docs/personal-agent-design-checkpoint.md](docs/personal-agent-design-checkpoint.md)
- [docs/brain-mvp-design.md](docs/brain-mvp-design.md)
- [docs/llm-integration-mvp.md](docs/llm-integration-mvp.md)
- [docs/dynamic-llm-config-design.md](docs/dynamic-llm-config-design.md)
- [docs/agent-runtime-mvp-design.md](docs/agent-runtime-mvp-design.md)
- [docs/agent-workbench-ui-design.md](docs/agent-workbench-ui-design.md)
- [docs/i18n-mvp-design.md](docs/i18n-mvp-design.md)
- [docs/mcp-and-skills-mvp-design.md](docs/mcp-and-skills-mvp-design.md)

These documents are the current source of truth for ongoing design discussion. They are working checkpoints, not final implementation specs.

## Intended Architecture

```text
Central Brain Server
  Agent core
  Canonical memory graph
  Conversation timeline
  Permission policy
  Worker orchestration
  Audit log
  Web API

Distributed Workers
  Device-local capabilities
  Local cache and sync queue
  Worker-side guardrails
  Outbound connection to Central Brain

Web UI
  Chat-first timeline
  Memory graph visualization
  Worker management
  Policy center
  Notifications and confirmations
```

## Repository Status

This repository now contains the first Sedna Brain MVP foundation. The previous Electron prototype and terminal-agent workbench have been removed so the project can continue around the server-first distributed personal agent design.

Current implementation slice:

- TypeScript + pnpm workspace monorepo
- Central Brain API server in `apps/brain`
- React + Vite Web UI in `apps/web`
- mock-only worker package in `apps/worker`
- CLI skeleton in `apps/cli`
- shared protocol, memory, policy, and utility packages under `packages/`
- SQLite-backed canonical memory graph schema and migrations
- conversation timeline, candidate memory review, graph query, worker mock registry, and audit query APIs
- LLM provider boundary with deterministic `mock` mode and real `openai` mode
- Agent Runtime and React Agent Workbench are active MVP design targets
- dynamic LLM configuration, MCP, and Skills are planned MVP settings surfaces

## Development

Install dependencies:

```bash
pnpm install
```

Run tests and build:

```bash
pnpm test
pnpm build
```

Start the Brain API:

```bash
pnpm dev:brain
```

Start the Web UI in another terminal:

```bash
pnpm dev:web
```

LLM configuration:

```bash
cp .env.example .env
```

The default provider is `mock`, which works without secrets and is used for tests and offline development. To use real OpenAI-backed conversation, set:

```text
LLM_PROVIDER=openai
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
```

Never commit `.env` or API keys.

## Privacy And Data

Private data must never be committed to this repository.

Future private runtime data should live outside tracked source files, for example:

```text
data/
.env
server/data/
apps/brain/data/
worker/.local/
apps/worker/.local/
```

The repository should contain code, schema, sample configuration, tests, and documentation only.

## Open Questions

Major design areas still being refined:

- permission policy model
- artifact storage and transfer
- owner authentication and recovery
- worker registration, revocation, and offline behavior
- model/provider routing and sensitive-data handling
- backup, restore, and migration

## Development Notes

See [AGENTS.md](AGENTS.md) before making changes.
