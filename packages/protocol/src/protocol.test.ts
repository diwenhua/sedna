import { describe, expect, it } from "vitest";
import {
  CapabilitySchema,
  SettingsSchema,
  GraphEdgeSchema,
  GraphNodeSchema,
  LlmModelRouteSchema,
  LlmProviderConfigSchema,
  LlmProviderPresetSchema,
  MemoryCandidateSchema,
  MessageSchema,
  WorkerJobSchema,
  WorkerPathScopeSchema
} from "./index.js";

describe("protocol schemas", () => {
  it("accepts core message and memory candidate shapes", () => {
    const message = MessageSchema.parse({
      id: "msg_1",
      conversationId: "conv_1",
      role: "owner",
      content: "I prefer concise implementation plans.",
      createdAt: "2026-06-29T00:00:00.000Z"
    });

    const candidate = MemoryCandidateSchema.parse({
      id: "mem_1",
      status: "candidate",
      kind: "preference",
      label: "Prefers concise implementation plans",
      proposedNodeType: "preference",
      payload: { value: "concise implementation plans" },
      confidence: 0.82,
      risk: "low",
      sourceMessageId: message.id,
      evidenceIds: ["ev_1"],
      createdAt: "2026-06-29T00:00:01.000Z",
      updatedAt: "2026-06-29T00:00:01.000Z"
    });

    expect(candidate.risk).toBe("low");
    expect(candidate.status).toBe("candidate");
  });

  it("rejects invalid risk levels", () => {
    expect(() =>
      MemoryCandidateSchema.parse({
        id: "mem_2",
        status: "candidate",
        kind: "constraint",
        label: "Invalid risk",
        proposedNodeType: "constraint",
        payload: {},
        confidence: 0.4,
        risk: "critical",
        evidenceIds: [],
        createdAt: "2026-06-29T00:00:00.000Z",
        updatedAt: "2026-06-29T00:00:00.000Z"
      })
    ).toThrow();
  });

  it("accepts scoped graph and worker capability entities", () => {
    const node = GraphNodeSchema.parse({
      id: "node_1",
      type: "worker",
      label: "Home Mac mini",
      payload: { environment: "macos" },
      status: "active",
      confidence: 1,
      scopeType: "global",
      origin: "mock",
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z"
    });

    const edge = GraphEdgeSchema.parse({
      id: "edge_1",
      sourceNodeId: node.id,
      relation: "declares_capability",
      targetNodeId: "node_2",
      payload: {},
      status: "active",
      confidence: 1,
      scopeType: "global",
      createdAt: "2026-06-29T00:00:01.000Z",
      updatedAt: "2026-06-29T00:00:01.000Z"
    });

    const capability = CapabilitySchema.parse({
      id: "cap_1",
      name: "worker.status",
      risk: "low",
      readOnly: true,
      requiresConfirmation: false,
      allowedScopes: ["self"],
      inputSchema: {},
      outputSchema: {},
      enabled: true,
      createdAt: "2026-06-29T00:00:02.000Z",
      updatedAt: "2026-06-29T00:00:02.000Z"
    });

    expect(edge.sourceNodeId).toBe(node.id);
    expect(capability.readOnly).toBe(true);
  });

  it("accepts worker path scopes and read-only jobs", () => {
    const scope = WorkerPathScopeSchema.parse({
      id: "scope_1",
      workerId: "worker_1",
      label: "Projects",
      path: "/Users/owner/Projects",
      mode: "read_only",
      enabled: true,
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z"
    });
    const job = WorkerJobSchema.parse({
      id: "job_1",
      workerId: scope.workerId,
      capability: "agent.execute",
      input: { goal: "Read README from /Users/owner/Projects" },
      status: "queued",
      timeoutMs: 30000,
      createdAt: "2026-06-29T00:00:01.000Z"
    });

    expect(job.capability).toBe("agent.execute");
    expect(scope.mode).toBe("read_only");
  });

  it("accepts language settings", () => {
    const settings = SettingsSchema.parse({
      uiLocale: "zh-CN",
      assistantReplyLocale: "follow_ui",
      updatedAt: "2026-06-29T00:00:00.000Z"
    });

    expect(settings.uiLocale).toBe("zh-CN");
    expect(settings.assistantReplyLocale).toBe("follow_ui");
  });

  it("accepts LLM provider presets, masked configs, and model routes", () => {
    const preset = LlmProviderPresetSchema.parse({
      id: "deepseek",
      displayName: "DeepSeek",
      adapterType: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      enabledByDefault: false
    });
    const config = LlmProviderConfigSchema.parse({
      id: "provider_1",
      presetId: preset.id,
      displayName: "DeepSeek personal",
      adapterType: "openai-compatible",
      baseUrl: preset.baseUrl,
      defaultModel: preset.defaultModel,
      enabled: true,
      hasApiKey: true,
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z"
    });
    const route = LlmModelRouteSchema.parse({
      purpose: "memory_extraction",
      providerConfigId: config.id,
      model: "deepseek-chat",
      temperature: 0,
      maxTokens: 2000,
      enabled: true,
      updatedAt: "2026-06-29T00:00:01.000Z"
    });

    expect(config).not.toHaveProperty("apiKey");
    expect(route.purpose).toBe("memory_extraction");
  });
});
