import { z } from "zod";

export const IsoDateStringSchema = z.string().datetime();

export const RiskLevelSchema = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ToolSourceSchema = z.enum(["internal", "mcp", "skill"]);
export type ToolSource = z.infer<typeof ToolSourceSchema>;

export const McpTransportSchema = z.enum(["stdio", "streamable_http"]);
export type McpTransport = z.infer<typeof McpTransportSchema>;

export const McpTrustLevelSchema = z.enum(["untrusted", "trusted", "first_party"]);
export type McpTrustLevel = z.infer<typeof McpTrustLevelSchema>;

export const McpServerStatusSchema = z.enum(["unknown", "connected", "failed", "disabled"]);
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;

export const SkillSourceTypeSchema = z.enum(["built_in", "local", "imported"]);
export type SkillSourceType = z.infer<typeof SkillSourceTypeSchema>;

export const SkillRunStatusSchema = z.enum(["running", "completed", "failed"]);
export type SkillRunStatus = z.infer<typeof SkillRunStatusSchema>;

export const MemoryStatusSchema = z.enum([
  "observed",
  "candidate",
  "active",
  "superseded",
  "expired",
  "rejected",
  "quarantined"
]);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export const ProfileSemanticTypeSchema = z.enum([
  "identity",
  "preference",
  "habit",
  "interest",
  "skill",
  "work_context",
  "communication_style",
  "lifestyle",
  "relationship",
  "location",
  "health",
  "finance",
  "sensitive",
  "other"
]);
export type ProfileSemanticType = z.infer<typeof ProfileSemanticTypeSchema>;

export const ProfilePatchOperationSchema = z.enum([
  "add",
  "update",
  "replace",
  "ignore",
  "conflict",
  "ask_confirmation"
]);
export type ProfilePatchOperation = z.infer<typeof ProfilePatchOperationSchema>;

export const GraphStatusSchema = z.enum([
  "candidate",
  "active",
  "superseded",
  "expired",
  "rejected",
  "quarantined"
]);
export type GraphStatus = z.infer<typeof GraphStatusSchema>;

export const ScopeTypeSchema = z.enum(["global", "profile", "project", "resource", "worker", "device"]);
export type ScopeType = z.infer<typeof ScopeTypeSchema>;

export const UiLocaleSchema = z.enum(["en", "zh-CN"]);
export type UiLocale = z.infer<typeof UiLocaleSchema>;

export const AssistantReplyLocaleSchema = z.enum(["follow_ui", "en", "zh-CN"]);
export type AssistantReplyLocale = z.infer<typeof AssistantReplyLocaleSchema>;

export const ResolvedAssistantReplyLocaleSchema = z.enum(["en", "zh-CN"]);
export type ResolvedAssistantReplyLocale = z.infer<typeof ResolvedAssistantReplyLocaleSchema>;

export const SettingsSchema = z.object({
  uiLocale: UiLocaleSchema,
  assistantReplyLocale: AssistantReplyLocaleSchema,
  updatedAt: IsoDateStringSchema
});
export type Settings = z.infer<typeof SettingsSchema>;

export const WebSearchProviderSchema = z.enum(["brave", "searxng", "duckduckgo", "bailian"]);
export type WebSearchProvider = z.infer<typeof WebSearchProviderSchema>;

export const WebToolsSettingsSchema = z.object({
  enabled: z.boolean(),
  searchProvider: WebSearchProviderSchema,
  searchMaxResults: z.number().int().min(1).max(10),
  fetchMaxChars: z.number().int().min(1000).max(50000),
  fetchTimeoutMs: z.number().int().min(1000).max(60000),
  searxngUrl: z.string().optional(),
  hasBraveApiKey: z.boolean(),
  hasDashscopeApiKey: z.boolean(),
  configured: z.boolean(),
  updatedAt: IsoDateStringSchema
});
export type WebToolsSettings = z.infer<typeof WebToolsSettingsSchema>;

export const LlmAdapterTypeSchema = z.enum([
  "openai-compatible",
  "openai-native",
  "anthropic",
  "gemini"
]);
export type LlmAdapterType = z.infer<typeof LlmAdapterTypeSchema>;

export const LlmRoutePurposeSchema = z.enum([
  "chat_reply",
  "memory_extraction",
  "summarization",
  "classification"
]);
export type LlmRoutePurpose = z.infer<typeof LlmRoutePurposeSchema>;

export const LlmProviderPresetSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  adapterType: LlmAdapterTypeSchema,
  baseUrl: z.string().optional(),
  defaultModel: z.string().min(1),
  enabledByDefault: z.boolean().default(false)
});
export type LlmProviderPreset = z.infer<typeof LlmProviderPresetSchema>;

export const LlmProviderConfigSchema = z.object({
  id: z.string().min(1),
  presetId: z.string().optional(),
  displayName: z.string().min(1),
  adapterType: LlmAdapterTypeSchema,
  baseUrl: z.string().optional(),
  defaultModel: z.string().min(1),
  enabled: z.boolean(),
  hasApiKey: z.boolean(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema
});
export type LlmProviderConfig = z.infer<typeof LlmProviderConfigSchema>;

export const LlmModelRouteSchema = z.object({
  purpose: LlmRoutePurposeSchema,
  providerConfigId: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(1).max(200000),
  enabled: z.boolean(),
  updatedAt: IsoDateStringSchema
});
export type LlmModelRoute = z.infer<typeof LlmModelRouteSchema>;

export const LlmProviderTestResultSchema = z.object({
  ok: z.boolean(),
  providerConfigId: z.string().min(1),
  adapterType: LlmAdapterTypeSchema,
  model: z.string().min(1),
  message: z.string().min(1)
});
export type LlmProviderTestResult = z.infer<typeof LlmProviderTestResultSchema>;

export const ConversationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["active", "archived"]).default("active"),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageRoleSchema = z.enum(["owner", "assistant", "system"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  role: MessageRoleSchema,
  content: z.string(),
  metadata: z.record(z.unknown()).default({}),
  locale: z.string().optional(),
  createdAt: IsoDateStringSchema
});
export type Message = z.infer<typeof MessageSchema>;

export const EventTypeSchema = z.enum([
  "conversation.created",
  "conversation.renamed",
  "conversation.deleted",
  "message.created",
  "memory.candidate_created",
  "memory.promoted",
  "memory.rejected",
  "memory.quarantined",
  "memory.extraction_failed",
  "profile.attribute_added",
  "profile.attribute_updated",
  "profile.attribute_ignored",
  "profile.attribute_conflict",
  "node.created",
  "edge.created",
  "task.suggested",
  "worker.registered",
  "worker.pair_code.created",
  "worker.paired",
  "worker.revoked",
  "worker.heartbeat",
  "worker.online",
  "worker.offline",
  "worker.capability.updated",
  "worker.path_scope.updated",
  "worker.job.created",
  "worker.job.started",
  "worker.job.completed",
  "worker.job.failed",
  "settings.updated",
  "web.tools.updated",
  "llm.provider.created",
  "llm.provider.updated",
  "llm.provider.disabled",
  "llm.route.updated",
  "mcp.server.created",
  "mcp.server.updated",
  "mcp.server.removed",
  "mcp.server.connected",
  "mcp.server.failed",
  "mcp.tools.refreshed",
  "mcp.tool.called",
  "mcp.tool.completed",
  "mcp.tool.failed",
  "skill.created",
  "skill.updated",
  "skill.imported",
  "skill.removed",
  "skill.enabled",
  "skill.disabled",
  "skill.run.started",
  "skill.run.completed",
  "skill.run.failed",
  "tool.policy.updated",
  "audit.recorded",
  "llm.error"
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventSchema = z.object({
  id: z.string().min(1),
  type: EventTypeSchema,
  title: z.string().min(1),
  body: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
  relatedConversationId: z.string().optional(),
  relatedMessageId: z.string().optional(),
  relatedNodeId: z.string().optional(),
  relatedWorkerId: z.string().optional(),
  createdAt: IsoDateStringSchema
});
export type Event = z.infer<typeof EventSchema>;

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  sourceType: z.enum(["message", "event", "artifact", "manual"]),
  sourceId: z.string().min(1),
  quote: z.string().optional(),
  artifactRef: z.string().optional(),
  locale: z.string().optional(),
  createdAt: IsoDateStringSchema
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const MemoryCandidateSchema = z.object({
  id: z.string().min(1),
  status: MemoryStatusSchema,
  kind: z.string().min(1),
  label: z.string().min(1),
  proposedNodeType: z.string().min(1),
  proposedRelation: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1),
  risk: RiskLevelSchema,
  sourceMessageId: z.string().optional(),
  evidenceIds: z.array(z.string()).default([]),
  locale: z.string().optional(),
  requiresConfirmation: z.boolean().default(false),
  decisionReason: z.string().optional(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema
});
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;

export const ProfilePatchProposalSchema = z.object({
  target: z.literal("owner_profile"),
  operation: ProfilePatchOperationSchema,
  attributeKey: z.string().min(1),
  semanticType: ProfileSemanticTypeSchema,
  value: z.record(z.unknown()).default({}),
  normalizedValue: z.string().min(1),
  confidence: z.number().min(0).max(1),
  risk: RiskLevelSchema,
  evidenceQuote: z.string().min(1),
  reason: z.string().min(1)
});
export type ProfilePatchProposal = z.infer<typeof ProfilePatchProposalSchema>;

export const ProfileAttributeHistorySchema = z.object({
  id: z.string().min(1),
  attributeId: z.string().min(1),
  operation: ProfilePatchOperationSchema,
  oldValue: z.record(z.unknown()).optional(),
  newValue: z.record(z.unknown()).optional(),
  evidenceId: z.string().optional(),
  reason: z.string().optional(),
  createdAt: IsoDateStringSchema
});
export type ProfileAttributeHistory = z.infer<typeof ProfileAttributeHistorySchema>;

export const ProfileAttributeSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  key: z.string().min(1),
  semanticType: ProfileSemanticTypeSchema,
  value: z.record(z.unknown()).default({}),
  normalizedValue: z.string().min(1),
  confidence: z.number().min(0).max(1),
  risk: RiskLevelSchema,
  status: MemoryStatusSchema,
  latestEvidenceId: z.string().optional(),
  requiresConfirmation: z.boolean().default(false),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
  history: z.array(ProfileAttributeHistorySchema).default([])
});
export type ProfileAttribute = z.infer<typeof ProfileAttributeSchema>;

export const OwnerProfileSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
  attributes: z.array(ProfileAttributeSchema).default([])
});
export type OwnerProfile = z.infer<typeof OwnerProfileSchema>;

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  status: GraphStatusSchema,
  confidence: z.number().min(0).max(1),
  scopeType: ScopeTypeSchema,
  scopeId: z.string().optional(),
  origin: z.string().min(1),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema,
  expiresAt: IsoDateStringSchema.optional()
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  relation: z.string().min(1),
  targetNodeId: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  status: GraphStatusSchema,
  confidence: z.number().min(0).max(1),
  scopeType: ScopeTypeSchema,
  scopeId: z.string().optional(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const AuditRecordSchema = z.object({
  id: z.string().min(1),
  actorType: z.enum(["owner", "assistant", "system", "worker"]),
  actorId: z.string().optional(),
  action: z.string().min(1),
  targetType: z.string().min(1),
  targetId: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  createdAt: IsoDateStringSchema
});
export type AuditRecord = z.infer<typeof AuditRecordSchema>;

export const McpServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  transport: McpTransportSchema,
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  url: z.string().optional(),
  headers: z.record(z.string()).default({}),
  enabled: z.boolean(),
  trustLevel: McpTrustLevelSchema,
  status: McpServerStatusSchema,
  lastConnectedAt: IsoDateStringSchema.optional(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema
});
export type McpServer = z.infer<typeof McpServerSchema>;

export const McpToolSchema = z.object({
  id: z.string().min(1),
  serverId: z.string().min(1),
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  inputSchema: z.record(z.unknown()).default({}),
  outputSchema: z.record(z.unknown()).default({}),
  riskLevel: RiskLevelSchema,
  enabled: z.boolean(),
  requiresConfirmation: z.boolean(),
  lastSeenAt: IsoDateStringSchema
});
export type McpTool = z.infer<typeof McpToolSchema>;

export const McpResourceSchema = z.object({
  id: z.string().min(1),
  serverId: z.string().min(1),
  uri: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  mimeType: z.string().optional(),
  enabled: z.boolean(),
  lastSeenAt: IsoDateStringSchema
});
export type McpResource = z.infer<typeof McpResourceSchema>;

export const McpPromptSchema = z.object({
  id: z.string().min(1),
  serverId: z.string().min(1),
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  argumentsSchema: z.record(z.unknown()).default({}),
  enabled: z.boolean(),
  lastSeenAt: IsoDateStringSchema
});
export type McpPrompt = z.infer<typeof McpPromptSchema>;

export const ToolRegistryEntrySchema = z.object({
  id: z.string().min(1),
  source: ToolSourceSchema,
  sourceId: z.string().min(1),
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  inputSchema: z.record(z.unknown()).default({}),
  outputSchema: z.record(z.unknown()).default({}),
  riskLevel: RiskLevelSchema,
  requiresConfirmation: z.boolean(),
  enabled: z.boolean(),
  lastUsedAt: IsoDateStringSchema.optional()
});
export type ToolRegistryEntry = z.infer<typeof ToolRegistryEntrySchema>;

export const SkillDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  sourceType: SkillSourceTypeSchema,
  instructionMarkdown: z.string().default(""),
  requiredTools: z.array(z.string()).default([]),
  riskLevel: RiskLevelSchema,
  enabled: z.boolean(),
  storagePath: z.string().optional(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema
});
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

export const SkillRunSchema = z.object({
  id: z.string().min(1),
  skillId: z.string().min(1),
  agentRunId: z.string().optional(),
  status: SkillRunStatusSchema,
  input: z.record(z.unknown()).default({}),
  output: z.record(z.unknown()).default({}),
  createdAt: IsoDateStringSchema,
  completedAt: IsoDateStringSchema.optional()
});
export type SkillRun = z.infer<typeof SkillRunSchema>;

export const WorkerStatusSchema = z.enum(["mock", "pending", "online", "offline", "revoked"]);
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

export const WorkerPathScopeModeSchema = z.enum(["read_only", "read_write"]);
export type WorkerPathScopeMode = z.infer<typeof WorkerPathScopeModeSchema>;

export const WorkerJobStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export type WorkerJobStatus = z.infer<typeof WorkerJobStatusSchema>;

export const WorkerSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  environment: z.string().min(1),
  hostName: z.string().optional(),
  os: z.string().optional(),
  location: z.string().optional(),
  status: WorkerStatusSchema,
  metadata: z.record(z.unknown()).default({}),
  lastSeenAt: IsoDateStringSchema.optional(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema
});
export type Worker = z.infer<typeof WorkerSchema>;

export const CapabilitySchema = z.object({
  id: z.string().min(1),
  workerId: z.string().optional(),
  name: z.string().min(1),
  risk: RiskLevelSchema,
  readOnly: z.boolean(),
  requiresConfirmation: z.boolean(),
  allowedScopes: z.array(z.string()).default([]),
  inputSchema: z.record(z.unknown()).default({}),
  outputSchema: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema.optional()
});
export type Capability = z.infer<typeof CapabilitySchema>;

export const WorkerPathScopeSchema = z.object({
  id: z.string().min(1),
  workerId: z.string().min(1),
  label: z.string().min(1),
  path: z.string().min(1),
  mode: WorkerPathScopeModeSchema,
  enabled: z.boolean(),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema
});
export type WorkerPathScope = z.infer<typeof WorkerPathScopeSchema>;

export const WorkerJobSchema = z.object({
  id: z.string().min(1),
  workerId: z.string().min(1),
  capability: z.string().min(1),
  input: z.record(z.unknown()).default({}),
  status: WorkerJobStatusSchema,
  result: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  timeoutMs: z.number().int().positive(),
  createdAt: IsoDateStringSchema,
  startedAt: IsoDateStringSchema.optional(),
  completedAt: IsoDateStringSchema.optional()
});
export type WorkerJob = z.infer<typeof WorkerJobSchema>;

export const WorkerEventSchema = z.object({
  id: z.string().min(1),
  workerId: z.string().min(1),
  jobId: z.string().optional(),
  type: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  createdAt: IsoDateStringSchema
});
export type WorkerEvent = z.infer<typeof WorkerEventSchema>;

export const GraphResponseSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  evidence: z.array(EvidenceSchema).default([])
});
export type GraphResponse = z.infer<typeof GraphResponseSchema>;
