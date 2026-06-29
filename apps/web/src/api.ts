import type {
  AssistantReplyLocale,
  AuditRecord,
  Conversation,
  Event,
  GraphResponse,
  LlmAdapterType,
  LlmRoutePurpose,
  MemoryCandidate,
  Message,
  RiskLevel,
  UiLocale,
  Worker
} from "@sedna/protocol";

const API_BASE = import.meta.env.VITE_SEDNA_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export interface SettingsResponse {
  ui_locale: UiLocale;
  assistant_reply_locale: AssistantReplyLocale;
  updated_at: string;
}

export interface LlmProviderPresetResponse {
  id: string;
  display_name: string;
  adapter_type: LlmAdapterType;
  base_url?: string;
  default_model: string;
  enabled_by_default: boolean;
}

export interface LlmProviderResponse {
  id: string;
  preset_id?: string;
  display_name: string;
  adapter_type: LlmAdapterType;
  base_url?: string;
  default_model: string;
  enabled: boolean;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
}

export interface LlmModelRouteResponse {
  purpose: LlmRoutePurpose;
  provider_config_id: string;
  model: string;
  temperature: number;
  max_tokens: number;
  enabled: boolean;
  updated_at: string;
}

export interface LlmProviderTestResponse {
  ok: boolean;
  provider_config_id: string;
  adapter_type: LlmAdapterType;
  model: string;
  message: string;
}

export interface McpServerResponse {
  id: string;
  name: string;
  transport: "stdio" | "streamable_http";
  command?: string;
  args: string[];
  url?: string;
  has_headers: boolean;
  enabled: boolean;
  trust_level: "untrusted" | "trusted" | "first_party";
  status: "unknown" | "connected" | "failed" | "disabled";
  last_connected_at?: string;
  created_at: string;
  updated_at: string;
}

export interface McpToolResponse {
  id: string;
  server_id: string;
  name: string;
  title: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  risk_level: RiskLevel;
  enabled: boolean;
  requires_confirmation: boolean;
  last_seen_at: string;
}

export interface ToolRegistryResponse {
  id: string;
  source: "internal" | "mcp" | "skill";
  source_id: string;
  name: string;
  title: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  risk_level: RiskLevel;
  requires_confirmation: boolean;
  enabled: boolean;
  last_used_at?: string;
}

export interface SkillResponse {
  id: string;
  name: string;
  description: string;
  source_type: "built_in" | "local" | "imported";
  instruction_markdown: string;
  required_tools: string[];
  risk_level: RiskLevel;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SkillRunResponse {
  id: string;
  skill_id: string;
  status: "running" | "completed" | "failed";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  created_at: string;
  completed_at?: string;
}

export async function getSettings(): Promise<SettingsResponse> {
  return request<SettingsResponse>("/api/settings");
}

export async function patchSettings(input: {
  ui_locale?: UiLocale;
  assistant_reply_locale?: AssistantReplyLocale;
}): Promise<SettingsResponse> {
  return request<SettingsResponse>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function getLlmProviderPresets(): Promise<LlmProviderPresetResponse[]> {
  return request<LlmProviderPresetResponse[]>("/api/llm/provider-presets");
}

export async function getLlmProviders(): Promise<LlmProviderResponse[]> {
  return request<LlmProviderResponse[]>("/api/llm/providers");
}

export async function createLlmProvider(input: {
  preset_id?: string;
  display_name: string;
  adapter_type: LlmAdapterType;
  base_url?: string;
  api_key?: string;
  default_model: string;
  enabled: boolean;
}): Promise<LlmProviderResponse> {
  return request<LlmProviderResponse>("/api/llm/providers", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function patchLlmProvider(id: string, input: Partial<{
  preset_id: string;
  display_name: string;
  adapter_type: LlmAdapterType;
  base_url: string | null;
  api_key: string;
  default_model: string;
  enabled: boolean;
}>): Promise<LlmProviderResponse> {
  return request<LlmProviderResponse>(`/api/llm/providers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function disableLlmProvider(id: string): Promise<LlmProviderResponse> {
  return request<LlmProviderResponse>(`/api/llm/providers/${id}`, { method: "DELETE" });
}

export async function testLlmProvider(id: string): Promise<LlmProviderTestResponse> {
  return request<LlmProviderTestResponse>(`/api/llm/providers/${id}/test`, { method: "POST" });
}

export async function getLlmRoutes(): Promise<LlmModelRouteResponse[]> {
  return request<LlmModelRouteResponse[]>("/api/llm/routes");
}

export async function patchLlmRoute(purpose: LlmRoutePurpose, input: Partial<{
  provider_config_id: string;
  model: string;
  temperature: number;
  max_tokens: number;
  enabled: boolean;
}>): Promise<LlmModelRouteResponse> {
  return request<LlmModelRouteResponse>(`/api/llm/routes/${purpose}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function createConversation(title: string): Promise<Conversation> {
  return request<Conversation>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ title })
  });
}

export async function getConversations(): Promise<Conversation[]> {
  return request<Conversation[]>("/api/conversations");
}

export async function getConversation(id: string): Promise<ConversationWithMessages> {
  return request<ConversationWithMessages>(`/api/conversations/${id}`);
}

export async function sendMessage(conversationId: string, content: string) {
  return request<{ ownerMessage: Message; assistantMessage: Message; candidates: MemoryCandidate[] }>(
    `/api/conversations/${conversationId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content })
    }
  );
}

export type MessageStreamEvent =
  | { type: "owner_message"; payload: { message: Message } }
  | { type: "assistant_status"; payload: { phase: string; title: string } }
  | { type: "assistant_delta"; payload: { content: string } }
  | { type: "assistant_message"; payload: { message: Message } }
  | { type: "memory_candidates"; payload: { candidates: MemoryCandidate[] } }
  | { type: "done"; payload: { ownerMessage: Message; assistantMessage: Message; candidates: MemoryCandidate[] } }
  | { type: "error"; payload: { message: string } };

export async function sendMessageStream(
  conversationId: string,
  content: string,
  onEvent: (event: MessageStreamEvent) => void
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/messages/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
  if (!response.ok || !response.body) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }
      onEvent(JSON.parse(line) as MessageStreamEvent);
    }
  }

  if (buffer.trim().length > 0) {
    onEvent(JSON.parse(buffer) as MessageStreamEvent);
  }
}

export async function getTimeline(): Promise<Array<Event | Message>> {
  return request<Array<Event | Message>>("/api/timeline");
}

export async function getCandidates(): Promise<MemoryCandidate[]> {
  return request<MemoryCandidate[]>("/api/memory/candidates");
}

export async function approveCandidate(id: string): Promise<MemoryCandidate> {
  return request<MemoryCandidate>(`/api/memory/candidates/${id}/approve`, { method: "POST" });
}

export async function rejectCandidate(id: string): Promise<MemoryCandidate> {
  return request<MemoryCandidate>(`/api/memory/candidates/${id}/reject`, { method: "POST" });
}

export async function editCandidate(id: string, label: string): Promise<MemoryCandidate> {
  return request<MemoryCandidate>(`/api/memory/candidates/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ label })
  });
}

export async function getGraph(view = "Profile"): Promise<GraphResponse> {
  return request<GraphResponse>(`/api/graph/views/${view}`);
}

export async function getWorkers(): Promise<Worker[]> {
  return request<Worker[]>("/api/workers");
}

export async function registerMockWorker(): Promise<Worker> {
  return request<Worker>("/api/workers/register-mock", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Home Mac mini",
      environment: "macos",
      location: "home",
      capabilities: [
        { name: "worker.status", risk: "low", readOnly: true, requiresConfirmation: false, allowedScopes: ["self"] },
        { name: "file.search", risk: "medium", readOnly: true, requiresConfirmation: true, allowedScopes: ["approved_paths"] }
      ]
    })
  });
}

export async function getAudit(): Promise<AuditRecord[]> {
  return request<AuditRecord[]>("/api/audit");
}

export async function getMcpServers(): Promise<McpServerResponse[]> {
  return request<McpServerResponse[]>("/api/mcp/servers");
}

export async function createMcpServer(input: {
  name: string;
  transport: "stdio" | "streamable_http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  trust_level: "untrusted" | "trusted" | "first_party";
}): Promise<McpServerResponse> {
  return request<McpServerResponse>("/api/mcp/servers", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function patchMcpServer(id: string, input: Partial<{
  name: string;
  transport: "stdio" | "streamable_http";
  command: string | null;
  args: string[];
  url: string | null;
  headers: Record<string, string>;
  enabled: boolean;
  trust_level: "untrusted" | "trusted" | "first_party";
}>): Promise<McpServerResponse> {
  return request<McpServerResponse>(`/api/mcp/servers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function disableMcpServer(id: string): Promise<McpServerResponse> {
  return request<McpServerResponse>(`/api/mcp/servers/${id}`, { method: "DELETE" });
}

export async function testMcpServer(id: string): Promise<{ ok: boolean; serverId: string; message: string }> {
  return request<{ ok: boolean; serverId: string; message: string }>(`/api/mcp/servers/${id}/test`, { method: "POST" });
}

export async function refreshMcpServer(id: string): Promise<{ tools: McpToolResponse[]; resources: unknown[]; prompts: unknown[] }> {
  return request<{ tools: McpToolResponse[]; resources: unknown[]; prompts: unknown[] }>(`/api/mcp/servers/${id}/refresh`, { method: "POST" });
}

export async function getTools(): Promise<ToolRegistryResponse[]> {
  return request<ToolRegistryResponse[]>("/api/tools");
}

export async function patchToolPolicy(id: string, input: Partial<{
  risk_level: RiskLevel;
  requires_confirmation: boolean;
  enabled: boolean;
}>): Promise<ToolRegistryResponse> {
  return request<ToolRegistryResponse>(`/api/tools/${id}/policy`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function testTool(id: string, input: Record<string, unknown> = {}): Promise<unknown> {
  return request<unknown>(`/api/tools/${id}/test`, {
    method: "POST",
    body: JSON.stringify({ input })
  });
}

export async function getSkills(): Promise<SkillResponse[]> {
  return request<SkillResponse[]>("/api/skills");
}

export async function createSkill(input: {
  name: string;
  description: string;
  instruction_markdown: string;
  required_tools: string[];
  risk_level: RiskLevel;
  enabled: boolean;
}): Promise<SkillResponse> {
  return request<SkillResponse>("/api/skills", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function patchSkill(id: string, input: Partial<{
  description: string;
  instruction_markdown: string;
  required_tools: string[];
  risk_level: RiskLevel;
  enabled: boolean;
}>): Promise<SkillResponse> {
  return request<SkillResponse>(`/api/skills/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function testSkillRun(id: string, input: Record<string, unknown> = {}): Promise<SkillRunResponse> {
  return request<SkillRunResponse>(`/api/skills/${id}/test`, {
    method: "POST",
    body: JSON.stringify({ input })
  });
}
