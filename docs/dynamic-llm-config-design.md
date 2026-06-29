# Dynamic LLM Configuration Design

Sedna should not be tied to one hard-coded model provider.

The owner should be able to configure providers and route different agent tasks to different models from Settings.

## Goal

Support dynamic LLM configuration for:

- assistant replies
- agent planning
- memory extraction
- summarization
- classification

## Provider Abstraction

The Brain should call a unified LLM service. Vendor SDK calls should stay behind adapters.

Adapter types:

- `mock`
- `openai-compatible`
- `openai-native`
- `anthropic`
- `gemini`

Most providers should be configurable through `openai-compatible` first. Provider-specific adapters can be added only when necessary.

## Provider Presets

Preset providers should be editable. They are defaults, not hard-coded truth.

Suggested presets:

- OpenAI
- Anthropic Claude
- Google Gemini
- Azure OpenAI
- OpenRouter
- Mistral
- Groq
- xAI
- MiniMax
- Zhipu / Z.ai / GLM
- Volcengine Ark
- Alibaba Cloud Bailian / DashScope
- DeepSeek
- Moonshot / Kimi
- Baidu Qianfan
- Tencent Hunyuan
- SiliconFlow

Each provider config should allow:

- display name
- adapter type
- base URL
- API key or credential reference
- default model
- enabled status
- optional headers

## Model Routes

Model routes decide which model handles which purpose:

- `chat_reply`
- `agent_planning`
- `memory_extraction`
- `summarization`
- `classification`

Each route should include:

- provider config id
- model
- temperature
- max tokens
- enabled status

If a route is missing:

- `agent_planning` falls back to `chat_reply`
- `memory_extraction` falls back to `chat_reply`
- `summarization` falls back to `chat_reply`
- `classification` falls back to `mock` or `chat_reply`, depending on environment

## Data Model

Recommended tables:

- `llm_provider_presets`
- `llm_provider_configs`
- `llm_model_routes`

Important security rule: API keys and secret headers must not be returned to the frontend in plaintext and must not be logged.

For the MVP, storing encrypted secrets can be a follow-up if local single-owner deployment is not ready for a secret store. Even then, secrets must be redacted from API responses and logs.

## API

Recommended API:

```text
GET    /api/llm/provider-presets
GET    /api/llm/providers
POST   /api/llm/providers
PATCH  /api/llm/providers/:id
DELETE /api/llm/providers/:id
POST   /api/llm/providers/:id/test

GET    /api/llm/routes
PATCH  /api/llm/routes/:purpose
```

## Settings UI

Settings should include:

- provider list
- add provider
- edit provider
- enable or disable provider
- test connection
- route configuration by purpose
- model name input
- warning when secrets are missing

## Events And Audit

Recommended events:

- `llm.provider.created`
- `llm.provider.updated`
- `llm.provider.disabled`
- `llm.provider.tested`
- `llm.route.updated`

Provider changes should write audit records because they can affect privacy, cost, and behavior.

## Acceptance Criteria

The dynamic LLM MVP is done when:

1. Settings can add and edit an LLM provider
2. preset providers are available for common domestic and international platforms
3. provider configs can store base URL, adapter type, default model, and secret reference
4. provider test connection works
5. `chat_reply` and `memory_extraction` can use different routes
6. `agent_planning` is supported or falls back predictably
7. mock provider still works without secrets
8. API keys are never returned to the frontend in plaintext
9. provider and route changes produce events or audit records
