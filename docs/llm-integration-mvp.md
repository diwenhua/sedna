# LLM Integration MVP

This document defines the first LLM integration slice for Sedna Brain MVP.

The MVP must include real conversation capability. A chat UI with mocked replies is not enough to prove Sedna's core value.

## Goal

Sedna should be able to:

- receive an owner message
- build a bounded conversation context
- retrieve relevant active memories
- call an LLM provider
- return an assistant reply
- extract candidate memories from the interaction
- classify memory risk and confidence
- write events, evidence, candidates, and audit records

The first implementation should support both a real provider and a mock provider. Dynamic provider configuration and model routing are defined in:

- [docs/dynamic-llm-config-design.md](dynamic-llm-config-design.md)

## Provider Boundary

All model calls must go through an internal provider interface. The rest of the Brain should not call a vendor SDK directly.

Recommended structure:

```text
apps/brain/src/llm/
  provider.ts
  openai-provider.ts
  mock-provider.ts
  prompts/
    chat.ts
    extract-memory.ts
```

The provider interface should support:

```text
generateAssistantReply(input) -> assistant reply
planAgentStep(input) -> structured agent step
extractMemoryCandidates(input) -> structured candidate memories
```

The exact TypeScript names can change, but the boundary must remain clear.

## Required Providers

The MVP should include:

- `mock`: deterministic local provider for tests, smoke checks, and demos without secrets
- `openai`: real provider for actual conversation

Environment configuration:

```text
LLM_PROVIDER=mock | openai
OPENAI_API_KEY=...
OPENAI_MODEL=...
```

No API key should be committed. `.env.example` may document required variables.

If no provider is configured, the Brain should default to `mock` in development and tests.

## Reply Language

Assistant reply language is a first-class setting.

The LLM context builder should resolve:

```text
assistant_reply_locale = follow_ui | en | zh-CN
ui_locale = en | zh-CN
```

If `assistant_reply_locale` is `follow_ui`, the Brain should use `ui_locale` as the reply language.

The chat prompt must include an explicit language instruction, for example:

```text
Reply to the owner in Simplified Chinese unless the owner explicitly asks for another language.
```

or:

```text
Reply to the owner in English unless the owner explicitly asks for another language.
```

Memory extraction should preserve evidence quotes in their original language. Candidate labels may follow the resolved assistant reply language, but raw evidence should not be translated by default.

The UI language and assistant reply language are defined in:

- [docs/i18n-mvp-design.md](i18n-mvp-design.md)

## Conversation Flow

The core message flow should be:

```text
owner sends message
-> create message record
-> create message.created event
-> load recent conversation messages
-> load relevant active memories
-> build chat prompt
-> call LLM provider for assistant reply
-> save assistant message
-> create assistant message event
-> call memory extraction provider step
-> validate structured candidates
-> classify risk and confidence through policy
-> save memory_candidates and evidence
-> create memory.candidate_created events
-> return assistant reply and timeline updates
```

This can be synchronous for the MVP. Streaming can be added later.

## Context Building

The MVP context should include:

- the latest N messages from the current conversation
- active profile/project/preference/constraint memories relevant to the current message
- a short system instruction describing Sedna's role and safety boundaries

Context should be bounded. Do not pass the entire database or entire conversation history to the model.

First version retrieval can be simple:

- recent messages by timestamp
- active memories filtered by type/status/scope
- optional keyword matching against node labels and memory text

Semantic vector retrieval can be deferred.

## Prompt Responsibilities

The chat prompt should make Sedna:

- answer as a private assistant agent
- use confirmed or active memories when relevant
- avoid pretending to know unknown private context
- ask targeted follow-up questions when missing context matters
- avoid taking external actions unless the system supports and policy allows them
- explain uncertainty when relevant

The extraction prompt should identify candidate memories, not write active memory directly.

Candidate memory examples:

- owner goal
- current project
- work preference
- communication preference
- constraint
- success criterion
- resource or method the owner values
- task or suggested action

## Structured Output

LLM extraction output must be validated before persistence.

Recommended candidate shape:

```json
{
  "type": "preference",
  "label": "Prefers concrete implementation plans before coding",
  "subject": "owner",
  "predicate": "prefers",
  "object": "concrete implementation plans before coding",
  "scope_type": "global",
  "scope_id": null,
  "confidence": 0.78,
  "risk": "medium",
  "evidence_quote": "先输出 implementation plan，确认工程拆分后再开始写代码"
}
```

Invalid structured output should not be persisted. It should create an error event or audit record for debugging.

## Memory Policy Integration

The model may propose risk and confidence, but policy code makes the final decision.

Default policy:

- low risk + high confidence can become candidate or auto-promoted if configured
- medium risk becomes candidate
- high risk requires explicit confirmation before active use
- conflict becomes quarantined

The LLM must not directly decide that a memory is active.

## Privacy Rules

The MVP may send owner-provided conversation content and selected memory context to the configured provider.

The UI or setup flow should make provider use explicit before production use.

Sensitive data handling rules:

- do not send `.env`, credentials, private keys, or raw runtime database files
- do not send local file contents unless the owner explicitly asked and policy permits it
- do not include worker-local sensitive content by default
- log provider metadata, not full secret-bearing request payloads

## Error Handling

If provider calls fail:

- save the owner message
- create an error event
- return a useful assistant error message
- do not create memory candidates from a failed call

If memory extraction fails after the assistant reply succeeds:

- keep the assistant reply
- record extraction failure
- allow the conversation to continue

## Testing

Tests and smoke checks should use `LLM_PROVIDER=mock`.

Minimum checks:

- posting a message creates owner and assistant messages
- mock provider returns deterministic assistant text
- memory extraction creates candidate records
- invalid extraction output is rejected
- missing OpenAI key fails clearly when `LLM_PROVIDER=openai`

## Out Of Scope

The MVP should not include:

- multi-provider routing
- local model hosting
- embeddings or vector retrieval
- streaming token output
- tool calling for external actions
- autonomous worker execution triggered by the model
- self-modifying prompts

Those can be added after the Brain memory loop works.
