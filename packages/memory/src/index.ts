import { DatabaseSync } from "node:sqlite";
import { evaluateMemoryCandidate } from "@sedna/policy";
import type {
  AuditRecord,
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
  RiskLevel,
  Settings,
  SkillDefinition,
  SkillRun,
  SkillSourceType,
  ToolRegistryEntry,
  Worker
} from "@sedna/protocol";

type JsonRecord = Record<string, unknown>;

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
}

const DEFAULT_OWNER_NODE_ID = "node_owner";
const DEFAULT_MOCK_PROVIDER_ID = "provider_mock";

const LLM_PROVIDER_PRESETS: LlmProviderPreset[] = [
  { id: "mock", displayName: "Mock", adapterType: "mock", defaultModel: "mock-deterministic", enabledByDefault: true },
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
    this.seedLlmProviderPresets();
    this.ensureDefaultLlmProviderAndRoutes();
    this.ensureInternalTools();
    this.ensureBuiltInSkills();
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
    const mockProvider = this.requireLlmProviderConfig(DEFAULT_MOCK_PROVIDER_ID);
    const providerConfigId = patch.providerConfigId ?? current?.providerConfigId ?? mockProvider.id;
    const provider = this.requireLlmProviderConfig(providerConfigId);
    const providerChanged = Boolean(patch.providerConfigId && patch.providerConfigId !== current?.providerConfigId);
    const next = {
      providerConfigId,
      model: patch.model ?? (providerChanged ? provider.defaultModel : current?.model) ?? provider.defaultModel,
      temperature: patch.temperature ?? current?.temperature ?? 0.2,
      maxTokens: patch.maxTokens ?? current?.maxTokens ?? 1200,
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
    const normalizedQuery = query?.toLowerCase() ?? "";
    return this.db
      .prepare("SELECT * FROM nodes WHERE status = ? ORDER BY updated_at DESC LIMIT ?")
      .all("active", Math.max(limit * 3, limit))
      .map(mapGraphNode)
      .filter((node) => node.type !== "owner")
      .filter((node) => {
        if (!normalizedQuery) {
          return true;
        }
        const haystack = `${node.type} ${node.label} ${JSON.stringify(node.payload)}`.toLowerCase();
        return normalizedQuery
          .split(/\W+/)
          .filter((part) => part.length >= 4)
          .some((part) => haystack.includes(part));
      })
      .slice(0, limit);
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

    const candidates = this.extractMemories(content).map((memory) =>
      this.createMemoryCandidate(memory, ownerMessage)
    );
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
          return node.type === "worker" || node.type === "capability";
        }
        if (view === "profile") {
          return ["owner", "preference", "constraint", "goal"].includes(node.type);
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
         (id, display_name, environment, location, status, metadata_json, last_seen_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        worker.id,
        worker.displayName,
        worker.environment,
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
           (id, worker_id, name, risk, read_only, requires_confirmation, allowed_scopes_json, input_schema_json, output_schema_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    return this.db
      .prepare("SELECT * FROM workers ORDER BY created_at ASC")
      .all()
      .map(mapWorker);
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

  createSkill(input: SkillDefinitionInput): SkillDefinition {
    const now = nowIso();
    const skill: SkillDefinition = {
      id: createId("skill"),
      name: input.name,
      description: input.description,
      sourceType: input.sourceType ?? "local",
      instructionMarkdown: input.instructionMarkdown,
      requiredTools: input.requiredTools ?? [],
      riskLevel: input.riskLevel ?? "low",
      enabled: input.enabled ?? true,
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
    this.createEvent("skill.created", "Skill created", { skillId: skill.id, name: skill.name });
    this.createAuditRecord("owner", "skill.created", "skill", skill.id, {
      name: skill.name,
      sourceType: skill.sourceType,
      riskLevel: skill.riskLevel
    });
    return skill;
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
    this.updateSkill(id, { enabled: false });
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

  private extractMemories(content: string): ExtractedMemory[] {
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

    if (memories.length === 0 && content.trim()) {
      memories.push({
        kind: "observation",
        label: content.trim().slice(0, 120),
        proposedNodeType: "observation",
        payload: { value: content.trim() },
        confidence: 0.5,
        risk: "medium"
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

  private ensureDefaultLlmProviderAndRoutes(): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO llm_provider_configs
         (id, preset_id, display_name, adapter_type, base_url, api_key_secret, default_model, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        DEFAULT_MOCK_PROVIDER_ID,
        "mock",
        "Mock",
        "mock",
        null,
        null,
        "mock-deterministic",
        1,
        now,
        now
      );
    for (const purpose of LLM_ROUTE_PURPOSES) {
      const maxTokens = purpose === "memory_extraction" ? 2000 : 1200;
      this.db
        .prepare(
          `INSERT OR IGNORE INTO llm_model_routes
           (purpose, provider_config_id, model, temperature, max_tokens, enabled, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(purpose, DEFAULT_MOCK_PROVIDER_ID, "mock-deterministic", 0.2, maxTokens, 1, now);
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
      }
    ];
    for (const tool of internalTools) {
      this.upsertToolRegistryEntry(tool);
    }
  }

  private ensureBuiltInSkills(): void {
    const builtIns: SkillDefinition[] = [
      builtInSkill("onboarding", "Help Sedna learn the owner's goals, constraints, tools, and preferred working style.", ["suggest_action"]),
      builtInSkill("memory-review", "Review candidate memories and prepare safe approval or quarantine recommendations.", ["suggest_action"]),
      builtInSkill("planning", "Turn owner goals into tasks and next actions.", ["task.create", "suggest_action"]),
      builtInSkill("resource-learning", "Extract reusable insights, methods, and resources from owner-provided material.", ["suggest_action"]),
      builtInSkill("code-review-method", "Apply a structured code-review workflow focused on defects, tests, and risks.", ["suggest_action"])
    ];
    for (const skill of builtIns) {
      const existing = this.db.prepare("SELECT id FROM skill_definitions WHERE id = ?").get(skill.id);
      if (!existing) {
        this.insertSkill(skill);
      }
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
        requiresConfirmation: false,
        enabled: skill.enabled
      });
    }
  }

  private insertSkill(skill: SkillDefinition): void {
    this.db
      .prepare(
        `INSERT INTO skill_definitions
         (id, name, description, source_type, instruction_markdown, required_tools_json, risk_level, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        existingTool?.enabled ?? true ? 1 : 0,
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

  private requireMemoryCandidate(id: string): MemoryCandidate {
    const row = this.db.prepare("SELECT * FROM memory_candidates WHERE id = ?").get(id);
    if (!row) {
      throw new Error(`Memory candidate not found: ${id}`);
    }
    return mapMemoryCandidate(row);
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

function builtInSkill(name: string, description: string, requiredTools: string[]): SkillDefinition {
  const now = nowIso();
  return {
    id: `skill_builtin_${slugId(name)}`,
    name,
    description,
    sourceType: "built_in",
    instructionMarkdown: `# ${name}\n\n## Instructions\n${description}\n\n## Safety\nUse only policy-approved tools. Do not expose hidden chain-of-thought. Return audit-safe summaries and observations.`,
    requiredTools,
    riskLevel: "low",
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
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
    location: row.location ? String(row.location) : undefined,
    status: row.status as Worker["status"],
    metadata: parseJson<JsonRecord>(row.metadata_json, {}),
    lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
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
  location TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
