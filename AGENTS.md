# AGENTS.md

This repository is being reset as a new open-source project for a single-owner, self-hosted personal assistant agent system.

## Project Direction

The project is **Sedna**: a server-first, privacy-first, distributed personal assistant framework.

The current source of truth is:

- `docs/personal-agent-design-checkpoint.md`

Do not treat the old Electron app or terminal workbench as the product direction. Those prototypes were intentionally removed.

## Core Architecture Assumptions

- Central Brain owns the canonical memory graph database.
- Workers and clients never write the canonical graph database directly.
- Workers submit events, observations, artifacts, job results, and memory proposals through the Brain API.
- Workers are controlled execution nodes, not independent long-term brains.
- Some workers may expose local device conversations, but canonical memory, global planning, cross-worker orchestration, permissions, and audit remain Central Brain responsibilities.
- Web UI is the first expected client. Electron is optional and should not drive architecture.

## Product Principles

- Single-owner self-hosted system, not SaaS.
- Code is reusable; private owner data is not.
- Human-on-the-loop autonomy: the agent should work proactively while the owner supervises high-risk decisions.
- One visible memory graph, scoped internally by authority, origin, visibility, worker, project, resource, time, and risk.
- Distributed worker jobs must be scoped, authenticated, audited, and policy-checked.
- Prefer safe, auditable, reversible internal actions before external execution.

## Privacy Rules

Never commit private owner data, credentials, worker identities, local memory, artifacts, or real runtime databases.

Keep future private data in ignored runtime locations such as:

- `data/`
- `.env`
- `server/data/`
- `worker/.local/`

Use sample files for documentation, for example `.env.example`, not real secrets.

## Documentation Rules

When product direction changes, update `docs/personal-agent-design-checkpoint.md`.

Keep README focused on current project identity and entry points. Do not add implementation instructions for frameworks that have not been chosen.

## Implementation Rules

Implementation has not started yet. Before adding code:

- confirm the MVP scope
- choose the backend and Web UI stack
- define the initial database schema
- define worker pairing and permission policy behavior
- keep all runtime/private data out of the repository

When code is added, prefer clear module boundaries:

```text
server/
  agent/
  memory/
  graph/
  policy/
  workers/
  conversations/
  artifacts/
  audit/
  api/

worker/
  runtime/
  capabilities/
  guardrails/
  sync/

web/
  timeline/
  graph/
  workers/
  policy/
```

## Cleanup Rule

Do not reintroduce the old Electron scaffold, four-terminal agent workbench, SwiftUI prototype, or `node-pty`/`xterm` terminal implementation unless the product direction explicitly changes.
