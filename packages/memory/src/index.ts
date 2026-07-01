import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { evaluateMemoryCandidate } from "@sedna/policy";
import type {
  AuditRecord,
  Capability,
  Conversation,
  Event,
  EventType,
  GraphNode,
  GraphResponse,
  LlmAdapterType,
  LlmModelRoute,
  LlmProviderConfig,
  LlmProviderPreset,
  LlmRoutePurpose,
  McpPrompt,
  McpResource,
  McpServer,
  McpServerStatus,
  McpTransport,
  McpTrustLevel,
  McpTool,
  MemoryCandidate,
  MemoryStatus,
  Message,
  OwnerProfile,
  ProfileAttribute,
  ProfileAttributeHistory,
  ProfilePatchOperation,
  ProfilePatchProposal,
  ProfileSemanticType,
  RiskLevel,
  Settings,
  SkillDefinition,
  SkillRun,
  SkillSourceType,
  ToolRegistryEntry,
  WebSearchProvider,
  WebToolsSettings,
  Worker,
  WorkerEvent,
  WorkerJob,
  WorkerJobStatus,
  WorkerPathScope
} from "@sedna/protocol";

type JsonRecord = Record<string, unknown>;

const WORKER_OFFLINE_AFTER_MS = 45_000;

export interface WebToolsConfig {
  enabled: boolean;
  searchProvider: WebSearchProvider;
  braveApiKey?: string;
  dashscopeApiKey?: string;
  searxngUrl?: string;
  fetchMaxChars: number;
  fetchTimeoutMs: number;
  searchMaxResults: number;
}

export interface WebToolsSettingsPatch {
  enabled?: boolean;
  searchProvider?: WebSearchProvider;
  searchMaxResults?: number;
  fetchMaxChars?: number;
  fetchTimeoutMs?: number;
  searxngUrl?: string | null;
  braveApiKey?: string;
  dashscopeApiKey?: string;
}

export interface LlmProviderConfigInput {
  presetId?: string;
  displayName: string;
  adapterType: LlmAdapterType;
  baseUrl?: string;
  apiKey?: string;
  defaultModel: string;
  enabled: boolean;
}

export interface LlmProviderConfigPatch {
  presetId?: string;
  displayName?: string;
  adapterType?: LlmAdapterType;
  baseUrl?: string | null;
  apiKey?: string;
  defaultModel?: string;
  enabled?: boolean;
}

export interface LlmProviderConfigSecret extends LlmProviderConfig {
  apiKey?: string;
}

export interface LlmModelRoutePatch {
  providerConfigId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  enabled?: boolean;
}

export interface ExtractedMemory {
  kind: string;
  label: string;
  proposedNodeType: string;
  proposedRelation?: string;
  payload: JsonRecord;
  confidence: number;
  risk: RiskLevel;
  evidenceQuote?: string;
  locale?: string;
}

export interface AddMessageResult {
  ownerMessage: Message;
  assistantMessage: Message;
  candidates: MemoryCandidate[];
}

export interface MockWorkerInput {
  displayName: string;
  environment: string;
  location?: string;
  capabilities: Array<{
    name: string;
    risk: RiskLevel;
    readOnly: boolean;
    requiresConfirmation: boolean;
    allowedScopes?: string[];
  }>;
}

export interface WorkerCapabilityInput {
  name: string;
  risk: RiskLevel;
  readOnly: boolean;
  requiresConfirmation: boolean;
  enabled?: boolean;
  allowedScopes?: string[];
  inputSchema?: JsonRecord;
  outputSchema?: JsonRecord;
}

export interface RegisterWorkerInput {
  displayName: string;
  environment: string;
  hostName?: string;
  os?: string;
  location?: string;
  metadata?: JsonRecord;
  capabilities?: WorkerCapabilityInput[];
  pathScopes?: Array<{
    label: string;
    path: string;
    mode?: "read_only" | "read_write";
    enabled?: boolean;
  }>;
}

export interface WorkerPairCode {
  id: string;
  code?: string;
  status: "pending" | "used" | "expired" | "revoked";
  expiresAt: string;
  createdAt: string;
  usedAt?: string;
}

export interface PairWorkerInput extends RegisterWorkerInput {
  code: string;
}

export interface WorkerPathScopeInput {
  label: string;
  path: string;
  mode?: "read_only" | "read_write";
  enabled?: boolean;
}

export interface WorkerCapabilityPolicyPatch {
  enabled?: boolean;
  risk?: RiskLevel;
  requiresConfirmation?: boolean;
}

export interface WorkerPathScopePatch {
  label?: string;
  path?: string;
  mode?: "read_only" | "read_write";
  enabled?: boolean;
}

export interface WorkerPolicySnapshot {
  capabilities: Capability[];
  pathScopes: WorkerPathScope[];
}

export interface WorkerJobInput {
  workerId: string;
  capability: string;
  input: JsonRecord;
  timeoutMs?: number;
}

export interface McpServerInput {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  trustLevel?: McpTrustLevel;
}

export interface McpServerPatch {
  name?: string;
  transport?: McpTransport;
  command?: string | null;
  args?: string[];
  url?: string | null;
  headers?: Record<string, string>;
  enabled?: boolean;
  trustLevel?: McpTrustLevel;
  status?: McpServerStatus;
}

export interface DiscoveredMcpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonRecord;
  outputSchema?: JsonRecord;
  riskLevel?: RiskLevel;
}

export interface DiscoveredMcpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface DiscoveredMcpPrompt {
  name: string;
  title?: string;
  description?: string;
  argumentsSchema?: JsonRecord;
}

export interface McpDiscoveryResult {
  tools: DiscoveredMcpTool[];
  resources: DiscoveredMcpResource[];
  prompts: DiscoveredMcpPrompt[];
}

export interface SkillDefinitionInput {
  name: string;
  description: string;
  sourceType?: SkillSourceType;
  instructionMarkdown: string;
  requiredTools?: string[];
  riskLevel?: RiskLevel;
  enabled?: boolean;
  storagePath?: string;
}

const DEFAULT_OWNER_NODE_ID = "node_owner";
const DEFAULT_OWNER_PROFILE_ID = "profile_owner";
const LLM_PROVIDER_PRESETS: LlmProviderPreset[] = [
  { id: "openai", displayName: "OpenAI", adapterType: "openai-native", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini", enabledByDefault: false },
  { id: "anthropic", displayName: "Anthropic Claude", adapterType: "anthropic", baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-3-5-sonnet-latest", enabledByDefault: false },
  { id: "gemini", displayName: "Google Gemini", adapterType: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-1.5-flash", enabledByDefault: false },
  { id: "azure-openai", displayName: "Azure OpenAI", adapterType: "openai-compatible", defaultModel: "gpt-4.1-mini", enabledByDefault: false },
  { id: "openrouter", displayName: "OpenRouter", adapterType: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4.1-mini", enabledByDefault: false },
  { id: "mistral", displayName: "Mistral", adapterType: "openai-compatible", baseUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-small-latest", enabledByDefault: false },
  { id: "groq", displayName: "Groq", adapterType: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.1-8b-instant", enabledByDefault: false },
  { id: "xai", displayName: "xAI", adapterType: "openai-compatible", baseUrl: "https://api.x.ai/v1", defaultModel: "grok-2-latest", enabledByDefault: false },
  { id: "minimax", displayName: "MiniMax", adapterType: "openai-compatible", baseUrl: "https://api.minimax.chat/v1", defaultModel: "MiniMax-Text-01", enabledByDefault: false },
  { id: "zhipu", displayName: "Zhipu / Z.ai / GLM", adapterType: "openai-compatible", baseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-flash", enabledByDefault: false },
  { id: "volcengine-ark", displayName: "Volcengine Ark", adapterType: "openai-compatible", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", defaultModel: "doubao-seed-1-6", enabledByDefault: false },
  { id: "dashscope", displayName: "Alibaba Cloud Bailian / DashScope", adapterType: "openai-compatible", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus", enabledByDefault: false },
  { id: "deepseek", displayName: "DeepSeek", adapterType: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", enabledByDefault: false },
  { id: "moonshot", displayName: "Moonshot / Kimi", adapterType: "openai-compatible", baseUrl: "https://api.moonshot.cn/v1", defaultModel: "moonshot-v1-8k", enabledByDefault: false },
  { id: "baidu-qianfan", displayName: "Baidu Qianfan", adapterType: "openai-compatible", baseUrl: "https://qianfan.baidubce.com/v2", defaultModel: "ernie-4.0-turbo-8k", enabledByDefault: false },
  { id: "tencent-hunyuan", displayName: "Tencent Hunyuan", adapterType: "openai-compatible", baseUrl: "https://api.hunyuan.cloud.tencent.com/v1", defaultModel: "hunyuan-lite", enabledByDefault: false },
  { id: "siliconflow", displayName: "SiliconFlow", adapterType: "openai-compatible", baseUrl: "https://api.siliconflow.cn/v1", defaultModel: "Qwen/Qwen2.5-7B-Instruct", enabledByDefault: false }
];

const LLM_ROUTE_PURPOSES: LlmRoutePurpose[] = ["chat_reply", "memory_extraction", "summarization", "classification"];

export class MemoryStore {
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  migrate(): void {
    this.db.exec(MIGRATION_SQL);
    this.addColumnIfMissing("messages", "locale", "TEXT NOT NULL DEFAULT 'unknown'");
    this.addColumnIfMissing("evidence", "locale", "TEXT NOT NULL DEFAULT 'unknown'");
    this.addColumnIfMissing("memory_candidates", "locale", "TEXT NOT NULL DEFAULT 'unknown'");
    this.addColumnIfMissing("workers", "host_name", "TEXT");
    this.addColumnIfMissing("workers", "os", "TEXT");
    this.addColumnIfMissing("workers", "credential_hash", "TEXT");
    this.addColumnIfMissing("worker_capabilities", "enabled", "INTEGER NOT NULL DEFAULT 1");
    this.addColumnIfMissing("worker_capabilities", "updated_at", "TEXT");
    this.addColumnIfMissing("skill_definitions", "storage_path", "TEXT");
    this.db.prepare("UPDATE llm_model_routes SET max_tokens = 16384 WHERE purpose = 'chat_reply' AND max_tokens <= 1200").run();
    this.seedLlmProviderPresets();
    this.removeProductMockLlmProvider();
    this.ensureInternalTools();
    this.removeLegacyBuiltInSkills();
    this.removeLegacyMockMcpServers();
    this.removeLegacyBailianWebSearchMcpServers();
    this.ensureOwnerProfile();
    this.migrateProfileAttributeHistoryForeignKey();
    this.deduplicateMemoryCandidates();
  }

  close(): void {
    this.db.close();
  }

  listTables(): string[] {
    return this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String(row.name));
  }

  listLlmProviderPresets(): LlmProviderPreset[] {
    return this.db
      .prepare("SELECT * FROM llm_provider_presets ORDER BY display_name ASC")
      .all()
      .map(mapLlmProviderPreset);
  }

  listLlmProviderConfigs(): LlmProviderConfig[] {
    return this.db
      .prepare("SELECT * FROM llm_provider_configs ORDER BY created_at ASC")
      .all()
      .map(mapLlmProviderConfig);
  }

  getLlmProviderConfig(id: string): LlmProviderConfig | undefined {
    const row = this.db.prepare("SELECT * FROM llm_provider_configs WHERE id = ?").get(id);
    return row ? mapLlmProviderConfig(row) : undefined;
  }

  getLlmProviderConfigWithSecret(id: string): LlmProviderConfigSecret | undefined {
    const row = this.db.prepare("SELECT * FROM llm_provider_configs WHERE id = ?").get(id);
    return row ? mapLlmProviderConfigWithSecret(row) : undefined;
  }

  createLlmProviderConfig(input: LlmProviderConfigInput): LlmProviderConfig {
    const now = nowIso();
    const configId = createId("provider");
    this.db
      .prepare(
        `INSERT INTO llm_provider_configs
         (id, preset_id, display_name, adapter_type, base_url, api_key_secret, default_model, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        configId,
        input.presetId ?? null,
        input.displayName,
        input.adapterType,
        input.baseUrl ?? null,
        input.apiKey ?? null,
        input.defaultModel,
        input.enabled ? 1 : 0,
        now,
        now
      );
    this.createEvent("llm.provider.created", "LLM provider created", {
      providerConfigId: configId,
      displayName: input.displayName,
      adapterType: input.adapterType
    });
    this.createAuditRecord("owner", "llm.provider.created", "llm_provider_config", configId, {
      displayName: input.displayName,
      adapterType: input.adapterType,
      hasApiKey: Boolean(input.apiKey)
    });
    this.ensureRoutesForFirstProvider(configId, input.defaultModel);
    return this.requireLlmProviderConfig(configId);
  }

  updateLlmProviderConfig(id: string, patch: LlmProviderConfigPatch): LlmProviderConfig {
    const current = this.getLlmProviderConfigWithSecret(id);
    if (!current) {
      throw new Error(`LLM provider config not found: ${id}`);
    }
    const now = nowIso();
    const next = {
      presetId: patch.presetId ?? current.presetId,
      displayName: patch.displayName ?? current.displayName,
      adapterType: patch.adapterType ?? current.adapterType,
      baseUrl: patch.baseUrl === null ? undefined : patch.baseUrl ?? current.baseUrl,
      apiKey: patch.apiKey ?? current.apiKey,
      defaultModel: patch.defaultModel ?? current.defaultModel,
      enabled: patch.enabled ?? current.enabled
    };
    this.db
      .prepare(
        `UPDATE llm_provider_configs
         SET preset_id = ?, display_name = ?, adapter_type = ?, base_url = ?, api_key_secret = ?,
             default_model = ?, enabled = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.presetId ?? null,
        next.displayName,
        next.adapterType,
        next.baseUrl ?? null,
        next.apiKey ?? null,
        next.defaultModel,
        next.enabled ? 1 : 0,
        now,
        id
      );
    const eventType = next.enabled ? "llm.provider.updated" : "llm.provider.disabled";
    this.createEvent(eventType, next.enabled ? "LLM provider updated" : "LLM provider disabled", {
      providerConfigId: id,
      displayName: next.displayName,
      adapterType: next.adapterType
    });
    this.createAuditRecord("owner", eventType, "llm_provider_config", id, {
      displayName: next.displayName,
      adapterType: next.adapterType,
      enabled: next.enabled,
      hasApiKey: Boolean(next.apiKey)
    });
    return this.requireLlmProviderConfig(id);
  }

  disableLlmProviderConfig(id: string): LlmProviderConfig {
    return this.updateLlmProviderConfig(id, { enabled: false });
  }

  listLlmModelRoutes(): LlmModelRoute[] {
    return this.db
      .prepare("SELECT * FROM llm_model_routes ORDER BY purpose ASC")
      .all()
      .map(mapLlmModelRoute);
  }

  getLlmModelRoute(purpose: LlmRoutePurpose): LlmModelRoute | undefined {
    const row = this.db.prepare("SELECT * FROM llm_model_routes WHERE purpose = ?").get(purpose);
    return row ? mapLlmModelRoute(row) : undefined;
  }

  updateLlmModelRoute(purpose: LlmRoutePurpose, patch: LlmModelRoutePatch): LlmModelRoute {
    const current = this.getLlmModelRoute(purpose);
    const providerConfigId = patch.providerConfigId ?? current?.providerConfigId;
    if (!providerConfigId) {
      throw new Error("No LLM provider configured. Configure one in Settings.");
    }
    const provider = this.requireLlmProviderConfig(providerConfigId);
    const providerChanged = Boolean(patch.providerConfigId && patch.providerConfigId !== current?.providerConfigId);
    const next = {
      providerConfigId,
      model: patch.model ?? (providerChanged ? provider.defaultModel : current?.model) ?? provider.defaultModel,
      temperature: patch.temperature ?? current?.temperature ?? 0.2,
      maxTokens: patch.maxTokens ?? current?.maxTokens ?? 16384,
      enabled: patch.enabled ?? current?.enabled ?? true,
      updatedAt: nowIso()
    };
    this.db
      .prepare(
        `INSERT INTO llm_model_routes
         (purpose, provider_config_id, model, temperature, max_tokens, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(purpose) DO UPDATE SET
           provider_config_id = excluded.provider_config_id,
           model = excluded.model,
           temperature = excluded.temperature,
           max_tokens = excluded.max_tokens,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`
      )
      .run(purpose, next.providerConfigId, next.model, next.temperature, next.maxTokens, next.enabled ? 1 : 0, next.updatedAt);
    this.createEvent("llm.route.updated", "LLM route updated", {
      purpose,
      providerConfigId: next.providerConfigId,
      model: next.model,
      enabled: next.enabled
    });
    this.createAuditRecord("owner", "llm.route.updated", "llm_model_route", purpose, {
      providerConfigId: next.providerConfigId,
      model: next.model,
      temperature: next.temperature,
      maxTokens: next.maxTokens,
      enabled: next.enabled
    });
    return this.getLlmModelRoute(purpose) as LlmModelRoute;
  }

  getSettings(): Settings {
    this.ensureDefaultSettings();
    const rows = this.db.prepare("SELECT key, value_json, updated_at FROM settings").all();
    const values = new Map(rows.map((row) => [String(row.key), parseJson<unknown>(row.value_json, null)]));
    const updatedAt = rows
      .map((row) => String(row.updated_at))
      .sort()
      .at(-1) ?? nowIso();
    return {
      uiLocale: values.get("ui.locale") === "zh-CN" ? "zh-CN" : "en",
      assistantReplyLocale: normalizeAssistantReplyLocale(values.get("assistant.reply_locale")),
      updatedAt
    };
  }

  updateSettings(patch: Partial<Pick<Settings, "uiLocale" | "assistantReplyLocale">>): Settings {
    const current = this.getSettings();
    const next: Settings = {
      uiLocale: patch.uiLocale ?? current.uiLocale,
      assistantReplyLocale: patch.assistantReplyLocale ?? current.assistantReplyLocale,
      updatedAt: nowIso()
    };
    this.upsertSetting("ui.locale", next.uiLocale, next.updatedAt);
    this.upsertSetting("assistant.reply_locale", next.assistantReplyLocale, next.updatedAt);
    this.createEvent("settings.updated", "Settings updated", {
      uiLocale: next.uiLocale,
      assistantReplyLocale: next.assistantReplyLocale
    });
    this.createAuditRecord("owner", "settings.updated", "settings", "language", {
      uiLocale: next.uiLocale,
      assistantReplyLocale: next.assistantReplyLocale
    });
    return next;
  }

  getWebToolsSettings(): WebToolsSettings {
    this.ensureDefaultWebToolsSettings();
    const withSecrets = this.getWebToolsSettingsWithSecrets();
    return {
      enabled: withSecrets.enabled,
      searchProvider: withSecrets.searchProvider,
      searchMaxResults: withSecrets.searchMaxResults,
      fetchMaxChars: withSecrets.fetchMaxChars,
      fetchTimeoutMs: withSecrets.fetchTimeoutMs,
      searxngUrl: withSecrets.searxngUrl,
      hasBraveApiKey: Boolean(withSecrets.braveApiKey),
      hasDashscopeApiKey: Boolean(withSecrets.dashscopeApiKey),
      configured: isWebToolsRuntimeConfigured(withSecrets),
      updatedAt: withSecrets.updatedAt
    };
  }

  getWebToolsConfig(): WebToolsConfig {
    const settings = this.getWebToolsSettingsWithSecrets();
    return {
      enabled: settings.enabled,
      searchProvider: settings.searchProvider,
      braveApiKey: settings.braveApiKey,
      dashscopeApiKey: settings.dashscopeApiKey,
      searxngUrl: settings.searxngUrl,
      fetchMaxChars: settings.fetchMaxChars,
      fetchTimeoutMs: settings.fetchTimeoutMs,
      searchMaxResults: settings.searchMaxResults
    };
  }

  updateWebToolsSettings(patch: WebToolsSettingsPatch): WebToolsSettings {
    this.ensureDefaultWebToolsSettings();
    const current = this.getWebToolsSettingsWithSecrets();
    const updatedAt = nowIso();
    const next = {
      enabled: patch.enabled ?? current.enabled,
      searchProvider: patch.searchProvider ?? current.searchProvider,
      searchMaxResults: patch.searchMaxResults ?? current.searchMaxResults,
      fetchMaxChars: patch.fetchMaxChars ?? current.fetchMaxChars,
      fetchTimeoutMs: patch.fetchTimeoutMs ?? current.fetchTimeoutMs,
      searxngUrl: patch.searxngUrl === null ? undefined : patch.searxngUrl ?? current.searxngUrl,
      braveApiKey: patch.braveApiKey && patch.braveApiKey.length > 0 ? patch.braveApiKey : current.braveApiKey,
      dashscopeApiKey: patch.dashscopeApiKey && patch.dashscopeApiKey.length > 0 ? patch.dashscopeApiKey : current.dashscopeApiKey,
      updatedAt
    };
    this.upsertSetting("web.tools.enabled", next.enabled, updatedAt);
    this.upsertSetting("web.search.provider", next.searchProvider, updatedAt);
    this.upsertSetting("web.search.max_results", next.searchMaxResults, updatedAt);
    this.upsertSetting("web.fetch.max_chars", next.fetchMaxChars, updatedAt);
    this.upsertSetting("web.fetch.timeout_ms", next.fetchTimeoutMs, updatedAt);
    this.upsertSetting("web.searxng.url", next.searxngUrl ?? null, updatedAt);
    if (patch.braveApiKey && patch.braveApiKey.length > 0) {
      this.upsertSetting("web.brave.api_key_secret", patch.braveApiKey, updatedAt);
    }
    if (patch.dashscopeApiKey && patch.dashscopeApiKey.length > 0) {
      this.upsertSetting("web.dashscope.api_key_secret", patch.dashscopeApiKey, updatedAt);
    }
    this.createEvent("web.tools.updated", "Web tools settings updated", {
      enabled: next.enabled,
      searchProvider: next.searchProvider,
      configured: isWebToolsRuntimeConfigured(next)
    });
    this.createAuditRecord("owner", "web.tools.updated", "settings", "web_tools", {
      enabled: next.enabled,
      searchProvider: next.searchProvider,
      configured: isWebToolsRuntimeConfigured(next)
    });
    return this.getWebToolsSettings();
  }

  createConversation(title = "New conversation"): Conversation {
    const now = nowIso();
    const conversation: Conversation = {
      id: createId("conv"),
      title,
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        "INSERT INTO conversations (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(conversation.id, conversation.title, conversation.status, conversation.createdAt, conversation.updatedAt);
    this.createEvent("conversation.created", "Conversation created", { conversationId: conversation.id }, {
      relatedConversationId: conversation.id
    });
    this.createAuditRecord("system", "conversation.create", "conversation", conversation.id, {
      title: conversation.title
    });
    return conversation;
  }

  listConversations(): Conversation[] {
    return this.db
      .prepare("SELECT * FROM conversations ORDER BY created_at DESC")
      .all()
      .map(mapConversation);
  }

  getConversation(id: string): (Conversation & { messages: Message[] }) | undefined {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    if (!row) {
      return undefined;
    }
    return {
      ...mapConversation(row),
      messages: this.listMessages(id)
    };
  }

  renameConversation(id: string, title: string): Conversation {
    const current = this.getConversation(id);
    if (!current) {
      throw new Error(`Conversation not found: ${id}`);
    }
    const updatedAt = nowIso();
    this.db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?").run(title, updatedAt, id);
    this.createEvent("conversation.renamed", "Conversation renamed", {
      conversationId: id,
      previousTitle: current.title,
      title
    }, {
      relatedConversationId: id
    });
    this.createAuditRecord("owner", "conversation.rename", "conversation", id, {
      previousTitle: current.title,
      title
    });
    const renamed = this.getConversation(id);
    if (!renamed) {
      throw new Error(`Conversation not found after rename: ${id}`);
    }
    const { messages: _messages, ...conversation } = renamed;
    return conversation;
  }

  deleteConversation(id: string): void {
    const current = this.getConversation(id);
    if (!current) {
      throw new Error(`Conversation not found: ${id}`);
    }
    this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    this.createEvent("conversation.deleted", "Conversation deleted", {
      conversationId: id,
      title: current.title
    }, {
      relatedConversationId: id
    });
    this.createAuditRecord("owner", "conversation.delete", "conversation", id, {
      title: current.title
    });
  }

  listMessages(conversationId: string): Message[] {
    return this.db
      .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC")
      .all(conversationId)
      .map(mapMessage);
  }

  listRecentMessages(conversationId: string, limit = 12): Message[] {
    return this.db
      .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(conversationId, limit)
      .map(mapMessage)
      .reverse();
  }

  listActiveMemoryNodes(query?: string, limit = 12): GraphNode[] {
    const queryText = query?.toLowerCase().trim() ?? "";
    const nodes = this.db
      .prepare("SELECT * FROM nodes WHERE status = ? ORDER BY updated_at DESC LIMIT ?")
      .all("active", Math.max(limit * 8, limit))
      .map(mapGraphNode)
      .filter((node) => node.type !== "owner" && node.type !== "owner_profile");
    if (!queryText) {
      return nodes.slice(0, limit);
    }
    return nodes
      .map((node) => ({ node, score: scoreMemoryNodeForQuery(node, queryText) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        const scoreDelta = right.score - left.score;
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        return right.node.updatedAt.localeCompare(left.node.updatedAt);
      })
      .map((item) => item.node)
      .slice(0, limit);
  }

  private listProfileAttributeNodes(statuses: MemoryStatus[]): GraphNode[] {
    if (statuses.length === 0) {
      return [];
    }
    const graphStatuses = [...new Set(statuses.map((status) => (status === "observed" ? "candidate" : status)))];
    const placeholders = graphStatuses.map(() => "?").join(", ");
    return this.db
      .prepare(`SELECT * FROM nodes WHERE type = 'profile_attribute' AND status IN (${placeholders}) ORDER BY updated_at DESC`)
      .all(...graphStatuses)
      .map(mapGraphNode);
  }

  createMessage(conversationId: string, role: Message["role"], content: string, metadata: JsonRecord = {}): Message {
    return this.insertMessage(conversationId, role, content, metadata);
  }

  recordMessageCreatedEvent(message: Message, title?: string): Event {
    return this.createEvent("message.created", title ?? `${message.role} message created`, { messageId: message.id }, {
      relatedConversationId: message.conversationId,
      relatedMessageId: message.id
    });
  }

  recordAuditRecord(
    actorType: AuditRecord["actorType"],
    action: string,
    targetType: string,
    targetId: string,
    payload: JsonRecord
  ): AuditRecord {
    return this.createAuditRecord(actorType, action, targetType, targetId, payload);
  }

  recordEvent(
    type: EventType,
    title: string,
    payload: JsonRecord,
    refs: Partial<Pick<Event, "relatedConversationId" | "relatedMessageId" | "relatedNodeId" | "relatedWorkerId">> = {}
  ): Event {
    return this.createEvent(type, title, payload, refs);
  }

  recordLlmError(conversationId: string, messageId: string, error: Error, provider: string): void {
    this.createEvent("llm.error", "LLM reply generation failed", {
      provider,
      error: error.message
    }, {
      relatedConversationId: conversationId,
      relatedMessageId: messageId
    });
    this.createAuditRecord("system", "llm.error", "message", messageId, {
      provider,
      error: error.message
    });
  }

  recordMemoryExtractionFailure(conversationId: string, messageId: string, error: Error, provider: string): void {
    this.createEvent("memory.extraction_failed", "Memory extraction failed", {
      provider,
      error: error.message
    }, {
      relatedConversationId: conversationId,
      relatedMessageId: messageId
    });
    this.createAuditRecord("system", "memory.extraction_failed", "message", messageId, {
      provider,
      error: error.message
    });
  }

  addOwnerMessage(conversationId: string, content: string): AddMessageResult {
    const ownerMessage = this.insertMessage(conversationId, "owner", content, {});
    this.createEvent("message.created", "Owner message created", { messageId: ownerMessage.id }, {
      relatedConversationId: conversationId,
      relatedMessageId: ownerMessage.id
    });
    this.createAuditRecord("owner", "message.create", "message", ownerMessage.id, {
      conversationId
    });

    const candidates = this.createMemoryCandidatesFromMessage(ownerMessage);
    const activeMemoryLabels = this.getGraph().nodes
      .filter((node) => node.type !== "owner")
      .map((node) => node.label);
    const reply =
      activeMemoryLabels.length > 0
        ? `I captured that. Active memory now includes: ${activeMemoryLabels.slice(0, 3).join("; ")}.`
        : "I captured that for review in the Memory Inbox.";
    const assistantMessage = this.insertMessage(conversationId, "assistant", reply, {
      generatedFrom: ownerMessage.id
    });
    this.createEvent("message.created", "Assistant message created", { messageId: assistantMessage.id }, {
      relatedConversationId: conversationId,
      relatedMessageId: assistantMessage.id
    });

    return { ownerMessage, assistantMessage, candidates };
  }

  listEvents(): Event[] {
    return this.db
      .prepare("SELECT * FROM events ORDER BY created_at ASC")
      .all()
      .map(mapEvent);
  }

  listTimeline(): Array<Event | Message> {
    const messages = this.db.prepare("SELECT * FROM messages ORDER BY created_at ASC").all().map(mapMessage);
    const events = this.listEvents();
    return [...messages, ...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  listMemoryCandidates(filter: { status?: MemoryStatus } = {}): MemoryCandidate[] {
    const rows = filter.status
      ? this.db
          .prepare("SELECT * FROM memory_candidates WHERE status = ? ORDER BY created_at ASC")
          .all(filter.status)
      : this.db.prepare("SELECT * FROM memory_candidates ORDER BY created_at ASC").all();
    return rows.map(mapMemoryCandidate);
  }

  updateMemoryCandidate(
    id: string,
    patch: Partial<Pick<MemoryCandidate, "label" | "payload" | "confidence" | "risk">>
  ): MemoryCandidate {
    const candidate = this.requireMemoryCandidate(id);
    const next = {
      ...candidate,
      ...patch,
      updatedAt: nowIso()
    };
    this.db
      .prepare(
        `UPDATE memory_candidates
         SET label = ?, payload_json = ?, confidence = ?, risk = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(next.label, stringify(next.payload), next.confidence, next.risk, next.updatedAt, id);
    this.createAuditRecord("owner", "memory.edit", "memory_candidate", id, { patch });
    return this.requireMemoryCandidate(id);
  }

  approveMemoryCandidate(id: string): MemoryCandidate {
    const candidate = this.requireMemoryCandidate(id);
    const updatedAt = nowIso();
    this.db
      .prepare("UPDATE memory_candidates SET status = ?, requires_confirmation = ?, updated_at = ? WHERE id = ?")
      .run("active", 0, updatedAt, id);
    this.promoteCandidateToGraph({ ...candidate, status: "active", updatedAt });
    this.createEvent("memory.promoted", "Memory promoted", { candidateId: id, label: candidate.label });
    this.createAuditRecord("owner", "memory.approve", "memory_candidate", id, {
      label: candidate.label
    });
    return this.requireMemoryCandidate(id);
  }

  rejectMemoryCandidate(id: string): MemoryCandidate {
    const candidate = this.requireMemoryCandidate(id);
    const updatedAt = nowIso();
    this.db.prepare("UPDATE memory_candidates SET status = ?, updated_at = ? WHERE id = ?").run("rejected", updatedAt, id);
    this.createEvent("memory.rejected", "Memory rejected", { candidateId: id, label: candidate.label });
    this.createAuditRecord("owner", "memory.reject", "memory_candidate", id, {
      label: candidate.label
    });
    return this.requireMemoryCandidate(id);
  }

  getOwnerProfile(): OwnerProfile {
    this.ensureOwnerProfile();
    const profileRow = this.db.prepare("SELECT * FROM profiles WHERE id = ?").get(DEFAULT_OWNER_PROFILE_ID);
    if (!profileRow) {
      throw new Error("Owner profile not found");
    }
    const attributes = this.listProfileAttributeNodes(["active", "candidate", "quarantined", "superseded", "expired", "rejected", "observed"])
      .map((node) => ({
        ...profileAttributeFromNode(node),
        history: this.listProfileAttributeHistory(node.id)
      }))
      .sort((left, right) => {
        const typeDelta = left.semanticType.localeCompare(right.semanticType);
        if (typeDelta !== 0) {
          return typeDelta;
        }
        const keyDelta = left.key.localeCompare(right.key);
        if (keyDelta !== 0) {
          return keyDelta;
        }
        return left.createdAt.localeCompare(right.createdAt);
      });
    return {
      id: String(profileRow.id),
      ownerId: String(profileRow.owner_id),
      createdAt: String(profileRow.created_at),
      updatedAt: String(profileRow.updated_at),
      attributes
    };
  }

  applyProfilePatchProposal(proposal: ProfilePatchProposal, message: Message): ProfileAttribute | undefined {
    this.ensureOwnerProfile();
    const now = nowIso();
    const evidenceId = createId("ev");
    this.db
      .prepare(
        "INSERT INTO evidence (id, source_type, source_id, quote, artifact_ref, locale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(evidenceId, "message", message.id, proposal.evidenceQuote, null, message.locale ?? "unknown", now);

    const existing = this.findProfileAttribute(proposal.attributeKey);
    const policy = evaluateMemoryCandidate({
      risk: proposal.risk,
      confidence: proposal.confidence,
      hasConflict: existing ? existing.normalizedValue !== proposal.normalizedValue && proposal.operation !== "replace" : false
    });
    const operation = normalizeProfileOperation(proposal, existing);

    if (operation === "ignore") {
      if (existing) {
        this.createProfileAttributeHistory(existing.id, "ignore", existing.value, proposal.value, evidenceId, proposal.reason);
        this.createEvent("profile.attribute_ignored", "Profile attribute ignored", {
          attributeId: existing.id,
          key: existing.key,
          reason: proposal.reason
        });
        this.createAuditRecord("assistant", "profile.attribute.ignore", "profile_attribute", existing.id, {
          key: existing.key,
          reason: proposal.reason
        });
      }
      return existing;
    }

    if (operation === "conflict") {
      const attribute = existing ?? this.insertProfileAttribute(proposal, evidenceId, "quarantined", true);
      this.createProfileAttributeHistory(attribute.id, "conflict", existing?.value, proposal.value, evidenceId, proposal.reason);
      this.updateProfileAttributeNode(attribute.id, {
        status: "quarantined",
        requiresConfirmation: true,
        updatedAt: now
      });
      this.createEvent("profile.attribute_conflict", "Profile attribute conflict", {
        attributeId: attribute.id,
        key: attribute.key,
        normalizedValue: proposal.normalizedValue
      });
      this.createAuditRecord("assistant", "profile.attribute.conflict", "profile_attribute", attribute.id, {
        key: attribute.key,
        normalizedValue: proposal.normalizedValue
      });
      return this.requireProfileAttribute(attribute.id);
    }

    if (!existing) {
      const status = proposal.operation === "ask_confirmation" ? "candidate" : policy.status;
      const attribute = this.insertProfileAttribute(proposal, evidenceId, status, policy.requiresConfirmation || proposal.operation === "ask_confirmation");
      this.createProfileAttributeHistory(attribute.id, "add", undefined, proposal.value, evidenceId, proposal.reason);
      this.createEvent("profile.attribute_added", "Profile attribute added", {
        attributeId: attribute.id,
        key: attribute.key,
        status: attribute.status,
        risk: attribute.risk
      });
      this.createAuditRecord("assistant", "profile.attribute.add", "profile_attribute", attribute.id, {
        key: attribute.key,
        status: attribute.status,
        risk: attribute.risk
      });
      this.touchOwnerProfile(now);
      return attribute;
    }

    const status = proposal.operation === "ask_confirmation" ? "candidate" : policy.status;
    this.updateProfileAttributeNode(existing.id, {
      semanticType: proposal.semanticType,
      value: proposal.value,
      normalizedValue: proposal.normalizedValue,
      confidence: proposal.confidence,
      risk: proposal.risk,
      status,
      latestEvidenceId: evidenceId,
      requiresConfirmation: policy.requiresConfirmation || proposal.operation === "ask_confirmation",
      updatedAt: now
    });
    this.createProfileAttributeHistory(existing.id, operation, existing.value, proposal.value, evidenceId, proposal.reason);
    this.createEvent("profile.attribute_updated", "Profile attribute updated", {
      attributeId: existing.id,
      key: existing.key,
      operation,
      status
    });
    this.createAuditRecord("assistant", "profile.attribute.update", "profile_attribute", existing.id, {
      key: existing.key,
      operation,
      status
    });
    this.touchOwnerProfile(now);
    return this.requireProfileAttribute(existing.id);
  }

  getGraph(filter: { view?: string } = {}): GraphResponse {
    const view = filter.view?.toLowerCase();
    const nodes = this.db
      .prepare("SELECT * FROM nodes ORDER BY created_at ASC")
      .all()
      .map(mapGraphNode)
      .filter((node) => {
        if (!view) {
          return true;
        }
        if (view === "worker") {
          if (node.status === "rejected") {
            return false;
          }
          if (node.type === "worker") {
            const workerId = node.scopeId ?? node.id.replace(/^node_/, "");
            const worker = this.getWorker(workerId);
            return worker != null && worker.status !== "revoked";
          }
          if (node.type === "capability") {
            const workerId = node.scopeId;
            if (!workerId) {
              return false;
            }
            const worker = this.getWorker(workerId);
            return worker != null && worker.status !== "revoked";
          }
          return false;
        }
        if (view === "profile") {
          return ["owner", "owner_profile", "profile_attribute"].includes(node.type);
        }
        if (view === "project") {
          return node.type === "project";
        }
        if (view === "resource") {
          return node.type === "resource";
        }
        return true;
      });
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = this.db
      .prepare("SELECT * FROM edges ORDER BY created_at ASC")
      .all()
      .map(mapGraphEdge)
      .filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId));
    const evidence = this.db.prepare("SELECT * FROM evidence ORDER BY created_at ASC").all().map(mapEvidence);
    return { nodes, edges, evidence };
  }

  getGraphNode(id: string): GraphNode | undefined {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id);
    return row ? mapGraphNode(row) : undefined;
  }

  registerMockWorker(input: MockWorkerInput): Worker {
    const now = nowIso();
    const worker: Worker = {
      id: createId("worker"),
      displayName: input.displayName,
      environment: input.environment,
      location: input.location,
      status: "mock",
      metadata: {},
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO workers
         (id, display_name, environment, host_name, os, location, status, metadata_json, last_seen_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        worker.id,
        worker.displayName,
        worker.environment,
        null,
        null,
        worker.location ?? null,
        worker.status,
        stringify(worker.metadata),
        worker.lastSeenAt ?? null,
        worker.createdAt,
        worker.updatedAt
      );

    const workerNodeId = `node_${worker.id}`;
    this.insertNode({
      id: workerNodeId,
      type: "worker",
      label: worker.displayName,
      payload: { environment: worker.environment, location: worker.location },
      status: "active",
      confidence: 1,
      scopeType: "worker",
      scopeId: worker.id,
      origin: "mock-worker-registry",
      createdAt: now,
      updatedAt: now
    });

    for (const capability of input.capabilities) {
      const capabilityId = createId("cap");
      this.db
        .prepare(
          `INSERT INTO worker_capabilities
           (id, worker_id, name, risk, read_only, requires_confirmation, allowed_scopes_json, input_schema_json, output_schema_json, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          capabilityId,
          worker.id,
          capability.name,
          capability.risk,
          capability.readOnly ? 1 : 0,
          capability.requiresConfirmation ? 1 : 0,
          stringify(capability.allowedScopes ?? []),
          "{}",
          "{}",
          1,
          now,
          now
        );
      const capabilityNodeId = `node_${capabilityId}`;
      this.insertNode({
        id: capabilityNodeId,
        type: "capability",
        label: capability.name,
        payload: capability,
        status: "active",
        confidence: 1,
        scopeType: "worker",
        scopeId: worker.id,
        origin: "mock-worker-registry",
        createdAt: now,
        updatedAt: now
      });
      this.insertEdge(workerNodeId, "declares_capability", capabilityNodeId, {}, "worker", worker.id, 1);
    }

    this.createEvent("worker.registered", "Mock worker registered", { workerId: worker.id }, {
      relatedWorkerId: worker.id,
      relatedNodeId: workerNodeId
    });
    this.createAuditRecord("system", "worker.register_mock", "worker", worker.id, {
      displayName: worker.displayName
    });
    return worker;
  }

  listWorkers(): Worker[] {
    this.markStaleWorkersOffline();
    return this.db
      .prepare("SELECT * FROM workers ORDER BY created_at ASC")
      .all()
      .map(mapWorker);
  }

  getWorker(id: string): Worker | undefined {
    this.markStaleWorkersOffline();
    const row = this.db.prepare("SELECT * FROM workers WHERE id = ?").get(id);
    return row ? mapWorker(row) : undefined;
  }

  registerWorker(input: RegisterWorkerInput): Worker {
    const now = nowIso();
    const worker: Worker = {
      id: createId("worker"),
      displayName: input.displayName,
      environment: input.environment,
      hostName: input.hostName,
      os: input.os,
      location: input.location,
      status: "online",
      metadata: input.metadata ?? {},
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO workers
         (id, display_name, environment, host_name, os, location, status, metadata_json, last_seen_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        worker.id,
        worker.displayName,
        worker.environment,
        worker.hostName ?? null,
        worker.os ?? null,
        worker.location ?? null,
        worker.status,
        stringify(worker.metadata),
        worker.lastSeenAt ?? null,
        worker.createdAt,
        worker.updatedAt
      );
    this.ensureWorkerGraphNode(worker, "worker-registry");
    for (const capability of input.capabilities ?? []) {
      this.upsertWorkerCapability(worker.id, capability);
    }
    for (const scope of input.pathScopes ?? []) {
      this.createWorkerPathScope(worker.id, scope);
    }
    this.createWorkerEvent(worker.id, undefined, "worker.registered", {
      displayName: worker.displayName,
      environment: worker.environment
    });
    this.createEvent("worker.registered", "Worker registered", { workerId: worker.id, displayName: worker.displayName }, {
      relatedWorkerId: worker.id,
      relatedNodeId: `node_${worker.id}`
    });
    this.createAuditRecord("worker", "worker.register", "worker", worker.id, {
      displayName: worker.displayName,
      capabilities: (input.capabilities ?? []).map((capability) => capability.name)
    });
    return worker;
  }

  createWorkerPairCode(ttlMs = 10 * 60 * 1000): WorkerPairCode {
    const now = nowIso();
    const code = formatPairCode(randomBytes(5).toString("hex").toUpperCase());
    const pairCode: WorkerPairCode = {
      id: createId("worker_pair_code"),
      code,
      status: "pending",
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      createdAt: now
    };
    this.db
      .prepare(
        `INSERT INTO worker_pair_codes (id, code_hash, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(pairCode.id, hashSecret(code), pairCode.status, pairCode.expiresAt, pairCode.createdAt);
    this.createEvent("worker.pair_code.created", "Worker pair code created", { pairCodeId: pairCode.id, expiresAt: pairCode.expiresAt });
    this.createAuditRecord("owner", "worker.pair_code.create", "worker_pair_code", pairCode.id, { expiresAt: pairCode.expiresAt });
    return pairCode;
  }

  listWorkerPairCodes(): WorkerPairCode[] {
    this.expireWorkerPairCodes();
    return this.db
      .prepare("SELECT id, status, expires_at, created_at, used_at FROM worker_pair_codes ORDER BY created_at DESC")
      .all()
      .map(mapWorkerPairCode);
  }

  pairWorker(input: PairWorkerInput): { worker: Worker; credential: string } {
    this.expireWorkerPairCodes();
    const pairCode = this.db
      .prepare("SELECT * FROM worker_pair_codes WHERE code_hash = ? AND status = 'pending'")
      .get(hashSecret(input.code)) as Record<string, unknown> | undefined;
    if (!pairCode) {
      throw new Error("Invalid or expired worker pair code.");
    }
    const now = nowIso();
    const credential = `sedna_worker_${randomBytes(32).toString("base64url")}`;
    const worker = this.registerWorkerWithCredential(input, hashSecret(credential));
    this.db
      .prepare("UPDATE worker_pair_codes SET status = 'used', used_at = ? WHERE id = ?")
      .run(now, String(pairCode.id));
    this.createEvent("worker.paired", "Worker paired", { workerId: worker.id, pairCodeId: pairCode.id }, { relatedWorkerId: worker.id });
    this.createAuditRecord("worker", "worker.pair", "worker", worker.id, { pairCodeId: pairCode.id });
    return { worker, credential };
  }

  authenticateWorker(workerId: string, credential: string | undefined): boolean {
    if (!credential) {
      return false;
    }
    const row = this.db.prepare("SELECT credential_hash, status FROM workers WHERE id = ?").get(workerId) as Record<string, unknown> | undefined;
    if (!row || row.status === "revoked" || typeof row.credential_hash !== "string") {
      return false;
    }
    return safeEqual(String(row.credential_hash), hashSecret(credential));
  }

  revokeWorker(workerId: string): Worker {
    const worker = this.requireWorker(workerId);
    const now = nowIso();
    this.db
      .prepare("UPDATE workers SET status = 'revoked', credential_hash = NULL, updated_at = ? WHERE id = ?")
      .run(now, workerId);
    const revoked = this.requireWorker(workerId);
    this.markWorkerGraphRevoked(workerId, revoked.displayName, revoked);
    this.createWorkerEvent(workerId, undefined, "worker.revoked", { previousStatus: worker.status });
    this.createEvent("worker.revoked", "Worker revoked", { workerId }, { relatedWorkerId: workerId });
    this.createAuditRecord("owner", "worker.revoke", "worker", workerId, { previousStatus: worker.status });
    return revoked;
  }

  heartbeatWorker(workerId: string, metadata: JsonRecord = {}): Worker {
    const worker = this.requireWorker(workerId);
    if (worker.status === "revoked") {
      throw new Error("Worker is revoked");
    }
    const now = nowIso();
    const nextMetadata = { ...worker.metadata, ...metadata };
    this.db
      .prepare("UPDATE workers SET status = ?, metadata_json = ?, last_seen_at = ?, updated_at = ? WHERE id = ?")
      .run("online", stringify(nextMetadata), now, now, workerId);
    this.createWorkerEvent(workerId, undefined, "worker.heartbeat", { metadata });
    this.createEvent("worker.heartbeat", "Worker heartbeat", { workerId }, { relatedWorkerId: workerId });
    if (worker.status !== "online") {
      this.createEvent("worker.online", "Worker online", { workerId }, { relatedWorkerId: workerId });
    }
    return this.requireWorker(workerId);
  }

  updateWorker(id: string, patch: Partial<Pick<Worker, "displayName" | "location" | "status">>): Worker {
    const worker = this.requireWorker(id);
    const now = nowIso();
    this.db
      .prepare("UPDATE workers SET display_name = ?, location = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(patch.displayName ?? worker.displayName, patch.location ?? worker.location ?? null, patch.status ?? worker.status, now, id);
    const updated = this.requireWorker(id);
    this.ensureWorkerGraphNode(updated, "worker-registry");
    this.createAuditRecord("system", "worker.update", "worker", id, patch);
    return updated;
  }

  listWorkerCapabilities(workerId: string): Capability[] {
    this.requireWorker(workerId);
    return this.db
      .prepare("SELECT * FROM worker_capabilities WHERE worker_id = ? ORDER BY name ASC")
      .all(workerId)
      .map(mapWorkerCapability);
  }

  declareWorkerCapability(workerId: string, input: WorkerCapabilityInput): Capability {
    return this.upsertWorkerCapability(workerId, input, { preservePolicy: true });
  }

  upsertWorkerCapability(
    workerId: string,
    input: WorkerCapabilityInput,
    options?: { preservePolicy?: boolean }
  ): Capability {
    this.requireWorker(workerId);
    const now = nowIso();
    const existing = this.db
      .prepare("SELECT * FROM worker_capabilities WHERE worker_id = ? AND name = ?")
      .get(workerId, input.name);
    const id = existing ? String((existing as Record<string, unknown>).id) : createId("cap");
    if (existing) {
      const existingRow = existing as Record<string, unknown>;
      const preservePolicy = options?.preservePolicy === true;
      this.db
        .prepare(
          `UPDATE worker_capabilities
           SET risk = ?, read_only = ?, requires_confirmation = ?, allowed_scopes_json = ?,
               input_schema_json = ?, output_schema_json = ?, enabled = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          preservePolicy ? String(existingRow.risk) : input.risk,
          input.readOnly ? 1 : 0,
          preservePolicy ? Number(existingRow.requires_confirmation) : input.requiresConfirmation ? 1 : 0,
          preservePolicy ? String(existingRow.allowed_scopes_json) : stringify(input.allowedScopes ?? []),
          stringify(input.inputSchema ?? {}),
          stringify(input.outputSchema ?? {}),
          preservePolicy ? Number(existingRow.enabled) : input.enabled ?? true ? 1 : 0,
          now,
          id
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO worker_capabilities
           (id, worker_id, name, risk, read_only, requires_confirmation, allowed_scopes_json,
            input_schema_json, output_schema_json, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          workerId,
          input.name,
          input.risk,
          input.readOnly ? 1 : 0,
          input.requiresConfirmation ? 1 : 0,
          stringify(input.allowedScopes ?? []),
          stringify(input.inputSchema ?? {}),
          stringify(input.outputSchema ?? {}),
          input.enabled ?? true ? 1 : 0,
          now,
          now
        );
    }
    const capability = mapWorkerCapability(this.db.prepare("SELECT * FROM worker_capabilities WHERE id = ?").get(id) as Record<string, unknown>);
    this.createWorkerEvent(workerId, undefined, "worker.capability.updated", { name: input.name, enabled: capability.enabled });
    this.createEvent("worker.capability.updated", "Worker capability updated", { workerId, name: input.name }, { relatedWorkerId: workerId });
    this.createAuditRecord(
      options?.preservePolicy ? "worker" : "owner",
      "worker.capability.updated",
      "worker",
      workerId,
      { workerId, name: input.name, enabled: capability.enabled }
    );
    this.ensureWorkerCapabilityGraphNode(workerId, capability);
    return capability;
  }

  updateWorkerCapabilityPolicy(workerId: string, capabilityId: string, patch: WorkerCapabilityPolicyPatch): Capability {
    const capability = this.requireWorkerCapability(capabilityId);
    if (capability.workerId !== workerId) {
      throw new Error("Capability does not belong to worker.");
    }
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE worker_capabilities
         SET enabled = ?, risk = ?, requires_confirmation = ?, updated_at = ?
         WHERE id = ? AND worker_id = ?`
      )
      .run(
        (patch.enabled ?? capability.enabled) ? 1 : 0,
        patch.risk ?? capability.risk,
        (patch.requiresConfirmation ?? capability.requiresConfirmation) ? 1 : 0,
        now,
        capabilityId,
        workerId
      );
    const updated = this.requireWorkerCapability(capabilityId);
    this.createWorkerEvent(workerId, undefined, "worker.capability.updated", {
      capabilityId,
      name: updated.name,
      enabled: updated.enabled,
      risk: updated.risk,
      requiresConfirmation: updated.requiresConfirmation,
      source: "owner_policy"
    });
    this.createEvent("worker.capability.updated", "Worker capability policy updated", {
      workerId,
      capabilityId,
      name: updated.name
    }, { relatedWorkerId: workerId });
    this.createAuditRecord("owner", "worker.capability.policy_update", "worker", workerId, {
      workerId,
      capabilityId,
      name: updated.name,
      enabled: updated.enabled,
      risk: updated.risk,
      requiresConfirmation: updated.requiresConfirmation
    });
    this.ensureWorkerCapabilityGraphNode(workerId, updated);
    return updated;
  }

  getWorkerPolicy(workerId: string): WorkerPolicySnapshot {
    this.requireWorker(workerId);
    return {
      capabilities: this.listWorkerCapabilities(workerId),
      pathScopes: this.listWorkerPathScopes(workerId)
    };
  }

  listWorkerPathScopes(workerId: string): WorkerPathScope[] {
    this.requireWorker(workerId);
    return this.db
      .prepare("SELECT * FROM worker_path_scopes WHERE worker_id = ? ORDER BY created_at ASC")
      .all(workerId)
      .map(mapWorkerPathScope);
  }

  createWorkerPathScope(workerId: string, input: WorkerPathScopeInput, actor: "owner" | "worker" = "worker"): WorkerPathScope {
    this.requireWorker(workerId);
    const now = nowIso();
    const id = createId("scope");
    this.db
      .prepare(
        `INSERT INTO worker_path_scopes
         (id, worker_id, label, path, mode, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, workerId, input.label, input.path, input.mode ?? "read_only", input.enabled ?? true ? 1 : 0, now, now);
    const scope = this.requireWorkerPathScope(id);
    this.createWorkerEvent(workerId, undefined, "worker.path_scope.updated", { scopeId: scope.id, path: scope.path });
    this.createEvent("worker.path_scope.updated", "Worker path scope updated", { workerId, scopeId: scope.id, path: scope.path }, { relatedWorkerId: workerId });
    this.createAuditRecord(actor, "worker.path_scope.created", "worker", workerId, {
      workerId,
      scopeId: scope.id,
      path: scope.path,
      mode: scope.mode
    });
    return scope;
  }

  updateWorkerPathScope(workerId: string, scopeId: string, patch: WorkerPathScopePatch): WorkerPathScope {
    const scope = this.requireWorkerPathScope(scopeId);
    if (scope.workerId !== workerId) {
      throw new Error("Path scope does not belong to worker.");
    }
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE worker_path_scopes
         SET label = ?, path = ?, mode = ?, enabled = ?, updated_at = ?
         WHERE id = ? AND worker_id = ?`
      )
      .run(
        patch.label ?? scope.label,
        patch.path ?? scope.path,
        patch.mode ?? scope.mode,
        patch.enabled ?? scope.enabled ? 1 : 0,
        now,
        scopeId,
        workerId
      );
    const updated = this.requireWorkerPathScope(scopeId);
    this.createWorkerEvent(workerId, undefined, "worker.path_scope.updated", {
      scopeId: updated.id,
      path: updated.path,
      enabled: updated.enabled
    });
    this.createEvent("worker.path_scope.updated", "Worker path scope updated", {
      workerId,
      scopeId: updated.id,
      path: updated.path
    }, { relatedWorkerId: workerId });
    this.createAuditRecord("owner", "worker.path_scope.update", "worker", workerId, {
      workerId,
      scopeId: updated.id,
      path: updated.path,
      mode: updated.mode,
      enabled: updated.enabled
    });
    return updated;
  }

  deleteWorkerPathScope(workerId: string, scopeId: string): void {
    const scope = this.requireWorkerPathScope(scopeId);
    if (scope.workerId !== workerId) {
      throw new Error("Path scope does not belong to worker.");
    }
    this.db.prepare("DELETE FROM worker_path_scopes WHERE id = ? AND worker_id = ?").run(scopeId, workerId);
    this.createWorkerEvent(workerId, undefined, "worker.path_scope.updated", { scopeId, path: scope.path, deleted: true });
    this.createEvent("worker.path_scope.updated", "Worker path scope deleted", {
      workerId,
      scopeId,
      path: scope.path,
      deleted: true
    }, { relatedWorkerId: workerId });
    this.createAuditRecord("owner", "worker.path_scope.delete", "worker", workerId, {
      workerId,
      scopeId,
      path: scope.path
    });
  }

  createWorkerJob(input: WorkerJobInput): WorkerJob {
    const worker = this.requireWorker(input.workerId);
    if (worker.status === "revoked") {
      throw new Error("Worker is revoked");
    }
    const capability = this.getWorkerCapability(input.workerId, input.capability);
    if (!capability || !capability.enabled) {
      throw new Error(`Worker capability is not enabled: ${input.capability}`);
    }
    if (!capability.readOnly) {
      throw new Error(`Worker capability is not read-only: ${input.capability}`);
    }
    this.validateWorkerJobInput(input.workerId, input.capability, input.input);
    const now = nowIso();
    const job: WorkerJob = {
      id: createId("job"),
      workerId: input.workerId,
      capability: input.capability,
      input: input.input,
      status: "queued",
      timeoutMs: input.timeoutMs ?? 30000,
      createdAt: now
    };
    this.db
      .prepare(
        `INSERT INTO worker_jobs
         (id, worker_id, capability, input_json, status, timeout_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(job.id, job.workerId, job.capability, stringify(job.input), job.status, job.timeoutMs, job.createdAt);
    this.createWorkerEvent(job.workerId, job.id, "worker.job.created", { capability: job.capability });
    this.createEvent("worker.job.created", "Worker job created", {
      workerId: job.workerId,
      jobId: job.id,
      capability: job.capability
    }, { relatedWorkerId: job.workerId });
    this.createAuditRecord("system", "worker.job.create", "worker_job", job.id, {
      workerId: job.workerId,
      capability: job.capability
    });
    return job;
  }

  listWorkerJobs(filter: { workerId?: string; status?: WorkerJobStatus } = {}): WorkerJob[] {
    if (filter.workerId && filter.status) {
      return this.db
        .prepare("SELECT * FROM worker_jobs WHERE worker_id = ? AND status = ? ORDER BY created_at ASC")
        .all(filter.workerId, filter.status)
        .map(mapWorkerJob);
    }
    if (filter.workerId) {
      return this.db
        .prepare("SELECT * FROM worker_jobs WHERE worker_id = ? ORDER BY created_at DESC")
        .all(filter.workerId)
        .map(mapWorkerJob);
    }
    return this.db.prepare("SELECT * FROM worker_jobs ORDER BY created_at DESC").all().map(mapWorkerJob);
  }

  startWorkerJob(workerId: string, jobId: string): WorkerJob {
    const job = this.requireWorkerJob(jobId);
    if (job.workerId !== workerId) {
      throw new Error("Worker job does not belong to worker");
    }
    if (job.status !== "queued") {
      return job;
    }
    const now = nowIso();
    this.db.prepare("UPDATE worker_jobs SET status = ?, started_at = ? WHERE id = ?").run("running", now, jobId);
    this.createWorkerEvent(workerId, jobId, "worker.job.started", { capability: job.capability });
    this.createEvent("worker.job.started", "Worker job started", { workerId, jobId, capability: job.capability }, { relatedWorkerId: workerId });
    this.createAuditRecord("worker", "worker.job.start", "worker_job", jobId, { workerId, capability: job.capability });
    return this.requireWorkerJob(jobId);
  }

  completeWorkerJob(workerId: string, jobId: string, result: JsonRecord): WorkerJob {
    const job = this.requireWorkerJob(jobId);
    if (job.workerId !== workerId) {
      throw new Error("Worker job does not belong to worker");
    }
    const now = nowIso();
    this.db
      .prepare("UPDATE worker_jobs SET status = ?, result_json = ?, completed_at = ? WHERE id = ?")
      .run("completed", stringify(result), now, jobId);
    this.createWorkerEvent(workerId, jobId, "worker.job.completed", { capability: job.capability, result });
    this.createEvent("worker.job.completed", "Worker job completed", { workerId, jobId, capability: job.capability, result }, { relatedWorkerId: workerId });
    this.createAuditRecord("worker", "worker.job.complete", "worker_job", jobId, {
      workerId,
      capability: job.capability,
      resultSize: JSON.stringify(result).length
    });
    return this.requireWorkerJob(jobId);
  }

  failWorkerJob(workerId: string, jobId: string, error: string): WorkerJob {
    const job = this.requireWorkerJob(jobId);
    if (job.workerId !== workerId) {
      throw new Error("Worker job does not belong to worker");
    }
    const now = nowIso();
    this.db
      .prepare("UPDATE worker_jobs SET status = ?, error = ?, completed_at = ? WHERE id = ?")
      .run("failed", error, now, jobId);
    this.createWorkerEvent(workerId, jobId, "worker.job.failed", { capability: job.capability, error });
    this.createEvent("worker.job.failed", "Worker job failed", { workerId, jobId, capability: job.capability, error }, { relatedWorkerId: workerId });
    this.createAuditRecord("worker", "worker.job.fail", "worker_job", jobId, {
      workerId,
      capability: job.capability,
      error
    });
    return this.requireWorkerJob(jobId);
  }

  listAuditRecords(): AuditRecord[] {
    return this.db
      .prepare("SELECT * FROM audit_log ORDER BY created_at ASC")
      .all()
      .map(mapAuditRecord);
  }

  listMcpServers(): McpServer[] {
    return this.db.prepare("SELECT * FROM mcp_servers ORDER BY created_at ASC").all().map(mapMcpServer);
  }

  getMcpServer(id: string): McpServer | undefined {
    const row = this.db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id);
    return row ? mapMcpServer(row) : undefined;
  }

  createMcpServer(input: McpServerInput): McpServer {
    const now = nowIso();
    const server: McpServer = {
      id: createId("mcp_server"),
      name: input.name,
      transport: input.transport,
      command: input.command,
      args: input.args ?? [],
      url: input.url,
      headers: input.headers ?? {},
      enabled: input.enabled,
      trustLevel: input.trustLevel ?? "untrusted",
      status: input.enabled ? "unknown" : "disabled",
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO mcp_servers
         (id, name, transport, command, args_json, url, headers_json, enabled, trust_level, status, last_connected_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        server.id,
        server.name,
        server.transport,
        server.command ?? null,
        stringify(server.args),
        server.url ?? null,
        stringify(server.headers),
        server.enabled ? 1 : 0,
        server.trustLevel,
        server.status,
        server.lastConnectedAt ?? null,
        server.createdAt,
        server.updatedAt
      );
    this.createEvent("mcp.server.created", "MCP server created", {
      serverId: server.id,
      name: server.name,
      transport: server.transport,
      trustLevel: server.trustLevel
    });
    this.createAuditRecord("owner", "mcp.server.created", "mcp_server", server.id, {
      name: server.name,
      transport: server.transport,
      trustLevel: server.trustLevel,
      hasHeaders: Object.keys(server.headers).length > 0
    });
    return server;
  }

  updateMcpServer(id: string, patch: McpServerPatch): McpServer {
    const current = this.requireMcpServer(id);
    const now = nowIso();
    const enabled = patch.enabled ?? current.enabled;
    const next: McpServer = {
      ...current,
      name: patch.name ?? current.name,
      transport: patch.transport ?? current.transport,
      command: patch.command === null ? undefined : patch.command ?? current.command,
      args: patch.args ?? current.args,
      url: patch.url === null ? undefined : patch.url ?? current.url,
      headers: patch.headers ?? current.headers,
      enabled,
      trustLevel: patch.trustLevel ?? current.trustLevel,
      status: patch.status ?? (enabled ? current.status === "disabled" ? "unknown" : current.status : "disabled"),
      updatedAt: now
    };
    this.db
      .prepare(
        `UPDATE mcp_servers
         SET name = ?, transport = ?, command = ?, args_json = ?, url = ?, headers_json = ?,
             enabled = ?, trust_level = ?, status = ?, last_connected_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.name,
        next.transport,
        next.command ?? null,
        stringify(next.args),
        next.url ?? null,
        stringify(next.headers),
        next.enabled ? 1 : 0,
        next.trustLevel,
        next.status,
        next.lastConnectedAt ?? null,
        next.updatedAt,
        id
      );
    this.createEvent("mcp.server.updated", "MCP server updated", {
      serverId: id,
      name: next.name,
      enabled: next.enabled,
      trustLevel: next.trustLevel
    });
    this.createAuditRecord("owner", "mcp.server.updated", "mcp_server", id, {
      name: next.name,
      transport: next.transport,
      enabled: next.enabled,
      trustLevel: next.trustLevel,
      hasHeaders: Object.keys(next.headers).length > 0
    });
    return this.requireMcpServer(id);
  }

  disableMcpServer(id: string): McpServer {
    return this.updateMcpServer(id, { enabled: false, status: "disabled" });
  }

  removeMcpServer(id: string): McpServer {
    const server = this.requireMcpServer(id);
    this.db.prepare("DELETE FROM tool_registry WHERE source = 'mcp' AND source_id IN (SELECT id FROM mcp_tools WHERE server_id = ?)").run(id);
    this.db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
    this.createEvent("mcp.server.removed", "MCP server removed", { serverId: id, name: server.name });
    this.createAuditRecord("owner", "mcp.server.removed", "mcp_server", id, {
      name: server.name,
      transport: server.transport
    });
    return server;
  }

  recordMcpConnection(id: string, ok: boolean, message: string): McpServer {
    const current = this.requireMcpServer(id);
    const now = nowIso();
    const status: McpServerStatus = ok ? "connected" : "failed";
    this.db
      .prepare("UPDATE mcp_servers SET status = ?, last_connected_at = ?, updated_at = ? WHERE id = ?")
      .run(status, ok ? now : current.lastConnectedAt ?? null, now, id);
    this.createEvent(ok ? "mcp.server.connected" : "mcp.server.failed", ok ? "MCP server connected" : "MCP server failed", {
      serverId: id,
      message
    });
    this.createAuditRecord("system", ok ? "mcp.server.connected" : "mcp.server.failed", "mcp_server", id, {
      message
    });
    return this.requireMcpServer(id);
  }

  refreshMcpDiscovery(serverId: string, discovery: McpDiscoveryResult): { tools: McpTool[]; resources: McpResource[]; prompts: McpPrompt[] } {
    const server = this.requireMcpServer(serverId);
    const now = nowIso();
    const tools = discovery.tools.map((tool) => this.upsertMcpTool(server, tool, now));
    const resources = discovery.resources.map((resource) => this.upsertMcpResource(server.id, resource, now));
    const prompts = discovery.prompts.map((prompt) => this.upsertMcpPrompt(server.id, prompt, now));
    this.createEvent("mcp.tools.refreshed", "MCP tools refreshed", {
      serverId,
      tools: tools.length,
      resources: resources.length,
      prompts: prompts.length
    });
    this.createAuditRecord("system", "mcp.tools.refreshed", "mcp_server", serverId, {
      tools: tools.map((tool) => tool.name),
      resources: resources.map((resource) => resource.uri),
      prompts: prompts.map((prompt) => prompt.name)
    });
    return { tools, resources, prompts };
  }

  listMcpTools(serverId?: string): McpTool[] {
    const rows = serverId
      ? this.db.prepare("SELECT * FROM mcp_tools WHERE server_id = ? ORDER BY name ASC").all(serverId)
      : this.db.prepare("SELECT * FROM mcp_tools ORDER BY name ASC").all();
    return rows.map(mapMcpTool);
  }

  listMcpResources(serverId?: string): McpResource[] {
    const rows = serverId
      ? this.db.prepare("SELECT * FROM mcp_resources WHERE server_id = ? ORDER BY uri ASC").all(serverId)
      : this.db.prepare("SELECT * FROM mcp_resources ORDER BY uri ASC").all();
    return rows.map(mapMcpResource);
  }

  listMcpPrompts(serverId?: string): McpPrompt[] {
    const rows = serverId
      ? this.db.prepare("SELECT * FROM mcp_prompts WHERE server_id = ? ORDER BY name ASC").all(serverId)
      : this.db.prepare("SELECT * FROM mcp_prompts ORDER BY name ASC").all();
    return rows.map(mapMcpPrompt);
  }

  listToolRegistryEntries(): ToolRegistryEntry[] {
    const rows = this.db.prepare("SELECT * FROM tool_registry ORDER BY source ASC, name ASC").all();
    return rows.map(mapToolRegistryEntry);
  }

  getToolRegistryEntry(id: string): ToolRegistryEntry | undefined {
    const row = this.db.prepare("SELECT * FROM tool_registry WHERE id = ?").get(id);
    return row ? mapToolRegistryEntry(row) : undefined;
  }

  updateToolPolicy(id: string, patch: Partial<Pick<ToolRegistryEntry, "riskLevel" | "requiresConfirmation" | "enabled">>): ToolRegistryEntry {
    const current = this.requireToolRegistryEntry(id);
    const next = {
      riskLevel: patch.riskLevel ?? current.riskLevel,
      requiresConfirmation: patch.requiresConfirmation ?? current.requiresConfirmation,
      enabled: patch.enabled ?? current.enabled
    };
    this.db
      .prepare("UPDATE tool_registry SET risk_level = ?, requires_confirmation = ?, enabled = ? WHERE id = ?")
      .run(next.riskLevel, next.requiresConfirmation ? 1 : 0, next.enabled ? 1 : 0, id);
    this.createEvent("tool.policy.updated", "Tool policy updated", {
      toolId: id,
      riskLevel: next.riskLevel,
      requiresConfirmation: next.requiresConfirmation,
      enabled: next.enabled
    });
    this.createAuditRecord("owner", "tool.policy.updated", "tool", id, next);
    return this.requireToolRegistryEntry(id);
  }

  markToolUsed(id: string): void {
    this.db.prepare("UPDATE tool_registry SET last_used_at = ? WHERE id = ?").run(nowIso(), id);
  }

  listSkills(): SkillDefinition[] {
    return this.db.prepare("SELECT * FROM skill_definitions ORDER BY source_type ASC, name ASC").all().map(mapSkillDefinition);
  }

  getSkillByName(name: string): SkillDefinition | undefined {
    const row = this.db.prepare("SELECT * FROM skill_definitions WHERE name = ?").get(name);
    return row ? mapSkillDefinition(row) : undefined;
  }

  createSkill(input: SkillDefinitionInput, options?: { imported?: boolean }): SkillDefinition {
    const now = nowIso();
    const skill: SkillDefinition = {
      id: createId("skill"),
      name: input.name,
      description: input.description,
      sourceType: input.sourceType ?? (options?.imported ? "imported" : "local"),
      instructionMarkdown: input.instructionMarkdown,
      requiredTools: input.requiredTools ?? [],
      riskLevel: input.riskLevel ?? "low",
      enabled: input.enabled ?? true,
      storagePath: input.storagePath,
      createdAt: now,
      updatedAt: now
    };
    this.insertSkill(skill);
    this.upsertToolRegistryEntry({
      id: `tool_skill_${skill.id}`,
      source: "skill",
      sourceId: skill.id,
      name: `skill.${skill.name}`,
      title: skill.name,
      description: skill.description,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      riskLevel: skill.riskLevel,
      requiresConfirmation: skill.riskLevel !== "low",
      enabled: skill.enabled
    });
    const eventType = options?.imported ? "skill.imported" : "skill.created";
    const auditAction = options?.imported ? "skill.imported" : "skill.created";
    this.createEvent(eventType, options?.imported ? "Skill imported" : "Skill created", { skillId: skill.id, name: skill.name });
    this.createAuditRecord("owner", auditAction, "skill", skill.id, {
      name: skill.name,
      sourceType: skill.sourceType,
      riskLevel: skill.riskLevel,
      storagePath: skill.storagePath
    });
    return skill;
  }

  upsertImportedSkill(input: SkillDefinitionInput & { storagePath: string }): SkillDefinition {
    const existing = this.getSkillByName(input.name);
    if (!existing) {
      return this.createSkill({
        ...input,
        sourceType: "imported",
        enabled: input.enabled ?? true
      }, { imported: true });
    }

    const now = nowIso();
    const next: SkillDefinition = {
      ...existing,
      description: input.description,
      sourceType: "imported",
      instructionMarkdown: input.instructionMarkdown,
      requiredTools: input.requiredTools ?? [],
      riskLevel: input.riskLevel ?? existing.riskLevel,
      storagePath: input.storagePath,
      updatedAt: now
    };
    this.db
      .prepare(
        `UPDATE skill_definitions
         SET description = ?, source_type = ?, instruction_markdown = ?, required_tools_json = ?, risk_level = ?, storage_path = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.description,
        next.sourceType,
        next.instructionMarkdown,
        stringify(next.requiredTools),
        next.riskLevel,
        next.storagePath ?? null,
        next.updatedAt,
        existing.id
      );
    this.updateToolPolicy(`tool_skill_${existing.id}`, {
      riskLevel: next.riskLevel,
      requiresConfirmation: next.riskLevel !== "low",
      enabled: next.enabled
    });
    this.createEvent("skill.imported", "Skill imported", { skillId: existing.id, name: next.name });
    this.createAuditRecord("owner", "skill.imported", "skill", existing.id, {
      name: next.name,
      sourceType: next.sourceType,
      storagePath: next.storagePath
    });
    return this.requireSkill(existing.id);
  }

  updateSkill(id: string, patch: Partial<Pick<SkillDefinition, "description" | "instructionMarkdown" | "requiredTools" | "riskLevel" | "enabled">>): SkillDefinition {
    const current = this.requireSkill(id);
    const now = nowIso();
    const next = {
      ...current,
      description: patch.description ?? current.description,
      instructionMarkdown: patch.instructionMarkdown ?? current.instructionMarkdown,
      requiredTools: patch.requiredTools ?? current.requiredTools,
      riskLevel: patch.riskLevel ?? current.riskLevel,
      enabled: patch.enabled ?? current.enabled,
      updatedAt: now
    };
    this.db
      .prepare(
        `UPDATE skill_definitions
         SET description = ?, instruction_markdown = ?, required_tools_json = ?, risk_level = ?, enabled = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(next.description, next.instructionMarkdown, stringify(next.requiredTools), next.riskLevel, next.enabled ? 1 : 0, next.updatedAt, id);
    this.updateToolPolicy(`tool_skill_${id}`, {
      riskLevel: next.riskLevel,
      requiresConfirmation: next.riskLevel !== "low",
      enabled: next.enabled
    });
    const eventType = next.enabled ? "skill.enabled" : "skill.disabled";
    this.createEvent(eventType, next.enabled ? "Skill enabled" : "Skill disabled", { skillId: id, name: next.name });
    this.createAuditRecord("owner", "skill.updated", "skill", id, {
      enabled: next.enabled,
      riskLevel: next.riskLevel
    });
    return this.requireSkill(id);
  }

  deleteSkill(id: string): SkillDefinition {
    const skill = this.requireSkill(id);
    this.db.prepare("DELETE FROM skill_runs WHERE skill_id = ?").run(id);
    this.db.prepare("DELETE FROM tool_registry WHERE source = 'skill' AND source_id = ?").run(id);
    this.db.prepare("DELETE FROM skill_definitions WHERE id = ?").run(id);
    this.createEvent("skill.removed", "Skill removed", { skillId: id, name: skill.name });
    this.createAuditRecord("owner", "skill.removed", "skill", id, {
      name: skill.name,
      sourceType: skill.sourceType,
      storagePath: skill.storagePath
    });
    return skill;
  }

  createSkillRun(skillId: string, input: JsonRecord, output: JsonRecord, agentRunId?: string): SkillRun {
    const skill = this.requireSkill(skillId);
    const now = nowIso();
    const run: SkillRun = {
      id: createId("skill_run"),
      skillId,
      agentRunId,
      status: "completed",
      input,
      output,
      createdAt: now,
      completedAt: now
    };
    this.createEvent("skill.run.started", "Skill run started", { skillId, skillName: skill.name, runId: run.id });
    this.db
      .prepare(
        `INSERT INTO skill_runs
         (id, skill_id, agent_run_id, status, input_json, output_json, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(run.id, run.skillId, run.agentRunId ?? null, run.status, stringify(run.input), stringify(run.output), run.createdAt, run.completedAt ?? null);
    this.createEvent("skill.run.completed", "Skill run completed", { skillId, skillName: skill.name, runId: run.id });
    this.createAuditRecord("assistant", "skill.run.completed", "skill", skillId, {
      runId: run.id,
      inputSummary: Object.keys(input),
      outputSummary: Object.keys(output)
    });
    this.markToolUsed(`tool_skill_${skillId}`);
    return run;
  }

  private insertMessage(conversationId: string, role: Message["role"], content: string, metadata: JsonRecord): Message {
    const now = nowIso();
    const message: Message = {
      id: createId("msg"),
      conversationId,
      role,
      content,
      metadata,
      locale: typeof metadata.locale === "string" ? metadata.locale : undefined,
      createdAt: now
    };
    this.db
      .prepare(
        "INSERT INTO messages (id, conversation_id, role, content, metadata_json, locale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(message.id, conversationId, role, content, stringify(metadata), message.locale ?? "unknown", now);
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
    return message;
  }

  private extractDeterministicMemories(content: string): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];

    const preferenceMatch = content.match(/\bprefer(?:s|red|ring)?\s+([^.!?]+)/i);
    if (preferenceMatch?.[1]) {
      const value = cleanPhrase(preferenceMatch[1]);
      memories.push({
        kind: "preference",
        label: `Prefers ${value}`,
        proposedNodeType: "preference",
        payload: { value },
        confidence: 0.91,
        risk: "low"
      });
    }

    const projectMatch = content.match(/\bproject\s+(?:is|called|named)\s+([^.!?]+)/i);
    if (projectMatch?.[1]) {
      const value = cleanPhrase(projectMatch[1]);
      memories.push({
        kind: "project_context",
        label: value,
        proposedNodeType: "project",
        payload: { value },
        confidence: 0.78,
        risk: "medium"
      });
    }

    const neverMatch = content.match(/\bnever\s+([^.!?]+)/i);
    if (neverMatch?.[1]) {
      const value = `Never ${cleanPhrase(neverMatch[1])}`;
      memories.push({
        kind: "constraint",
        label: value,
        proposedNodeType: "constraint",
        payload: { value },
        confidence: 0.88,
        risk: "high"
      });
    }

    return memories;
  }

  createMemoryCandidate(memory: ExtractedMemory, message: Message): MemoryCandidate {
    const now = nowIso();
    const evidenceId = createId("ev");
    this.db
      .prepare(
        "INSERT INTO evidence (id, source_type, source_id, quote, artifact_ref, locale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(evidenceId, "message", message.id, memory.evidenceQuote ?? message.content, null, memory.locale ?? "unknown", now);
    const policy = evaluateMemoryCandidate({
      risk: memory.risk,
      confidence: memory.confidence,
      hasConflict: false
    });
    const candidate: MemoryCandidate = {
      id: createId("mem"),
      status: policy.status,
      kind: memory.kind,
      label: memory.label,
      proposedNodeType: memory.proposedNodeType,
      proposedRelation: memory.proposedRelation,
      payload: memory.payload,
      confidence: memory.confidence,
      risk: memory.risk,
      sourceMessageId: message.id,
      evidenceIds: [evidenceId],
      locale: memory.locale,
      requiresConfirmation: policy.requiresConfirmation,
      decisionReason: policy.reason,
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO memory_candidates
         (id, status, kind, label, proposed_node_type, proposed_relation, payload_json, confidence, risk,
          source_message_id, evidence_ids_json, locale, requires_confirmation, decision_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        candidate.id,
        candidate.status,
        candidate.kind,
        candidate.label,
        candidate.proposedNodeType,
        candidate.proposedRelation ?? null,
        stringify(candidate.payload),
        candidate.confidence,
        candidate.risk,
        candidate.sourceMessageId ?? null,
        stringify(candidate.evidenceIds),
        candidate.locale ?? "unknown",
        candidate.requiresConfirmation ? 1 : 0,
        candidate.decisionReason ?? null,
        candidate.createdAt,
        candidate.updatedAt
      );
    this.createEvent("memory.candidate_created", "Memory candidate created", {
      candidateId: candidate.id,
      label: candidate.label,
      risk: candidate.risk,
      status: candidate.status
    }, {
      relatedMessageId: message.id
    });
    this.createAuditRecord("assistant", "memory.candidate_create", "memory_candidate", candidate.id, {
      label: candidate.label,
      risk: candidate.risk
    });

    if (policy.decision === "auto_promote") {
      this.promoteCandidateToGraph(candidate);
      this.createEvent("memory.promoted", "Memory promoted", {
        candidateId: candidate.id,
        label: candidate.label
      });
      this.createAuditRecord("assistant", "memory.promote", "memory_candidate", candidate.id, {
        label: candidate.label,
        automatic: true
      });
    } else if (policy.decision === "quarantine") {
      this.createEvent("memory.quarantined", "Memory quarantined", {
        candidateId: candidate.id,
        label: candidate.label
      });
    }

    return candidate;
  }

  createMemoryCandidatesFromMessage(message: Message, extractedMemories: ExtractedMemory[] = []): MemoryCandidate[] {
    const memories = mergeExtractedMemories([
      ...extractedMemories,
      ...this.extractDeterministicMemories(message.content).map((memory) => ({
        ...memory,
        locale: memory.locale ?? message.locale
      }))
    ]);
    const candidates: MemoryCandidate[] = [];
    for (const memory of memories) {
      if (!this.hasEquivalentMemoryCandidate(memory)) {
        candidates.push(this.createMemoryCandidate(memory, message));
      }
    }
    return candidates;
  }

  private promoteCandidateToGraph(candidate: MemoryCandidate): void {
    this.ensureOwnerNode();
    const now = nowIso();
    const nodeId = `node_${candidate.id}`;
    if (this.getGraphNode(nodeId)) {
      return;
    }
    this.insertNode({
      id: nodeId,
      type: candidate.proposedNodeType,
      label: candidate.label,
      payload: candidate.payload,
      status: "active",
      confidence: candidate.confidence,
      scopeType: "profile",
      origin: "memory-candidate",
      createdAt: now,
      updatedAt: now
    });
    this.insertEdge(DEFAULT_OWNER_NODE_ID, relationForNodeType(candidate.proposedNodeType), nodeId, {
      candidateId: candidate.id,
      evidenceIds: candidate.evidenceIds
    }, "profile", undefined, candidate.confidence);
    this.createEvent("node.created", "Graph node created", {
      nodeId,
      label: candidate.label,
      type: candidate.proposedNodeType
    }, {
      relatedNodeId: nodeId
    });
    this.createEvent("edge.created", "Graph edge created", {
      sourceNodeId: DEFAULT_OWNER_NODE_ID,
      targetNodeId: nodeId
    });
  }

  private ensureOwnerNode(): void {
    if (this.getGraphNode(DEFAULT_OWNER_NODE_ID)) {
      return;
    }
    const now = nowIso();
    this.insertNode({
      id: DEFAULT_OWNER_NODE_ID,
      type: "owner",
      label: "Owner",
      payload: {},
      status: "active",
      confidence: 1,
      scopeType: "global",
      origin: "system",
      createdAt: now,
      updatedAt: now
    });
  }

  private insertNode(node: GraphNode): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO nodes
         (id, type, label, payload_json, status, confidence, scope_type, scope_id, origin, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        node.id,
        node.type,
        node.label,
        stringify(node.payload),
        node.status,
        node.confidence,
        node.scopeType,
        node.scopeId ?? null,
        node.origin,
        node.createdAt,
        node.updatedAt,
        node.expiresAt ?? null
      );
  }

  private insertEdge(
    sourceNodeId: string,
    relation: string,
    targetNodeId: string,
    payload: JsonRecord,
    scopeType: string,
    scopeId: string | undefined,
    confidence: number
  ): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO edges
         (id, source_node_id, relation, target_node_id, payload_json, status, confidence, scope_type, scope_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        createId("edge"),
        sourceNodeId,
        relation,
        targetNodeId,
        stringify(payload),
        "active",
        confidence,
        scopeType,
        scopeId ?? null,
        now,
        now
      );
  }

  private createEvent(
    type: EventType,
    title: string,
    payload: JsonRecord,
    refs: Partial<Pick<Event, "relatedConversationId" | "relatedMessageId" | "relatedNodeId" | "relatedWorkerId">> = {}
  ): Event {
    const event: Event = {
      id: createId("event"),
      type,
      title,
      payload,
      ...refs,
      createdAt: nowIso()
    };
    this.db
      .prepare(
        `INSERT INTO events
         (id, type, title, body, payload_json, related_conversation_id, related_message_id, related_node_id, related_worker_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.type,
        event.title,
        event.body ?? null,
        stringify(event.payload),
        event.relatedConversationId ?? null,
        event.relatedMessageId ?? null,
        event.relatedNodeId ?? null,
        event.relatedWorkerId ?? null,
        event.createdAt
      );
    return event;
  }

  private createAuditRecord(
    actorType: AuditRecord["actorType"],
    action: string,
    targetType: string,
    targetId: string,
    payload: JsonRecord
  ): AuditRecord {
    const audit: AuditRecord = {
      id: createId("audit"),
      actorType,
      action,
      targetType,
      targetId,
      payload,
      createdAt: nowIso()
    };
    this.db
      .prepare(
        "INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        audit.id,
        audit.actorType,
        audit.actorId ?? null,
        audit.action,
        audit.targetType,
        audit.targetId,
        stringify(audit.payload),
        audit.createdAt
      );
    return audit;
  }

  private seedLlmProviderPresets(): void {
    for (const preset of LLM_PROVIDER_PRESETS) {
      this.db
        .prepare(
          `INSERT INTO llm_provider_presets
           (id, display_name, adapter_type, base_url, default_model, enabled_by_default)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             display_name = excluded.display_name,
             adapter_type = excluded.adapter_type,
             base_url = excluded.base_url,
             default_model = excluded.default_model,
             enabled_by_default = excluded.enabled_by_default`
        )
        .run(
          preset.id,
          preset.displayName,
          preset.adapterType,
          preset.baseUrl ?? null,
          preset.defaultModel,
          preset.enabledByDefault ? 1 : 0
        );
    }
  }

  private removeProductMockLlmProvider(): void {
    this.db.prepare("DELETE FROM llm_model_routes WHERE provider_config_id IN (SELECT id FROM llm_provider_configs WHERE adapter_type = 'mock' OR preset_id = 'mock')").run();
    this.db.prepare("DELETE FROM llm_provider_configs WHERE adapter_type = 'mock' OR preset_id = 'mock'").run();
    this.db.prepare("DELETE FROM llm_provider_presets WHERE id = 'mock' OR adapter_type = 'mock'").run();
  }

  private ensureRoutesForFirstProvider(providerConfigId: string, model: string): void {
    if (this.listLlmModelRoutes().length > 0) {
      return;
    }
    const now = nowIso();
    for (const purpose of LLM_ROUTE_PURPOSES) {
      const maxTokens = purpose === "memory_extraction" ? 2000 : 16384;
      this.db
        .prepare(
          `INSERT OR IGNORE INTO llm_model_routes
           (purpose, provider_config_id, model, temperature, max_tokens, enabled, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(purpose, providerConfigId, model, purpose === "memory_extraction" ? 0 : 0.2, maxTokens, 1, now);
    }
  }

  private ensureInternalTools(): void {
    const internalTools: ToolRegistryEntry[] = [
      {
        id: "tool_internal_task_create",
        source: "internal",
        sourceId: "task.create",
        name: "task.create",
        title: "Create task",
        description: "Create an internal suggested task for owner review.",
        inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
        outputSchema: { type: "object" },
        riskLevel: "low",
        requiresConfirmation: false,
        enabled: true
      },
      {
        id: "tool_internal_suggest_action",
        source: "internal",
        sourceId: "suggest_action",
        name: "suggest_action",
        title: "Suggest action",
        description: "Suggest a safe internal next action without external side effects.",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        riskLevel: "low",
        requiresConfirmation: false,
        enabled: true
      },
      {
        id: "tool_internal_web_search",
        source: "internal",
        sourceId: "web.search",
        name: "web.search",
        title: "Web search",
        description: "Search the public web for current information and return ranked results with URLs and snippets.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            max_results: { type: "number" }
          },
          required: ["query"]
        },
        outputSchema: { type: "object" },
        riskLevel: "low",
        requiresConfirmation: false,
        enabled: true
      },
      {
        id: "tool_internal_web_fetch",
        source: "internal",
        sourceId: "web.fetch",
        name: "web.fetch",
        title: "Web fetch",
        description: "Fetch readable text content from a public HTTP or HTTPS URL.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string" },
            max_chars: { type: "number" }
          },
          required: ["url"]
        },
        outputSchema: { type: "object" },
        riskLevel: "medium",
        requiresConfirmation: false,
        enabled: true
      }
    ];
    for (const tool of internalTools) {
      this.upsertToolRegistryEntry(tool);
    }
  }

  private removeLegacyBuiltInSkills(): void {
    const builtIns = this.db
      .prepare("SELECT id FROM skill_definitions WHERE source_type = 'built_in'")
      .all() as Array<{ id: string }>;
    for (const row of builtIns) {
      const skillId = String(row.id);
      this.db.prepare("DELETE FROM skill_runs WHERE skill_id = ?").run(skillId);
      this.db.prepare("DELETE FROM tool_registry WHERE source = 'skill' AND source_id = ?").run(skillId);
      this.db.prepare("DELETE FROM skill_definitions WHERE id = ?").run(skillId);
    }
  }

  private removeLegacyBailianWebSearchMcpServers(): void {
    const legacyServers = this.db
      .prepare(
        `SELECT id FROM mcp_servers
         WHERE name = 'Bailian WebSearch'
            OR url LIKE '%/mcps/WebSearch/mcp'`
      )
      .all() as Array<{ id: string }>;
    for (const row of legacyServers) {
      this.removeMcpServer(String(row.id));
    }
  }

  private removeLegacyMockMcpServers(): void {
    const mockServers = this.db
      .prepare(
        `SELECT id FROM mcp_servers
         WHERE lower(name) LIKE '%mock%'
            OR command IN ('mock', 'mock-stdio')`
      )
      .all() as Array<{ id: string }>;
    for (const row of mockServers) {
      this.removeMcpServer(String(row.id));
    }
  }

  private insertSkill(skill: SkillDefinition): void {
    this.db
      .prepare(
        `INSERT INTO skill_definitions
         (id, name, description, source_type, instruction_markdown, required_tools_json, risk_level, enabled, storage_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        skill.id,
        skill.name,
        skill.description,
        skill.sourceType,
        skill.instructionMarkdown,
        stringify(skill.requiredTools),
        skill.riskLevel,
        skill.enabled ? 1 : 0,
        skill.storagePath ?? null,
        skill.createdAt,
        skill.updatedAt
      );
  }

  private upsertMcpTool(server: McpServer, tool: DiscoveredMcpTool, lastSeenAt: string): McpTool {
    const toolId = `mcp_tool_${server.id}_${slugId(tool.name)}`;
    const existing = this.db.prepare("SELECT * FROM mcp_tools WHERE id = ?").get(toolId);
    const existingTool = existing ? mapMcpTool(existing) : undefined;
    const riskLevel = tool.riskLevel ?? existingTool?.riskLevel ?? inferToolRisk(tool.name, tool.description ?? "");
    const requiresConfirmation = server.trustLevel === "untrusted" || riskLevel !== "low";
    const enabled = existingTool?.enabled ?? true;
    this.db
      .prepare(
        `INSERT INTO mcp_tools
         (id, server_id, name, title, description, input_schema_json, output_schema_json, risk_level, enabled, requires_confirmation, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           input_schema_json = excluded.input_schema_json,
           output_schema_json = excluded.output_schema_json,
           risk_level = excluded.risk_level,
           requires_confirmation = excluded.requires_confirmation,
           last_seen_at = excluded.last_seen_at`
      )
      .run(
        toolId,
        server.id,
        tool.name,
        tool.title ?? tool.name,
        tool.description ?? "",
        stringify(tool.inputSchema ?? {}),
        stringify(tool.outputSchema ?? {}),
        riskLevel,
        enabled ? 1 : 0,
        requiresConfirmation ? 1 : 0,
        lastSeenAt
      );
    const saved = this.listMcpTools(server.id).find((item) => item.id === toolId) as McpTool;
    this.upsertToolRegistryEntry({
      id: `tool_${toolId}`,
      source: "mcp",
      sourceId: saved.id,
      name: saved.name,
      title: saved.title,
      description: saved.description,
      inputSchema: saved.inputSchema,
      outputSchema: saved.outputSchema,
      riskLevel: saved.riskLevel,
      requiresConfirmation: saved.requiresConfirmation,
      enabled: saved.enabled
    });
    return saved;
  }

  private upsertMcpResource(serverId: string, resource: DiscoveredMcpResource, lastSeenAt: string): McpResource {
    const resourceId = `mcp_resource_${serverId}_${slugId(resource.uri)}`;
    this.db
      .prepare(
        `INSERT INTO mcp_resources
         (id, server_id, uri, name, description, mime_type, enabled, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           mime_type = excluded.mime_type,
           last_seen_at = excluded.last_seen_at`
      )
      .run(resourceId, serverId, resource.uri, resource.name ?? resource.uri, resource.description ?? "", resource.mimeType ?? null, 1, lastSeenAt);
    return this.listMcpResources(serverId).find((item) => item.id === resourceId) as McpResource;
  }

  private upsertMcpPrompt(serverId: string, prompt: DiscoveredMcpPrompt, lastSeenAt: string): McpPrompt {
    const promptId = `mcp_prompt_${serverId}_${slugId(prompt.name)}`;
    this.db
      .prepare(
        `INSERT INTO mcp_prompts
         (id, server_id, name, title, description, arguments_schema_json, enabled, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           arguments_schema_json = excluded.arguments_schema_json,
           last_seen_at = excluded.last_seen_at`
      )
      .run(promptId, serverId, prompt.name, prompt.title ?? prompt.name, prompt.description ?? "", stringify(prompt.argumentsSchema ?? {}), 1, lastSeenAt);
    return this.listMcpPrompts(serverId).find((item) => item.id === promptId) as McpPrompt;
  }

  private upsertToolRegistryEntry(tool: ToolRegistryEntry): void {
    this.db
      .prepare(
        `INSERT INTO tool_registry
         (id, source, source_id, name, title, description, input_schema_json, output_schema_json,
          risk_level, requires_confirmation, enabled, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           input_schema_json = excluded.input_schema_json,
           output_schema_json = excluded.output_schema_json,
           risk_level = excluded.risk_level,
           requires_confirmation = excluded.requires_confirmation,
           enabled = excluded.enabled`
      )
      .run(
        tool.id,
        tool.source,
        tool.sourceId,
        tool.name,
        tool.title,
        tool.description,
        stringify(tool.inputSchema),
        stringify(tool.outputSchema),
        tool.riskLevel,
        tool.requiresConfirmation ? 1 : 0,
        tool.enabled ? 1 : 0,
        tool.lastUsedAt ?? null
      );
  }

  private ensureDefaultSettings(): void {
    const now = nowIso();
    this.upsertSettingIfMissing("ui.locale", "en", now);
    this.upsertSettingIfMissing("assistant.reply_locale", "follow_ui", now);
    this.ensureDefaultWebToolsSettings();
  }

  private ensureDefaultWebToolsSettings(): void {
    const now = nowIso();
    const env = process.env;
    const braveApiKey = env.BRAVE_SEARCH_API_KEY?.trim() || undefined;
    const dashscopeApiKey = env.DASHSCOPE_API_KEY?.trim() || undefined;
    const searxngUrl = env.SEARXNG_URL?.trim() || undefined;
    const explicitProvider = env.WEB_SEARCH_PROVIDER?.trim().toLowerCase();
    let initialProvider: WebSearchProvider = "duckduckgo";
    if (explicitProvider === "brave" || explicitProvider === "searxng" || explicitProvider === "duckduckgo" || explicitProvider === "bailian") {
      initialProvider = explicitProvider;
    } else if (dashscopeApiKey) {
      initialProvider = "bailian";
    } else if (braveApiKey) {
      initialProvider = "brave";
    } else if (searxngUrl) {
      initialProvider = "searxng";
    }
    this.upsertSettingIfMissing("web.tools.enabled", (env.WEB_TOOLS_ENABLED ?? "true") !== "false", now);
    this.upsertSettingIfMissing("web.search.provider", initialProvider, now);
    this.upsertSettingIfMissing("web.search.max_results", Number.parseInt(env.WEB_SEARCH_MAX_RESULTS ?? "5", 10) || 5, now);
    this.upsertSettingIfMissing("web.fetch.max_chars", Number.parseInt(env.WEB_FETCH_MAX_CHARS ?? "8000", 10) || 8000, now);
    this.upsertSettingIfMissing("web.fetch.timeout_ms", Number.parseInt(env.WEB_FETCH_TIMEOUT_MS ?? "15000", 10) || 15000, now);
    this.upsertSettingIfMissing("web.searxng.url", searxngUrl ?? null, now);
    if (braveApiKey) {
      this.upsertSettingIfMissing("web.brave.api_key_secret", braveApiKey, now);
    }
    if (dashscopeApiKey) {
      this.upsertSettingIfMissing("web.dashscope.api_key_secret", dashscopeApiKey, now);
    }
  }

  private getWebToolsSettingsWithSecrets(): WebToolsConfig & { updatedAt: string } {
    this.ensureDefaultWebToolsSettings();
    const rows = this.db.prepare("SELECT key, value_json, updated_at FROM settings WHERE key LIKE 'web.%'").all();
    const values = new Map(rows.map((row) => [String(row.key), parseJson<unknown>(row.value_json, null)]));
    const updatedAt = rows
      .map((row) => String(row.updated_at))
      .sort()
      .at(-1) ?? nowIso();
    const searchMaxResults = normalizeBoundedInt(values.get("web.search.max_results"), 5, 1, 10);
    const fetchMaxChars = normalizeBoundedInt(values.get("web.fetch.max_chars"), 8000, 1000, 50000);
    const fetchTimeoutMs = normalizeBoundedInt(values.get("web.fetch.timeout_ms"), 15000, 1000, 60000);
    const searchProvider = normalizeWebSearchProvider(values.get("web.search.provider"));
    const searxngUrlRaw = values.get("web.searxng.url");
    const searxngUrl = typeof searxngUrlRaw === "string" && searxngUrlRaw.trim().length > 0 ? searxngUrlRaw.trim() : undefined;
    const braveApiKeyRaw = values.get("web.brave.api_key_secret");
    const braveApiKey = typeof braveApiKeyRaw === "string" && braveApiKeyRaw.length > 0 ? braveApiKeyRaw : undefined;
    const dashscopeApiKeyRaw = values.get("web.dashscope.api_key_secret");
    const dashscopeApiKey = typeof dashscopeApiKeyRaw === "string" && dashscopeApiKeyRaw.length > 0 ? dashscopeApiKeyRaw : undefined;
    return {
      enabled: values.get("web.tools.enabled") !== false,
      searchProvider,
      searchMaxResults,
      fetchMaxChars,
      fetchTimeoutMs,
      searxngUrl,
      braveApiKey,
      dashscopeApiKey,
      updatedAt
    };
  }

  private upsertSettingIfMissing(key: string, value: unknown, updatedAt: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)")
      .run(key, stringify(value), updatedAt);
  }

  private upsertSetting(key: string, value: unknown, updatedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(key, stringify(value), updatedAt);
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => String(row.name));
    if (!columns.includes(column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private requireWorker(id: string): Worker {
    const worker = this.getWorker(id);
    if (!worker) {
      throw new Error(`Worker not found: ${id}`);
    }
    return worker;
  }

  private markWorkerGraphRevoked(workerId: string, displayName: string, worker: Worker): void {
    const now = nowIso();
    const workerNodeId = `node_${workerId}`;
    const payload = {
      environment: worker.environment,
      hostName: worker.hostName,
      os: worker.os,
      location: worker.location,
      status: worker.status
    };
    if (this.getGraphNode(workerNodeId)) {
      this.db
        .prepare("UPDATE nodes SET label = ?, payload_json = ?, status = ?, updated_at = ? WHERE id = ?")
        .run(displayName, stringify(payload), "rejected", now, workerNodeId);
    } else {
      this.insertNode({
        id: workerNodeId,
        type: "worker",
        label: displayName,
        payload,
        status: "rejected",
        confidence: 1,
        scopeType: "worker",
        scopeId: workerId,
        origin: "worker-registry",
        createdAt: now,
        updatedAt: now
      });
    }
    for (const capability of this.listWorkerCapabilities(workerId)) {
      const capabilityNodeId = `node_${capability.id}`;
      if (this.getGraphNode(capabilityNodeId)) {
        this.db
          .prepare("UPDATE nodes SET label = ?, payload_json = ?, status = ?, updated_at = ? WHERE id = ?")
          .run(capability.name, stringify({ ...capability, enabled: false }), "rejected", now, capabilityNodeId);
      }
    }
  }

  private ensureWorkerGraphNode(worker: Worker, origin: string): void {
    const now = nowIso();
    const workerNodeId = `node_${worker.id}`;
    const payload = {
      environment: worker.environment,
      hostName: worker.hostName,
      os: worker.os,
      location: worker.location,
      status: worker.status
    };
    if (this.getGraphNode(workerNodeId)) {
      this.db
        .prepare("UPDATE nodes SET label = ?, payload_json = ?, status = ?, updated_at = ? WHERE id = ?")
        .run(worker.displayName, stringify(payload), worker.status === "revoked" ? "rejected" : "active", now, workerNodeId);
      return;
    }
    this.insertNode({
      id: workerNodeId,
      type: "worker",
      label: worker.displayName,
      payload,
      status: worker.status === "revoked" ? "rejected" : "active",
      confidence: 1,
      scopeType: "worker",
      scopeId: worker.id,
      origin,
      createdAt: now,
      updatedAt: now
    });
  }

  private getWorkerCapability(workerId: string, name: string): Capability | undefined {
    const row = this.db
      .prepare("SELECT * FROM worker_capabilities WHERE worker_id = ? AND name = ?")
      .get(workerId, name);
    return row ? mapWorkerCapability(row as Record<string, unknown>) : undefined;
  }

  private requireWorkerCapability(id: string): Capability {
    const row = this.db.prepare("SELECT * FROM worker_capabilities WHERE id = ?").get(id);
    if (!row) {
      throw new Error(`Worker capability not found: ${id}`);
    }
    return mapWorkerCapability(row as Record<string, unknown>);
  }

  private ensureWorkerCapabilityGraphNode(workerId: string, capability: Capability): void {
    const now = nowIso();
    const capabilityNodeId = `node_${capability.id}`;
    if (this.getGraphNode(capabilityNodeId)) {
      this.db
        .prepare("UPDATE nodes SET label = ?, payload_json = ?, status = ?, updated_at = ? WHERE id = ?")
        .run(capability.name, stringify(capability), capability.enabled ? "active" : "rejected", now, capabilityNodeId);
      return;
    }
    this.insertNode({
      id: capabilityNodeId,
      type: "capability",
      label: capability.name,
      payload: capability,
      status: capability.enabled ? "active" : "rejected",
      confidence: 1,
      scopeType: "worker",
      scopeId: workerId,
      origin: "worker-registry",
      createdAt: now,
      updatedAt: now
    });
    this.insertEdge(`node_${workerId}`, "declares_capability", capabilityNodeId, {}, "worker", workerId, 1);
  }

  private requireWorkerPathScope(id: string): WorkerPathScope {
    const row = this.db.prepare("SELECT * FROM worker_path_scopes WHERE id = ?").get(id);
    if (!row) {
      throw new Error(`Worker path scope not found: ${id}`);
    }
    return mapWorkerPathScope(row as Record<string, unknown>);
  }

  private requireWorkerJob(id: string): WorkerJob {
    const row = this.db.prepare("SELECT * FROM worker_jobs WHERE id = ?").get(id);
    if (!row) {
      throw new Error(`Worker job not found: ${id}`);
    }
    return mapWorkerJob(row as Record<string, unknown>);
  }

  private validateWorkerJobInput(workerId: string, capability: string, input: JsonRecord): void {
    if (capability === "worker.status") {
      return;
    }
    if (capability === "file.search") {
      const paths = Array.isArray(input.paths) ? input.paths.map(String) : [];
      if (paths.length === 0) {
        throw new Error("file.search requires at least one path.");
      }
      for (const path of paths) {
        this.assertWorkerPathAllowed(workerId, path);
      }
      return;
    }
    if (capability === "file.list") {
      if (typeof input.path !== "string") {
        throw new Error("file.list requires a path.");
      }
      this.assertWorkerPathAllowed(workerId, input.path);
      return;
    }
    if (capability === "file.read") {
      if (typeof input.path !== "string") {
        throw new Error("file.read requires a path.");
      }
      this.assertWorkerPathAllowed(workerId, input.path);
      return;
    }
    throw new Error(`Unsupported worker capability: ${capability}`);
  }

  private assertWorkerPathAllowed(workerId: string, targetPath: string): void {
    if (isForbiddenWorkerPath(targetPath)) {
      throw new Error("Worker job path is forbidden.");
    }
    const scopes = this.listWorkerPathScopes(workerId).filter((scope) => scope.enabled && scope.mode === "read_only");
    if (!scopes.some((scope) => isPathWithinScope(targetPath, scope.path))) {
      throw new Error("Worker job path is outside allowed scopes.");
    }
  }

  private registerWorkerWithCredential(input: RegisterWorkerInput, credentialHash: string): Worker {
    const worker = this.registerWorker(input);
    this.db.prepare("UPDATE workers SET credential_hash = ? WHERE id = ?").run(credentialHash, worker.id);
    return this.requireWorker(worker.id);
  }

  private expireWorkerPairCodes(): void {
    const now = nowIso();
    this.db
      .prepare("UPDATE worker_pair_codes SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?")
      .run(now);
  }

  private markStaleWorkersOffline(): void {
    const cutoff = new Date(Date.now() - WORKER_OFFLINE_AFTER_MS).toISOString();
    const staleWorkers = this.db
      .prepare("SELECT id FROM workers WHERE status = 'online' AND last_seen_at IS NOT NULL AND last_seen_at < ?")
      .all(cutoff) as Array<{ id: string }>;
    if (staleWorkers.length === 0) {
      return;
    }
    const now = nowIso();
    const update = this.db.prepare("UPDATE workers SET status = 'offline', updated_at = ? WHERE id = ? AND status = 'online'");
    for (const worker of staleWorkers) {
      const result = update.run(now, worker.id);
      if (result.changes === 0) {
        continue;
      }
      this.createWorkerEvent(worker.id, undefined, "worker.offline", { reason: "heartbeat_timeout" });
      this.createEvent("worker.offline", "Worker offline", { workerId: worker.id, reason: "heartbeat_timeout" }, { relatedWorkerId: worker.id });
      this.createAuditRecord("system", "worker.offline", "worker", worker.id, { reason: "heartbeat_timeout" });
    }
  }

  private createWorkerEvent(workerId: string, jobId: string | undefined, type: string, payload: JsonRecord): WorkerEvent {
    const event: WorkerEvent = {
      id: createId("worker_event"),
      workerId,
      jobId,
      type,
      payload,
      createdAt: nowIso()
    };
    this.db
      .prepare(
        `INSERT INTO worker_events (id, worker_id, job_id, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(event.id, event.workerId, event.jobId ?? null, event.type, stringify(event.payload), event.createdAt);
    return event;
  }

  private requireMemoryCandidate(id: string): MemoryCandidate {
    const row = this.db.prepare("SELECT * FROM memory_candidates WHERE id = ?").get(id);
    if (!row) {
      throw new Error(`Memory candidate not found: ${id}`);
    }
    return mapMemoryCandidate(row);
  }

  private hasEquivalentMemoryCandidate(memory: ExtractedMemory): boolean {
    return this.listMemoryCandidates().some((candidate) => candidateKey(candidate) === extractedMemoryKey(memory));
  }

  private deduplicateMemoryCandidates(): number {
    const groups = new Map<string, MemoryCandidate[]>();
    for (const candidate of this.listMemoryCandidates()) {
      const key = candidateKey(candidate);
      groups.set(key, [...(groups.get(key) ?? []), candidate]);
    }

    let deleted = 0;
    for (const candidates of groups.values()) {
      if (candidates.length < 2) {
        continue;
      }
      const keeper = chooseMemoryCandidateToKeep(candidates);
      for (const candidate of candidates) {
        if (candidate.id !== keeper.id) {
          this.deleteDuplicateMemoryCandidate(candidate);
          deleted += 1;
        }
      }
    }
    return deleted;
  }

  private deleteDuplicateMemoryCandidate(candidate: MemoryCandidate): void {
    const nodeId = `node_${candidate.id}`;
    this.db.prepare("DELETE FROM edges WHERE source_node_id = ? OR target_node_id = ?").run(nodeId, nodeId);
    this.db.prepare("DELETE FROM nodes WHERE id = ?").run(nodeId);
    for (const evidenceId of candidate.evidenceIds) {
      this.db.prepare("DELETE FROM evidence WHERE id = ?").run(evidenceId);
    }
    this.db.prepare("DELETE FROM memory_candidates WHERE id = ?").run(candidate.id);
  }

  private migrateProfileAttributeHistoryForeignKey(): void {
    const row = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'profile_attribute_history'")
      .get() as { sql?: string } | undefined;
    if (!row?.sql || !row.sql.includes("REFERENCES profile_attributes")) {
      return;
    }
    this.db.exec(`
      CREATE TABLE profile_attribute_history_next (
        id TEXT PRIMARY KEY,
        attribute_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        operation TEXT NOT NULL,
        old_value_json TEXT,
        new_value_json TEXT,
        evidence_id TEXT,
        reason TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO profile_attribute_history_next SELECT * FROM profile_attribute_history;
      DROP TABLE profile_attribute_history;
      ALTER TABLE profile_attribute_history_next RENAME TO profile_attribute_history;
    `);
  }

  private ensureOwnerProfile(): void {
    const now = nowIso();
    this.db
      .prepare(
        "INSERT OR IGNORE INTO profiles (id, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run(DEFAULT_OWNER_PROFILE_ID, "owner", now, now);
    this.ensureOwnerNode();
    if (!this.getGraphNode(DEFAULT_OWNER_PROFILE_ID)) {
      this.insertNode({
        id: DEFAULT_OWNER_PROFILE_ID,
        type: "owner_profile",
        label: "Owner Profile",
        payload: { ownerId: "owner" },
        status: "active",
        confidence: 1,
        scopeType: "profile",
        origin: "system",
        createdAt: now,
        updatedAt: now
      });
      this.insertEdge(DEFAULT_OWNER_NODE_ID, "has_profile", DEFAULT_OWNER_PROFILE_ID, {}, "profile", undefined, 1);
    }
    this.migrateProfileAttributesToGraph();
    this.importLegacyProfileFactCandidates();
  }

  private touchOwnerProfile(updatedAt: string): void {
    this.db.prepare("UPDATE profiles SET updated_at = ? WHERE id = ?").run(updatedAt, DEFAULT_OWNER_PROFILE_ID);
    this.db.prepare("UPDATE nodes SET updated_at = ? WHERE id = ?").run(updatedAt, DEFAULT_OWNER_PROFILE_ID);
  }

  private findProfileAttribute(key: string): ProfileAttribute | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM nodes
         WHERE type = 'profile_attribute'
           AND scope_id = ?
           AND json_extract(payload_json, '$.attributeKey') = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(DEFAULT_OWNER_PROFILE_ID, key);
    return row ? profileAttributeFromNode(mapGraphNode(row)) : undefined;
  }

  private requireProfileAttribute(id: string): ProfileAttribute {
    const node = this.getGraphNode(id);
    if (!node || node.type !== "profile_attribute") {
      throw new Error(`Profile attribute not found: ${id}`);
    }
    return profileAttributeFromNode(node);
  }

  private insertProfileAttribute(
    proposal: ProfilePatchProposal,
    evidenceId: string,
    status: MemoryStatus,
    requiresConfirmation: boolean
  ): ProfileAttribute {
    const now = nowIso();
    const id = createId("profile_attr");
    const node = buildProfileAttributeNode({
      id,
      proposal,
      evidenceId,
      status,
      requiresConfirmation,
      createdAt: now,
      updatedAt: now
    });
    this.insertNode(node);
    this.ensureProfileAttributeEdge(id, proposal.attributeKey, proposal.confidence, node.createdAt, node.updatedAt);
    return this.requireProfileAttribute(id);
  }

  private updateProfileAttributeNode(
    id: string,
    patch: {
      semanticType?: ProfileSemanticType;
      value?: JsonRecord;
      normalizedValue?: string;
      confidence?: number;
      risk?: RiskLevel;
      status?: MemoryStatus;
      latestEvidenceId?: string;
      requiresConfirmation?: boolean;
      updatedAt: string;
    }
  ): void {
    const existing = this.getGraphNode(id);
    if (!existing || existing.type !== "profile_attribute") {
      throw new Error(`Profile attribute not found: ${id}`);
    }
    const attributeKey = String(existing.payload.attributeKey ?? "");
    const normalizedValue = patch.normalizedValue ?? String(existing.payload.normalizedValue ?? "");
    const payload = {
      ...existing.payload,
      ...(patch.semanticType ? { semanticType: patch.semanticType } : {}),
      ...(patch.value ? { value: patch.value } : {}),
      normalizedValue,
      ...(patch.risk ? { risk: patch.risk } : {}),
      ...(patch.latestEvidenceId ? { latestEvidenceId: patch.latestEvidenceId } : {}),
      ...(patch.requiresConfirmation !== undefined ? { requiresConfirmation: patch.requiresConfirmation } : {})
    };
    const graphStatus = patch.status === "observed" ? "candidate" : (patch.status ?? existing.status);
    this.db
      .prepare(
        `UPDATE nodes
         SET label = ?, payload_json = ?, confidence = ?, status = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        `${attributeKey}: ${normalizedValue}`,
        stringify(payload),
        patch.confidence ?? existing.confidence,
        graphStatus,
        patch.updatedAt,
        id
      );
  }

  private ensureProfileAttributeEdge(
    attributeNodeId: string,
    attributeKey: string,
    confidence: number,
    createdAt: string,
    updatedAt: string
  ): void {
    const existing = this.db
      .prepare(
        `SELECT id FROM edges
         WHERE source_node_id = ? AND target_node_id = ? AND relation = 'has_attribute'
         LIMIT 1`
      )
      .get(DEFAULT_OWNER_PROFILE_ID, attributeNodeId);
    if (existing) {
      return;
    }
    this.db
      .prepare(
        `INSERT INTO edges
         (id, source_node_id, relation, target_node_id, payload_json, status, confidence, scope_type, scope_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        createId("edge"),
        DEFAULT_OWNER_PROFILE_ID,
        "has_attribute",
        attributeNodeId,
        stringify({ attributeKey }),
        "active",
        confidence,
        "profile",
        DEFAULT_OWNER_PROFILE_ID,
        createdAt,
        updatedAt
      );
  }

  private migrateProfileAttributesToGraph(): void {
    const rows = this.db.prepare("SELECT * FROM profile_attributes ORDER BY created_at ASC").all();
    if (rows.length === 0) {
      return;
    }
    for (const row of rows) {
      const attribute = mapProfileAttribute(row);
      if (this.getGraphNode(attribute.id)) {
        continue;
      }
      const node = buildProfileAttributeNodeFromAttribute(attribute);
      this.insertNode(node);
      this.ensureProfileAttributeEdge(
        attribute.id,
        attribute.key,
        attribute.confidence,
        attribute.createdAt,
        attribute.updatedAt
      );
    }
    this.db.prepare("DELETE FROM profile_attributes").run();
  }

  private createProfileAttributeHistory(
    attributeId: string,
    operation: ProfilePatchOperation,
    oldValue: JsonRecord | undefined,
    newValue: JsonRecord | undefined,
    evidenceId: string | undefined,
    reason: string | undefined
  ): ProfileAttributeHistory {
    const history: ProfileAttributeHistory = {
      id: createId("profile_hist"),
      attributeId,
      operation,
      oldValue,
      newValue,
      evidenceId,
      reason,
      createdAt: nowIso()
    };
    this.db
      .prepare(
        `INSERT INTO profile_attribute_history
         (id, attribute_id, operation, old_value_json, new_value_json, evidence_id, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        history.id,
        attributeId,
        operation,
        oldValue ? stringify(oldValue) : null,
        newValue ? stringify(newValue) : null,
        evidenceId ?? null,
        reason ?? null,
        history.createdAt
      );
    return history;
  }

  private listProfileAttributeHistory(attributeId: string): ProfileAttributeHistory[] {
    return this.db
      .prepare("SELECT * FROM profile_attribute_history WHERE attribute_id = ? ORDER BY created_at ASC")
      .all(attributeId)
      .map(mapProfileAttributeHistory);
  }

  private importLegacyProfileFactCandidates(): void {
    const candidates = this.db
      .prepare("SELECT * FROM memory_candidates WHERE kind = ? ORDER BY created_at ASC")
      .all("profile_fact")
      .map(mapMemoryCandidate);
    for (const candidate of candidates) {
      const payload = candidate.payload;
      const predicate = typeof payload.predicate === "string" ? payload.predicate : candidate.proposedRelation;
      const object = typeof payload.object === "string" ? payload.object : candidate.label;
      if (!predicate || !object) {
        continue;
      }
      const key = legacyProfileAttributeKey(predicate);
      const existing = this.findProfileAttribute(key);
      if (existing?.normalizedValue === object) {
        continue;
      }
      if (existing) {
        continue;
      }
      const evidenceId = candidate.evidenceIds[0];
      const attribute = this.insertProfileAttributeFromLegacyCandidate(candidate, key, object, evidenceId);
      this.createProfileAttributeHistory(
        attribute.id,
        "add",
        undefined,
        attribute.value,
        evidenceId,
        "Imported from legacy profile_fact memory candidate."
      );
      this.createEvent("profile.attribute_added", "Profile attribute added", {
        attributeId: attribute.id,
        key: attribute.key,
        status: attribute.status,
        risk: attribute.risk,
        importedFrom: candidate.id
      });
      this.createAuditRecord("system", "profile.attribute.import_legacy", "profile_attribute", attribute.id, {
        key: attribute.key,
        candidateId: candidate.id
      });
    }
  }

  private insertProfileAttributeFromLegacyCandidate(
    candidate: MemoryCandidate,
    key: string,
    normalizedValue: string,
    evidenceId: string | undefined
  ): ProfileAttribute {
    const now = candidate.createdAt;
    const id = createId("profile_attr");
    const status = candidate.status === "active" ? "active" : candidate.status === "quarantined" ? "quarantined" : "candidate";
    const value = {
      value: normalizedValue,
      legacyCandidateId: candidate.id,
      label: candidate.label
    };
    const proposal: ProfilePatchProposal = {
      target: "owner_profile",
      operation: "add",
      attributeKey: key,
      semanticType: "identity",
      value,
      normalizedValue,
      confidence: candidate.confidence,
      risk: candidate.risk,
      evidenceQuote: candidate.label,
      reason: "Imported from legacy profile_fact memory candidate."
    };
    const node = buildProfileAttributeNode({
      id,
      proposal,
      evidenceId: evidenceId ?? createId("ev"),
      status,
      requiresConfirmation: candidate.requiresConfirmation,
      createdAt: now,
      updatedAt: candidate.updatedAt
    });
    this.insertNode(node);
    this.ensureProfileAttributeEdge(id, key, candidate.confidence, now, candidate.updatedAt);
    return this.requireProfileAttribute(id);
  }

  private requireLlmProviderConfig(id: string): LlmProviderConfig {
    const config = this.getLlmProviderConfig(id);
    if (!config) {
      throw new Error(`LLM provider config not found: ${id}`);
    }
    return config;
  }

  private requireMcpServer(id: string): McpServer {
    const server = this.getMcpServer(id);
    if (!server) {
      throw new Error(`MCP server not found: ${id}`);
    }
    return server;
  }

  private requireToolRegistryEntry(id: string): ToolRegistryEntry {
    const tool = this.getToolRegistryEntry(id);
    if (!tool) {
      throw new Error(`Tool not found: ${id}`);
    }
    return tool;
  }

  private requireSkill(id: string): SkillDefinition {
    const row = this.db.prepare("SELECT * FROM skill_definitions WHERE id = ?").get(id);
    if (!row) {
      throw new Error(`Skill not found: ${id}`);
    }
    return mapSkillDefinition(row);
  }
}

export function createMemoryStore(filename: string): MemoryStore {
  return new MemoryStore(filename);
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stringify(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  return JSON.parse(value) as T;
}

function cleanPhrase(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/^that\s+/i, "");
}

function scoreMemoryNodeForQuery(node: GraphNode, queryText: string): number {
  const haystack = memoryNodeSearchText(node);
  const terms = queryTerms(queryText);
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += term.length >= 4 ? 3 : 1;
    }
  }
  const predicate = typeof node.payload.predicate === "string" ? node.payload.predicate : undefined;
  if (predicate) {
    for (const term of splitAttributeKey(predicate)) {
      if (queryText.includes(term)) {
        score += 8;
      }
    }
  }
  const attributeKey = typeof node.payload.attributeKey === "string" ? node.payload.attributeKey : undefined;
  if (attributeKey) {
    for (const term of splitAttributeKey(attributeKey)) {
      if (queryText.includes(term)) {
        score += 8;
      }
    }
  }
  if (node.type === "profile_attribute" && queryText.includes("我")) {
    score += 2;
  }
  if (node.type === "profile_attribute" && isWeatherRelatedQuery(queryText) && isLocationProfileNode(node)) {
    score += 12;
  }
  if (node.type === "profile_attribute" && isOutfitRelatedQuery(queryText) && isGenderProfileNode(node)) {
    score += 12;
  }
  if (node.type === "profile_attribute" && isOutfitRelatedQuery(queryText) && isLocationProfileNode(node)) {
    score += 10;
  }
  return score;
}

function isOutfitRelatedQuery(queryText: string): boolean {
  return /穿什么|怎么穿|穿衣|穿搭|搭配|outfit|what (?:should I )?wear|clothes to wear|dress for/i.test(queryText);
}

function isGenderProfileNode(node: GraphNode): boolean {
  const attributeKey = typeof node.payload.attributeKey === "string" ? node.payload.attributeKey : "";
  return /gender|sex|性别/i.test(attributeKey);
}

function isWeatherRelatedQuery(queryText: string): boolean {
  return /天气|气温|预报|下雨|下雪|weather|forecast|rain|snow/i.test(queryText);
}

function isLocationProfileNode(node: GraphNode): boolean {
  const semanticType = typeof node.payload.semanticType === "string" ? node.payload.semanticType : "";
  const attributeKey = typeof node.payload.attributeKey === "string" ? node.payload.attributeKey : "";
  return semanticType === "location" || /city|home|resident|location|address|常驻地|城市|所在地|居住/i.test(attributeKey);
}

function memoryNodeSearchText(node: GraphNode): string {
  return [
    node.type,
    node.label,
    JSON.stringify(node.payload),
    typeof node.payload.object === "string" ? node.payload.object : "",
    typeof node.payload.value === "string" ? node.payload.value : ""
  ].join(" ").toLowerCase();
}

function queryTerms(queryText: string): string[] {
  const latinTerms = queryText
    .split(/[^a-z0-9_]+/i)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 3);
  const chineseTerms = Array.from(queryText.matchAll(/[\u3400-\u9fff]{2,}/g))
    .flatMap((match) => chineseNgrams(match[0]));
  return Array.from(new Set([...latinTerms, ...chineseTerms]));
}

function chineseNgrams(value: string): string[] {
  const terms = new Set<string>();
  for (let size = Math.min(4, value.length); size >= 2; size -= 1) {
    for (let index = 0; index <= value.length - size; index += 1) {
      terms.add(value.slice(index, index + size));
    }
  }
  return Array.from(terms);
}

function splitAttributeKey(attributeKey: string): string[] {
  return attributeKey.toLowerCase().split(/[_\s]+/).filter((part) => part.length > 2);
}

function legacyProfileAttributeKey(predicate: string): string {
  return predicate
    .trim()
    .toLowerCase()
    .replace(/^has_/, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "profile_attribute";
}

function mergeExtractedMemories(memories: ExtractedMemory[]): ExtractedMemory[] {
  const merged = new Map<string, ExtractedMemory>();
  for (const memory of memories) {
    const key = extractedMemoryKey(memory);
    const existing = merged.get(key);
    if (!existing || memory.confidence > existing.confidence) {
      merged.set(key, memory);
    }
  }
  return Array.from(merged.values());
}

function extractedMemoryKey(memory: ExtractedMemory): string {
  return memoryIdentityKey(memory.kind, memory.payload, memory.label);
}

function candidateKey(candidate: MemoryCandidate): string {
  return memoryIdentityKey(candidate.kind, candidate.payload, candidate.label);
}

function chooseMemoryCandidateToKeep(candidates: MemoryCandidate[]): MemoryCandidate {
  return [...candidates].sort((left, right) => {
    const statusDelta = memoryStatusRank(left.status) - memoryStatusRank(right.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }
    return left.createdAt.localeCompare(right.createdAt);
  })[0]!;
}

function normalizeProfileOperation(
  proposal: ProfilePatchProposal,
  existing: ProfileAttribute | undefined
): ProfilePatchOperation {
  if (proposal.operation === "ignore") {
    return "ignore";
  }
  if (!existing) {
    return proposal.operation === "ask_confirmation" ? "ask_confirmation" : "add";
  }
  if (existing.normalizedValue === proposal.normalizedValue) {
    return "ignore";
  }
  if (proposal.operation === "replace" || proposal.operation === "update") {
    return proposal.operation;
  }
  if (proposal.operation === "ask_confirmation") {
    return "ask_confirmation";
  }
  return "conflict";
}

function memoryStatusRank(status: MemoryStatus): number {
  if (status === "active") {
    return 0;
  }
  if (status === "candidate") {
    return 1;
  }
  if (status === "quarantined") {
    return 2;
  }
  return 3;
}

function memoryIdentityKey(kind: string, payload: JsonRecord, label: string): string {
  const predicate = scalarKey(payload.predicate);
  const object = scalarKey(payload.object);
  const subject = scalarKey(payload.subject);
  const value = object || scalarKey(payload.value);
  if (value) {
    return [kind, value].join("|");
  }
  if (predicate || object || subject) {
    return [kind, subject, predicate, object].join("|");
  }
  return [kind, label.trim().toLowerCase()].join("|");
}

function scalarKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isPathWithinScope(targetPath: string, scopePath: string): boolean {
  const normalizedTarget = normalizePathForPolicy(targetPath);
  const normalizedScope = normalizePathForPolicy(scopePath);
  return normalizedTarget === normalizedScope || normalizedTarget.startsWith(`${normalizedScope}/`);
}

function normalizePathForPolicy(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isForbiddenWorkerPath(value: string): boolean {
  const normalized = normalizePathForPolicy(value).toLowerCase();
  return /(^|\/)(\.env|\.ssh|node_modules|dist|build|\.git)(\/|$)/.test(normalized)
    || /\.(sqlite|sqlite3|db|pem|key|p12|pfx)$/i.test(normalized)
    || normalized.includes("credential")
    || normalized.includes("secret");
}

function relationForNodeType(nodeType: string): string {
  if (nodeType === "preference") {
    return "prefers";
  }
  if (nodeType === "constraint") {
    return "has_constraint";
  }
  if (nodeType === "project") {
    return "works_on";
  }
  return "observed";
}

function slugId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "item";
}

function inferToolRisk(name: string, description: string): RiskLevel {
  const haystack = `${name} ${description}`.toLowerCase();
  if (/(delete|write|send|email|publish|commit|payment|credential|secret|env|删除|发送|发布|提交|密钥)/.test(haystack)) {
    return "high";
  }
  if (/(file|read|search|browser|http|fetch|network|resource|文件|读取|搜索|网络)/.test(haystack)) {
    return "medium";
  }
  return "low";
}

function mapConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    title: String(row.title),
    status: row.status === "archived" ? "archived" : "active",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapMessage(row: Record<string, unknown>): Message {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    role: row.role === "assistant" ? "assistant" : row.role === "system" ? "system" : "owner",
    content: String(row.content),
    metadata: parseJson<JsonRecord>(row.metadata_json, {}),
    locale: row.locale ? String(row.locale) : undefined,
    createdAt: String(row.created_at)
  };
}

function mapEvent(row: Record<string, unknown>): Event {
  return {
    id: String(row.id),
    type: row.type as EventType,
    title: String(row.title),
    body: row.body ? String(row.body) : undefined,
    payload: parseJson<JsonRecord>(row.payload_json, {}),
    relatedConversationId: row.related_conversation_id ? String(row.related_conversation_id) : undefined,
    relatedMessageId: row.related_message_id ? String(row.related_message_id) : undefined,
    relatedNodeId: row.related_node_id ? String(row.related_node_id) : undefined,
    relatedWorkerId: row.related_worker_id ? String(row.related_worker_id) : undefined,
    createdAt: String(row.created_at)
  };
}

function mapEvidence(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    sourceType: row.source_type as "message" | "event" | "artifact" | "manual",
    sourceId: String(row.source_id),
    quote: row.quote ? String(row.quote) : undefined,
    artifactRef: row.artifact_ref ? String(row.artifact_ref) : undefined,
    locale: row.locale ? String(row.locale) : undefined,
    createdAt: String(row.created_at)
  };
}

function mapMemoryCandidate(row: Record<string, unknown>): MemoryCandidate {
  return {
    id: String(row.id),
    status: row.status as MemoryStatus,
    kind: String(row.kind),
    label: String(row.label),
    proposedNodeType: String(row.proposed_node_type),
    proposedRelation: row.proposed_relation ? String(row.proposed_relation) : undefined,
    payload: parseJson<JsonRecord>(row.payload_json, {}),
    confidence: Number(row.confidence),
    risk: row.risk as RiskLevel,
    sourceMessageId: row.source_message_id ? String(row.source_message_id) : undefined,
    evidenceIds: parseJson<string[]>(row.evidence_ids_json, []),
    locale: row.locale ? String(row.locale) : undefined,
    requiresConfirmation: Boolean(row.requires_confirmation),
    decisionReason: row.decision_reason ? String(row.decision_reason) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function profileAttributeFromNode(node: GraphNode): ProfileAttribute {
  return {
    id: node.id,
    profileId: node.scopeId ?? DEFAULT_OWNER_PROFILE_ID,
    key: String(node.payload.attributeKey ?? ""),
    semanticType: (node.payload.semanticType as ProfileSemanticType) ?? "other",
    value: typeof node.payload.value === "object" && node.payload.value !== null
      ? node.payload.value as JsonRecord
      : {},
    normalizedValue: String(node.payload.normalizedValue ?? ""),
    confidence: node.confidence,
    risk: (node.payload.risk as RiskLevel) ?? "low",
    status: node.status as MemoryStatus,
    latestEvidenceId: node.payload.latestEvidenceId ? String(node.payload.latestEvidenceId) : undefined,
    requiresConfirmation: Boolean(node.payload.requiresConfirmation),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    history: []
  };
}

function buildProfileAttributeNode(input: {
  id: string;
  proposal: ProfilePatchProposal;
  evidenceId: string;
  status: MemoryStatus;
  requiresConfirmation: boolean;
  createdAt: string;
  updatedAt: string;
}): GraphNode {
  return {
    id: input.id,
    type: "profile_attribute",
    label: `${input.proposal.attributeKey}: ${input.proposal.normalizedValue}`,
    payload: {
      attributeKey: input.proposal.attributeKey,
      semanticType: input.proposal.semanticType,
      value: input.proposal.value,
      normalizedValue: input.proposal.normalizedValue,
      risk: input.proposal.risk,
      requiresConfirmation: input.requiresConfirmation,
      latestEvidenceId: input.evidenceId
    },
    status: input.status === "observed" ? "candidate" : input.status,
    confidence: input.proposal.confidence,
    scopeType: "profile",
    scopeId: DEFAULT_OWNER_PROFILE_ID,
    origin: "owner_profile",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

function buildProfileAttributeNodeFromAttribute(attribute: ProfileAttribute): GraphNode {
  return {
    id: attribute.id,
    type: "profile_attribute",
    label: `${attribute.key}: ${attribute.normalizedValue}`,
    payload: {
      attributeKey: attribute.key,
      semanticType: attribute.semanticType,
      value: attribute.value,
      normalizedValue: attribute.normalizedValue,
      risk: attribute.risk,
      requiresConfirmation: attribute.requiresConfirmation,
      latestEvidenceId: attribute.latestEvidenceId
    },
    status: attribute.status === "observed" ? "candidate" : attribute.status,
    confidence: attribute.confidence,
    scopeType: "profile",
    scopeId: DEFAULT_OWNER_PROFILE_ID,
    origin: "owner_profile",
    createdAt: attribute.createdAt,
    updatedAt: attribute.updatedAt
  };
}

function mapProfileAttribute(row: Record<string, unknown>): ProfileAttribute {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    key: String(row.key),
    semanticType: row.semantic_type as ProfileSemanticType,
    value: parseJson<JsonRecord>(row.value_json, {}),
    normalizedValue: String(row.normalized_value),
    confidence: Number(row.confidence),
    risk: row.risk as RiskLevel,
    status: row.status as MemoryStatus,
    latestEvidenceId: row.latest_evidence_id ? String(row.latest_evidence_id) : undefined,
    requiresConfirmation: Boolean(row.requires_confirmation),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    history: []
  };
}

function mapProfileAttributeHistory(row: Record<string, unknown>): ProfileAttributeHistory {
  return {
    id: String(row.id),
    attributeId: String(row.attribute_id),
    operation: row.operation as ProfilePatchOperation,
    oldValue: row.old_value_json ? parseJson<JsonRecord>(row.old_value_json, {}) : undefined,
    newValue: row.new_value_json ? parseJson<JsonRecord>(row.new_value_json, {}) : undefined,
    evidenceId: row.evidence_id ? String(row.evidence_id) : undefined,
    reason: row.reason ? String(row.reason) : undefined,
    createdAt: String(row.created_at)
  };
}

function mapWorkerPairCode(row: Record<string, unknown>): WorkerPairCode {
  return {
    id: String(row.id),
    status: row.status as WorkerPairCode["status"],
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
    usedAt: row.used_at ? String(row.used_at) : undefined
  };
}

function normalizeWebSearchProvider(value: unknown): WebSearchProvider {
  if (value === "brave" || value === "searxng" || value === "duckduckgo" || value === "bailian") {
    return value;
  }
  return "duckduckgo";
}

function normalizeBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function formatPairCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 10)}`;
}

function isWebToolsRuntimeConfigured(config: WebToolsConfig): boolean {
  if (!config.enabled) {
    return false;
  }
  switch (config.searchProvider) {
    case "brave":
      return Boolean(config.braveApiKey);
    case "bailian":
      return Boolean(config.dashscopeApiKey);
    case "searxng":
      return Boolean(config.searxngUrl);
    case "duckduckgo":
      return true;
    default:
      return false;
  }
}

function normalizeAssistantReplyLocale(value: unknown): Settings["assistantReplyLocale"] {
  if (value === "en" || value === "zh-CN" || value === "follow_ui") {
    return value;
  }
  return "follow_ui";
}

function mapGraphNode(row: Record<string, unknown>): GraphNode {
  return {
    id: String(row.id),
    type: String(row.type),
    label: String(row.label),
    payload: parseJson<JsonRecord>(row.payload_json, {}),
    status: row.status as GraphNode["status"],
    confidence: Number(row.confidence),
    scopeType: row.scope_type as GraphNode["scopeType"],
    scopeId: row.scope_id ? String(row.scope_id) : undefined,
    origin: String(row.origin),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    expiresAt: row.expires_at ? String(row.expires_at) : undefined
  };
}

function mapGraphEdge(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    sourceNodeId: String(row.source_node_id),
    relation: String(row.relation),
    targetNodeId: String(row.target_node_id),
    payload: parseJson<JsonRecord>(row.payload_json, {}),
    status: row.status as "candidate" | "active" | "superseded" | "expired" | "rejected" | "quarantined",
    confidence: Number(row.confidence),
    scopeType: row.scope_type as "global" | "profile" | "project" | "resource" | "worker" | "device",
    scopeId: row.scope_id ? String(row.scope_id) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapWorker(row: Record<string, unknown>): Worker {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    environment: String(row.environment),
    hostName: row.host_name ? String(row.host_name) : undefined,
    os: row.os ? String(row.os) : undefined,
    location: row.location ? String(row.location) : undefined,
    status: row.status as Worker["status"],
    metadata: parseJson<JsonRecord>(row.metadata_json, {}),
    lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapWorkerCapability(row: Record<string, unknown>): Capability {
  return {
    id: String(row.id),
    workerId: String(row.worker_id),
    name: String(row.name),
    risk: row.risk as RiskLevel,
    readOnly: Boolean(row.read_only),
    requiresConfirmation: Boolean(row.requires_confirmation),
    allowedScopes: parseJson<string[]>(row.allowed_scopes_json, []),
    inputSchema: parseJson<JsonRecord>(row.input_schema_json, {}),
    outputSchema: parseJson<JsonRecord>(row.output_schema_json, {}),
    enabled: row.enabled === undefined ? true : Boolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined
  };
}

function mapWorkerPathScope(row: Record<string, unknown>): WorkerPathScope {
  return {
    id: String(row.id),
    workerId: String(row.worker_id),
    label: String(row.label),
    path: String(row.path),
    mode: row.mode as WorkerPathScope["mode"],
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapWorkerJob(row: Record<string, unknown>): WorkerJob {
  return {
    id: String(row.id),
    workerId: String(row.worker_id),
    capability: String(row.capability),
    input: parseJson<JsonRecord>(row.input_json, {}),
    status: row.status as WorkerJobStatus,
    result: row.result_json ? parseJson<JsonRecord>(row.result_json, {}) : undefined,
    error: row.error ? String(row.error) : undefined,
    timeoutMs: Number(row.timeout_ms),
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined
  };
}

function mapAuditRecord(row: Record<string, unknown>): AuditRecord {
  return {
    id: String(row.id),
    actorType: row.actor_type as AuditRecord["actorType"],
    actorId: row.actor_id ? String(row.actor_id) : undefined,
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    payload: parseJson<JsonRecord>(row.payload_json, {}),
    createdAt: String(row.created_at)
  };
}

function mapMcpServer(row: Record<string, unknown>): McpServer {
  return {
    id: String(row.id),
    name: String(row.name),
    transport: row.transport as McpTransport,
    command: row.command ? String(row.command) : undefined,
    args: parseJson<string[]>(row.args_json, []),
    url: row.url ? String(row.url) : undefined,
    headers: parseJson<Record<string, string>>(row.headers_json, {}),
    enabled: Boolean(row.enabled),
    trustLevel: row.trust_level as McpTrustLevel,
    status: row.status as McpServerStatus,
    lastConnectedAt: row.last_connected_at ? String(row.last_connected_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapMcpTool(row: Record<string, unknown>): McpTool {
  return {
    id: String(row.id),
    serverId: String(row.server_id),
    name: String(row.name),
    title: String(row.title),
    description: String(row.description ?? ""),
    inputSchema: parseJson<JsonRecord>(row.input_schema_json, {}),
    outputSchema: parseJson<JsonRecord>(row.output_schema_json, {}),
    riskLevel: row.risk_level as RiskLevel,
    enabled: Boolean(row.enabled),
    requiresConfirmation: Boolean(row.requires_confirmation),
    lastSeenAt: String(row.last_seen_at)
  };
}

function mapMcpResource(row: Record<string, unknown>): McpResource {
  return {
    id: String(row.id),
    serverId: String(row.server_id),
    uri: String(row.uri),
    name: String(row.name),
    description: String(row.description ?? ""),
    mimeType: row.mime_type ? String(row.mime_type) : undefined,
    enabled: Boolean(row.enabled),
    lastSeenAt: String(row.last_seen_at)
  };
}

function mapMcpPrompt(row: Record<string, unknown>): McpPrompt {
  return {
    id: String(row.id),
    serverId: String(row.server_id),
    name: String(row.name),
    title: String(row.title),
    description: String(row.description ?? ""),
    argumentsSchema: parseJson<JsonRecord>(row.arguments_schema_json, {}),
    enabled: Boolean(row.enabled),
    lastSeenAt: String(row.last_seen_at)
  };
}

function mapToolRegistryEntry(row: Record<string, unknown>): ToolRegistryEntry {
  return {
    id: String(row.id),
    source: row.source as ToolRegistryEntry["source"],
    sourceId: String(row.source_id),
    name: String(row.name),
    title: String(row.title),
    description: String(row.description ?? ""),
    inputSchema: parseJson<JsonRecord>(row.input_schema_json, {}),
    outputSchema: parseJson<JsonRecord>(row.output_schema_json, {}),
    riskLevel: row.risk_level as RiskLevel,
    requiresConfirmation: Boolean(row.requires_confirmation),
    enabled: Boolean(row.enabled),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : undefined
  };
}

function mapSkillDefinition(row: Record<string, unknown>): SkillDefinition {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    sourceType: row.source_type as SkillSourceType,
    instructionMarkdown: String(row.instruction_markdown ?? ""),
    requiredTools: parseJson<string[]>(row.required_tools_json, []),
    riskLevel: row.risk_level as RiskLevel,
    enabled: Boolean(row.enabled),
    storagePath: row.storage_path ? String(row.storage_path) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapSkillRun(row: Record<string, unknown>): SkillRun {
  return {
    id: String(row.id),
    skillId: String(row.skill_id),
    agentRunId: row.agent_run_id ? String(row.agent_run_id) : undefined,
    status: row.status as SkillRun["status"],
    input: parseJson<JsonRecord>(row.input_json, {}),
    output: parseJson<JsonRecord>(row.output_json, {}),
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined
  };
}

function mapLlmProviderPreset(row: Record<string, unknown>): LlmProviderPreset {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    adapterType: row.adapter_type as LlmAdapterType,
    baseUrl: row.base_url ? String(row.base_url) : undefined,
    defaultModel: String(row.default_model),
    enabledByDefault: Boolean(row.enabled_by_default)
  };
}

function mapLlmProviderConfig(row: Record<string, unknown>): LlmProviderConfig {
  return {
    id: String(row.id),
    presetId: row.preset_id ? String(row.preset_id) : undefined,
    displayName: String(row.display_name),
    adapterType: row.adapter_type as LlmAdapterType,
    baseUrl: row.base_url ? String(row.base_url) : undefined,
    defaultModel: String(row.default_model),
    enabled: Boolean(row.enabled),
    hasApiKey: typeof row.api_key_secret === "string" && row.api_key_secret.length > 0,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapLlmProviderConfigWithSecret(row: Record<string, unknown>): LlmProviderConfigSecret {
  return {
    ...mapLlmProviderConfig(row),
    apiKey: row.api_key_secret ? String(row.api_key_secret) : undefined
  };
}

function mapLlmModelRoute(row: Record<string, unknown>): LlmModelRoute {
  return {
    purpose: row.purpose as LlmRoutePurpose,
    providerConfigId: String(row.provider_config_id),
    model: String(row.model),
    temperature: Number(row.temperature),
    maxTokens: Number(row.max_tokens),
    enabled: Boolean(row.enabled),
    updatedAt: String(row.updated_at)
  };
}

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  locale TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  related_conversation_id TEXT,
  related_message_id TEXT,
  related_node_id TEXT,
  related_worker_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT,
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  source_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  target_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  quote TEXT,
  artifact_ref TEXT,
  locale TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_candidates (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  proposed_node_type TEXT NOT NULL,
  proposed_relation TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL,
  risk TEXT NOT NULL,
  source_message_id TEXT,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  locale TEXT NOT NULL DEFAULT 'unknown',
  requires_confirmation INTEGER NOT NULL DEFAULT 0,
  decision_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_attributes (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  semantic_type TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT '{}',
  normalized_value TEXT NOT NULL,
  confidence REAL NOT NULL,
  risk TEXT NOT NULL,
  status TEXT NOT NULL,
  latest_evidence_id TEXT,
  requires_confirmation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_attribute_history (
  id TEXT PRIMARY KEY,
  attribute_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT,
  evidence_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  environment TEXT NOT NULL,
  host_name TEXT,
  os TEXT,
  location TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  credential_hash TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_pair_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS worker_capabilities (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  risk TEXT NOT NULL,
  read_only INTEGER NOT NULL,
  requires_confirmation INTEGER NOT NULL,
  allowed_scopes_json TEXT NOT NULL DEFAULT '[]',
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  output_schema_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_path_scopes (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  mode TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_jobs (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  timeout_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS worker_events (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  job_id TEXT,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_provider_presets (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  adapter_type TEXT NOT NULL,
  base_url TEXT,
  default_model TEXT NOT NULL,
  enabled_by_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS llm_provider_configs (
  id TEXT PRIMARY KEY,
  preset_id TEXT,
  display_name TEXT NOT NULL,
  adapter_type TEXT NOT NULL,
  base_url TEXT,
  api_key_secret TEXT,
  default_model TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_model_routes (
  purpose TEXT PRIMARY KEY,
  provider_config_id TEXT NOT NULL REFERENCES llm_provider_configs(id),
  model TEXT NOT NULL,
  temperature REAL NOT NULL,
  max_tokens INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL,
  command TEXT,
  args_json TEXT NOT NULL DEFAULT '[]',
  url TEXT,
  headers_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  trust_level TEXT NOT NULL DEFAULT 'untrusted',
  status TEXT NOT NULL DEFAULT 'unknown',
  last_connected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_tools (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  output_schema_json TEXT NOT NULL DEFAULT '{}',
  risk_level TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  requires_confirmation INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_resources (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  uri TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  mime_type TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_prompts (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  arguments_schema_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_registry (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  output_schema_json TEXT NOT NULL DEFAULT '{}',
  risk_level TEXT NOT NULL,
  requires_confirmation INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS skill_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL,
  instruction_markdown TEXT NOT NULL DEFAULT '',
  required_tools_json TEXT NOT NULL DEFAULT '[]',
  risk_level TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_runs (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skill_definitions(id) ON DELETE CASCADE,
  agent_run_id TEXT,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  completed_at TEXT
);
`;
