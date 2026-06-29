# Internationalization MVP

This document defines the first language and localization slice for Sedna.

Sedna should support Chinese and English from the beginning. This is not only a UI concern. The owner's preferred language also affects assistant replies, onboarding, memory review, notifications, and future worker-facing messages.

## Goal

The MVP should let the owner switch between:

- English
- Simplified Chinese

The switch should be available in Settings and should take effect without changing the underlying memory graph structure.

## Language Concepts

Sedna should separate three language concepts:

1. UI language
   - controls menus, buttons, navigation, labels, empty states, and settings text
   - examples: `en`, `zh-CN`

2. Assistant reply language
   - controls the default language used by Sedna when replying to the owner
   - can default to the UI language, but should be stored separately

3. Memory content language
   - records the original language of evidence, quotes, and user-provided text
   - should not be automatically rewritten just because the UI language changes

This separation matters because a user may want the interface in English while asking Sedna to reply in Chinese, or may provide evidence in mixed languages.

## Settings MVP

Add a Settings surface in the Web UI with a Language section.

Required controls:

```text
Interface language:
  - English
  - 简体中文

Assistant reply language:
  - Follow interface language
  - English
  - 简体中文
```

The MVP can persist settings in the Brain database. Local browser storage may cache the selected UI language for faster first paint, but the Central Brain settings remain authoritative.

## Storage

Add a simple settings model rather than hard-coding language in the frontend.

Recommended table:

```text
settings:
  key
  value_json
  updated_at
```

Recommended keys:

```text
ui.locale = "en" | "zh-CN"
assistant.reply_locale = "follow_ui" | "en" | "zh-CN"
```

If the implementation already has a profile or owner settings table, these fields may live there instead. The important requirement is that language is stored centrally and can be queried by Brain and Web.

## API

Initial API surface:

```text
GET   /api/settings
PATCH /api/settings
```

The response should include at least:

```json
{
  "ui_locale": "zh-CN",
  "assistant_reply_locale": "follow_ui"
}
```

Changing settings should create an audit record:

```text
settings.updated
```

## Web UI

The Web UI should use translation keys, not hard-coded user-facing strings.

Recommended structure:

```text
apps/web/src/i18n/
  index.ts
  en.ts
  zh-CN.ts
```

The MVP does not need a heavy i18n framework unless it is already useful. A small typed dictionary is enough if the UI is still compact.

Minimum translated areas:

- navigation
- Chat Timeline
- Memory Inbox
- Graph View
- Agent Activity
- Settings
- common actions: approve, reject, edit, save, cancel, retry
- status labels: candidate, active, rejected, quarantined, confidence, risk
- error and empty states

## LLM Prompt Integration

The Brain should include the resolved assistant reply language in chat prompts.

Example prompt instruction:

```text
Reply to the owner in Simplified Chinese unless the owner explicitly asks for another language.
```

or:

```text
Reply to the owner in English unless the owner explicitly asks for another language.
```

Memory extraction should preserve evidence quotes in their original language. The candidate label can follow the assistant reply language, but evidence text should not be translated by default.

## Memory And Evidence

Memory-related records should be able to store language metadata.

Recommended fields where practical:

```text
messages.locale
memory_candidates.locale
evidence.locale
```

If exact detection is not available, use:

```text
unknown
```

Do not make language detection a blocker for the MVP. The first version can infer locale from the current settings and allow mixed-language content.

## Acceptance Criteria

The i18n MVP is done when:

1. the Web UI has a Settings page or panel with language controls
2. the owner can switch the interface between English and Simplified Chinese
3. the selected UI language persists after refresh
4. assistant replies follow the selected assistant reply language
5. Memory Inbox and Graph View labels are translated
6. evidence quotes preserve their original text
7. settings changes produce an audit/event record

## Out Of Scope

The MVP should not include:

- machine-translating stored memory
- multi-user locale preferences
- pluralization-heavy localization infrastructure
- timezone or regional formatting beyond basic timestamps
- right-to-left language support
- automatic translation of evidence or artifacts
