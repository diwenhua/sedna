import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { createMemoryStore, type MemoryStore } from "@sedna/memory";
import { runConversationMessageFlow } from "./conversations/message-flow.js";
import { syncLlmEnvConfig } from "./llm/config.js";
import { createRoutedLlmService } from "./llm/service.js";
import type { LlmProvider } from "./llm/provider.js";
import { refreshMcpServerTools, testMcpServer } from "./mcp/tool-sync.js";
import { executeTool } from "./tools/tool-executor.js";
import { listPolicyFilteredTools } from "./tools/tool-registry.js";
import { testSkill } from "./skills/skill-runner.js";

export interface BrainServerOptions {
  store?: MemoryStore;
  llmProvider?: LlmProvider;
  logger?: boolean;
}

const CreateConversationBody = z.object({
  title: z.string().min(1).optional()
});

const CreateMessageBody = z.object({
  content: z.string().min(1)
});

const UpdateCandidateBody = z.object({
  label: z.string().min(1).optional(),
  payload: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  risk: z.enum(["low", "medium", "high"]).optional()
});

const UpdateSettingsBody = z.object({
  ui_locale: z.enum(["en", "zh-CN"]).optional(),
  assistant_reply_locale: z.enum(["follow_ui", "en", "zh-CN"]).optional()
});

const ProviderBody = z.object({
  preset_id: z.string().optional(),
  display_name: z.string().min(1),
  adapter_type: z.enum(["mock", "openai-compatible", "openai-native", "anthropic", "gemini"]),
  base_url: z.string().optional(),
  api_key: z.string().optional(),
  default_model: z.string().min(1),
  enabled: z.boolean().default(true)
});

const ProviderPatchBody = ProviderBody.partial().extend({
  base_url: z.string().nullable().optional()
});

const RoutePatchBody = z.object({
  provider_config_id: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(200000).optional(),
  enabled: z.boolean().optional()
});

const RoutePurposeParam = z.enum(["chat_reply", "memory_extraction", "summarization", "classification"]);

const RegisterMockWorkerBody = z.object({
  displayName: z.string().min(1),
  environment: z.string().min(1),
  location: z.string().optional(),
  capabilities: z.array(
    z.object({
      name: z.string().min(1),
      risk: z.enum(["low", "medium", "high"]),
      readOnly: z.boolean(),
      requiresConfirmation: z.boolean(),
      allowedScopes: z.array(z.string()).optional()
    })
  ).default([])
});

const McpServerBody = z.object({
  name: z.string().min(1),
  transport: z.enum(["stdio", "streamable_http"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  enabled: z.boolean().default(true),
  trust_level: z.enum(["untrusted", "trusted", "first_party"]).default("untrusted")
});

const McpServerPatchBody = McpServerBody.partial().extend({
  command: z.string().nullable().optional(),
  url: z.string().nullable().optional()
});

const ToolPolicyPatchBody = z.object({
  risk_level: z.enum(["low", "medium", "high"]).optional(),
  requires_confirmation: z.boolean().optional(),
  enabled: z.boolean().optional()
});

const ToolTestBody = z.object({
  input: z.record(z.unknown()).default({})
});

const SkillBody = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  instruction_markdown: z.string().default(""),
  required_tools: z.array(z.string()).default([]),
  risk_level: z.enum(["low", "medium", "high"]).default("low"),
  enabled: z.boolean().default(true)
});

const SkillPatchBody = SkillBody.partial();

export function buildBrainServer(options: BrainServerOptions = {}): FastifyInstance {
  const store = options.store ?? createMemoryStore(process.env.SEDNA_DB_PATH ?? "apps/brain/data/sedna.sqlite");
  if (!options.store) {
    store.migrate();
    syncLlmEnvConfig(store);
  }
  const routedLlmService = createRoutedLlmService(store);
  const llmProvider = options.llmProvider ?? routedLlmService;

  const app = Fastify({ logger: options.logger ?? false });

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");
  });

  app.options("/*", async (_request, reply) => {
    return reply.status(204).send();
  });

  app.get("/api/health", async () => ({ ok: true, name: "sedna-brain" }));

  app.get("/api/settings", async () => toSettingsResponse(store.getSettings()));

  app.patch("/api/settings", async (request, reply) => {
    const body = UpdateSettingsBody.parse(request.body ?? {});
    const settings = store.updateSettings({
      uiLocale: body.ui_locale,
      assistantReplyLocale: body.assistant_reply_locale
    });
    return reply.send(toSettingsResponse(settings));
  });

  app.get("/api/llm/provider-presets", async () => store.listLlmProviderPresets().map(toProviderPresetResponse));

  app.get("/api/llm/providers", async () => store.listLlmProviderConfigs().map(toProviderResponse));

  app.post("/api/llm/providers", async (request, reply) => {
    const body = ProviderBody.parse(request.body ?? {});
    const provider = store.createLlmProviderConfig({
      presetId: body.preset_id,
      displayName: body.display_name,
      adapterType: body.adapter_type,
      baseUrl: body.base_url,
      apiKey: body.api_key,
      defaultModel: body.default_model,
      enabled: body.enabled
    });
    return reply.status(201).send(toProviderResponse(provider));
  });

  app.patch("/api/llm/providers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = ProviderPatchBody.parse(request.body ?? {});
    const provider = store.updateLlmProviderConfig(id, {
      presetId: body.preset_id,
      displayName: body.display_name,
      adapterType: body.adapter_type,
      baseUrl: body.base_url,
      apiKey: body.api_key,
      defaultModel: body.default_model,
      enabled: body.enabled
    });
    return reply.send(toProviderResponse(provider));
  });

  app.delete("/api/llm/providers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(toProviderResponse(store.disableLlmProviderConfig(id)));
  });

  app.post("/api/llm/providers/:id/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await routedLlmService.testProvider(id);
    return reply.send({
      ok: result.ok,
      provider_config_id: result.providerConfigId,
      adapter_type: result.adapterType,
      model: result.model,
      message: result.message
    });
  });

  app.get("/api/llm/routes", async () => store.listLlmModelRoutes().map(toRouteResponse));

  app.patch("/api/llm/routes/:purpose", async (request, reply) => {
    const { purpose } = request.params as { purpose: string };
    const parsedPurpose = RoutePurposeParam.parse(purpose);
    const body = RoutePatchBody.parse(request.body ?? {});
    const route = store.updateLlmModelRoute(parsedPurpose, {
      providerConfigId: body.provider_config_id,
      model: body.model,
      temperature: body.temperature,
      maxTokens: body.max_tokens,
      enabled: body.enabled
    });
    return reply.send(toRouteResponse(route));
  });

  app.post("/api/conversations", async (request, reply) => {
    const body = CreateConversationBody.parse(request.body ?? {});
    const conversation = store.createConversation(body.title ?? "New conversation");
    return reply.status(201).send(conversation);
  });

  app.get("/api/conversations", async () => store.listConversations());

  app.get("/api/conversations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const conversation = store.getConversation(id);
    if (!conversation) {
      return reply.status(404).send({ error: "Conversation not found" });
    }
    return conversation;
  });

  app.post("/api/conversations/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = CreateMessageBody.parse(request.body ?? {});
    if (!store.getConversation(id)) {
      return reply.status(404).send({ error: "Conversation not found" });
    }
    const result = await runConversationMessageFlow({
      store,
      provider: llmProvider,
      conversationId: id,
      content: body.content
    });
    return reply.status(201).send(result);
  });

  app.post("/api/conversations/:id/messages/stream", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = CreateMessageBody.parse(request.body ?? {});
    if (!store.getConversation(id)) {
      return reply.status(404).send({ error: "Conversation not found" });
    }

    reply.raw.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no"
    });
    reply.hijack();

    const writeEvent = (type: string, payload: unknown) => {
      reply.raw.write(`${JSON.stringify({ type, payload })}\n`);
    };

    try {
      const result = await runConversationMessageFlow({
        store,
        provider: llmProvider,
        conversationId: id,
        content: body.content,
        onProgress: (event) => writeEvent(event.type, event)
      });
      writeEvent("done", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected stream failure";
      writeEvent("error", { message });
    } finally {
      reply.raw.end();
    }
  });

  app.get("/api/timeline", async () => store.listTimeline());
  app.get("/api/events", async () => store.listEvents());

  app.get("/api/memory/candidates", async (request) => {
    const query = request.query as { status?: string };
    if (query.status) {
      return store.listMemoryCandidates({ status: query.status as never });
    }
    return store.listMemoryCandidates();
  });

  app.post("/api/memory/candidates/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(store.approveMemoryCandidate(id));
  });

  app.post("/api/memory/candidates/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(store.rejectMemoryCandidate(id));
  });

  app.patch("/api/memory/candidates/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateCandidateBody.parse(request.body ?? {});
    return reply.send(store.updateMemoryCandidate(id, body));
  });

  app.get("/api/graph", async () => store.getGraph());

  app.get("/api/graph/nodes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const node = store.getGraphNode(id);
    if (!node) {
      return reply.status(404).send({ error: "Graph node not found" });
    }
    return node;
  });

  app.get("/api/graph/views/:view", async (request) => {
    const { view } = request.params as { view: string };
    return store.getGraph({ view });
  });

  app.get("/api/workers", async () => store.listWorkers());

  app.post("/api/workers/register-mock", async (request, reply) => {
    const body = RegisterMockWorkerBody.parse(request.body ?? {});
    return reply.status(201).send(store.registerMockWorker(body));
  });

  app.get("/api/mcp/servers", async () => store.listMcpServers().map(toMcpServerResponse));

  app.post("/api/mcp/servers", async (request, reply) => {
    const body = McpServerBody.parse(request.body ?? {});
    const server = store.createMcpServer({
      name: body.name,
      transport: body.transport,
      command: body.command,
      args: body.args,
      url: body.url,
      headers: body.headers,
      enabled: body.enabled,
      trustLevel: body.trust_level
    });
    return reply.status(201).send(toMcpServerResponse(server));
  });

  app.patch("/api/mcp/servers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = McpServerPatchBody.parse(request.body ?? {});
    const server = store.updateMcpServer(id, {
      name: body.name,
      transport: body.transport,
      command: body.command,
      args: body.args,
      url: body.url,
      headers: body.headers,
      enabled: body.enabled,
      trustLevel: body.trust_level
    });
    return reply.send(toMcpServerResponse(server));
  });

  app.delete("/api/mcp/servers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(toMcpServerResponse(store.disableMcpServer(id)));
  });

  app.post("/api/mcp/servers/:id/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await testMcpServer(store, id));
  });

  app.post("/api/mcp/servers/:id/refresh", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await refreshMcpServerTools(store, id);
    return reply.send({
      tools: result.tools.map(toMcpToolResponse),
      resources: result.resources,
      prompts: result.prompts
    });
  });

  app.get("/api/mcp/servers/:id/tools", async (request) => {
    const { id } = request.params as { id: string };
    return store.listMcpTools(id).map(toMcpToolResponse);
  });

  app.get("/api/mcp/servers/:id/resources", async (request) => {
    const { id } = request.params as { id: string };
    return store.listMcpResources(id);
  });

  app.get("/api/mcp/servers/:id/prompts", async (request) => {
    const { id } = request.params as { id: string };
    return store.listMcpPrompts(id);
  });

  app.get("/api/tools", async () => listPolicyFilteredTools(store).map(toToolResponse));

  app.get("/api/tools/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tool = store.getToolRegistryEntry(id);
    if (!tool) {
      return reply.status(404).send({ error: "Tool not found" });
    }
    return reply.send(toToolResponse(tool));
  });

  app.post("/api/tools/:id/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = ToolTestBody.parse(request.body ?? {});
    return reply.send(await executeTool(store, id, body.input));
  });

  app.patch("/api/tools/:id/policy", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = ToolPolicyPatchBody.parse(request.body ?? {});
    return reply.send(toToolResponse(store.updateToolPolicy(id, {
      riskLevel: body.risk_level,
      requiresConfirmation: body.requires_confirmation,
      enabled: body.enabled
    })));
  });

  app.get("/api/skills", async () => store.listSkills().map(toSkillResponse));

  app.post("/api/skills", async (request, reply) => {
    const body = SkillBody.parse(request.body ?? {});
    return reply.status(201).send(toSkillResponse(store.createSkill({
      name: body.name,
      description: body.description,
      instructionMarkdown: body.instruction_markdown,
      requiredTools: body.required_tools,
      riskLevel: body.risk_level,
      enabled: body.enabled
    })));
  });

  app.patch("/api/skills/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = SkillPatchBody.parse(request.body ?? {});
    return reply.send(toSkillResponse(store.updateSkill(id, {
      description: body.description,
      instructionMarkdown: body.instruction_markdown,
      requiredTools: body.required_tools,
      riskLevel: body.risk_level,
      enabled: body.enabled
    })));
  });

  app.delete("/api/skills/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(toSkillResponse(store.deleteSkill(id)));
  });

  app.post("/api/skills/:id/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = ToolTestBody.parse(request.body ?? {});
    return reply.send(toSkillRunResponse(testSkill(store, id, body.input)));
  });

  app.get("/api/audit", async () => store.listAuditRecords());

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: "Invalid request", issues: error.issues });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return reply.status(500).send({ error: message });
  });

  return app;
}

function toSettingsResponse(settings: ReturnType<MemoryStore["getSettings"]>) {
  return {
    ui_locale: settings.uiLocale,
    assistant_reply_locale: settings.assistantReplyLocale,
    updated_at: settings.updatedAt
  };
}

function toProviderPresetResponse(preset: ReturnType<MemoryStore["listLlmProviderPresets"]>[number]) {
  return {
    id: preset.id,
    display_name: preset.displayName,
    adapter_type: preset.adapterType,
    base_url: preset.baseUrl,
    default_model: preset.defaultModel,
    enabled_by_default: preset.enabledByDefault
  };
}

function toProviderResponse(provider: ReturnType<MemoryStore["listLlmProviderConfigs"]>[number]) {
  return {
    id: provider.id,
    preset_id: provider.presetId,
    display_name: provider.displayName,
    adapter_type: provider.adapterType,
    base_url: provider.baseUrl,
    default_model: provider.defaultModel,
    enabled: provider.enabled,
    has_api_key: provider.hasApiKey,
    created_at: provider.createdAt,
    updated_at: provider.updatedAt
  };
}

function toRouteResponse(route: ReturnType<MemoryStore["listLlmModelRoutes"]>[number]) {
  return {
    purpose: route.purpose,
    provider_config_id: route.providerConfigId,
    model: route.model,
    temperature: route.temperature,
    max_tokens: route.maxTokens,
    enabled: route.enabled,
    updated_at: route.updatedAt
  };
}

function toMcpServerResponse(server: ReturnType<MemoryStore["listMcpServers"]>[number]) {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    has_headers: Object.keys(server.headers).length > 0,
    enabled: server.enabled,
    trust_level: server.trustLevel,
    status: server.status,
    last_connected_at: server.lastConnectedAt,
    created_at: server.createdAt,
    updated_at: server.updatedAt
  };
}

function toMcpToolResponse(tool: ReturnType<MemoryStore["listMcpTools"]>[number]) {
  return {
    id: tool.id,
    server_id: tool.serverId,
    name: tool.name,
    title: tool.title,
    description: tool.description,
    input_schema: tool.inputSchema,
    output_schema: tool.outputSchema,
    risk_level: tool.riskLevel,
    enabled: tool.enabled,
    requires_confirmation: tool.requiresConfirmation,
    last_seen_at: tool.lastSeenAt
  };
}

function toToolResponse(tool: ReturnType<MemoryStore["listToolRegistryEntries"]>[number]) {
  return {
    id: tool.id,
    source: tool.source,
    source_id: tool.sourceId,
    name: tool.name,
    title: tool.title,
    description: tool.description,
    input_schema: tool.inputSchema,
    output_schema: tool.outputSchema,
    risk_level: tool.riskLevel,
    requires_confirmation: tool.requiresConfirmation,
    enabled: tool.enabled,
    last_used_at: tool.lastUsedAt
  };
}

function toSkillResponse(skill: ReturnType<MemoryStore["listSkills"]>[number]) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    source_type: skill.sourceType,
    instruction_markdown: skill.instructionMarkdown,
    required_tools: skill.requiredTools,
    risk_level: skill.riskLevel,
    enabled: skill.enabled,
    created_at: skill.createdAt,
    updated_at: skill.updatedAt
  };
}

function toSkillRunResponse(run: ReturnType<MemoryStore["createSkillRun"]>) {
  return {
    id: run.id,
    skill_id: run.skillId,
    agent_run_id: run.agentRunId,
    status: run.status,
    input: run.input,
    output: run.output,
    created_at: run.createdAt,
    completed_at: run.completedAt
  };
}
