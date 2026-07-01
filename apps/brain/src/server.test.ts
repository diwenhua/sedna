import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import AdmZip from "adm-zip";
import { createMemoryStore } from "@sedna/memory";
import { buildBrainServer } from "./server.js";

function createMockStreamableMcpFetch(options?: {
  tools?: Array<Record<string, unknown>>;
}) {
  const tools = options?.tools ?? [
    {
      name: "mock.echo",
      title: "Echo",
      description: "Echo input text",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"]
      }
    },
    {
      name: "mock.external_write",
      title: "External write",
      description: "Write to an external target",
      inputSchema: {
        type: "object",
        properties: { target: { type: "string" } },
        required: ["target"]
      }
    }
  ];

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes("/mcp")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { id?: string | number; method?: string; params?: Record<string, unknown> };
    if (body.method === "initialize") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "2024-11-05", capabilities: {} }
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "mcp-session-id": "mock-session"
        }
      });
    }
    if (body.method === "notifications/initialized") {
      return new Response("", { status: 202 });
    }
    if (body.method === "tools/list") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", "mcp-session-id": "mock-session" }
      });
    }
    if (body.method === "tools/call") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(body.params ?? {}) }]
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", "mcp-session-id": "mock-session" }
      });
    }
    if (body.method === "resources/list" || body.method === "prompts/list") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: body.method === "resources/list" ? { resources: [] } : { prompts: [] }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", "mcp-session-id": "mock-session" }
      });
    }
    throw new Error(`Unexpected MCP method: ${body.method}`);
  };
}

function buildMultipartZip(filename: string, zipBuffer: Buffer, fieldName = "file"): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----sedna-test-boundary";
  const prefix = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
    `Content-Type: application/zip\r\n\r\n`
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([prefix, zipBuffer, suffix]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` }
  };
}

describe("Brain API", () => {
  it("reads and updates language settings through the Brain API", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const app = await buildBrainServer({ store });

    const initial = await app.inject({ method: "GET", url: "/api/settings" });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      ui_locale: "en",
      assistant_reply_locale: "follow_ui"
    });

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      payload: { ui_locale: "zh-CN", assistant_reply_locale: "zh-CN" }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      ui_locale: "zh-CN",
      assistant_reply_locale: "zh-CN"
    });

    expect(store.listEvents().map((event) => event.type)).toContain("settings.updated");
    expect(store.listAuditRecords().map((record) => record.action)).toContain("settings.updated");

    await app.close();
    store.close();
  });

  it("reads, updates, and tests web tools settings through the Brain API", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const app = await buildBrainServer({ store });

    const initial = await app.inject({ method: "GET", url: "/api/settings/web-tools" });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      enabled: true,
      search_provider: "duckduckgo",
      configured: true
    });

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/settings/web-tools",
      payload: {
        search_provider: "brave",
        brave_api_key: "test-brave-key"
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      search_provider: "brave",
      has_brave_api_key: true,
      configured: true
    });
    expect(store.listEvents().map((event) => event.type)).toContain("web.tools.updated");

    await app.close();
    store.close();
  });

  it("manages LLM providers and routes without returning API keys", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const app = await buildBrainServer({ store });

    const presets = await app.inject({ method: "GET", url: "/api/llm/provider-presets" });
    expect(presets.statusCode).toBe(200);
    expect(presets.json().map((preset: { display_name: string }) => preset.display_name)).toEqual(
      expect.arrayContaining(["OpenAI", "MiniMax", "Zhipu / Z.ai / GLM", "Volcengine Ark", "Alibaba Cloud Bailian / DashScope"])
    );

    const created = await app.inject({
      method: "POST",
      url: "/api/llm/providers",
      payload: {
        preset_id: "minimax",
        display_name: "MiniMax private",
        adapter_type: "openai-compatible",
        base_url: "https://api.minimax.chat/v1",
        api_key: "unit-test-placeholder",
        default_model: "MiniMax-Text-01",
        enabled: true
      }
    });
    expect(created.statusCode).toBe(201);
    const provider = created.json();
    expect(provider.has_api_key).toBe(true);
    expect(JSON.stringify(provider)).not.toContain("unit-test-placeholder");

    const providers = await app.inject({ method: "GET", url: "/api/llm/providers" });
    expect(JSON.stringify(providers.json())).not.toContain("unit-test-placeholder");

    const route = await app.inject({
      method: "PATCH",
      url: "/api/llm/routes/chat_reply",
      payload: {
        provider_config_id: provider.id,
        model: "MiniMax-Text-01",
        temperature: 0.3,
        max_tokens: 900,
        enabled: true
      }
    });
    expect(route.statusCode).toBe(200);
    expect(route.json()).toMatchObject({
      purpose: "chat_reply",
      provider_config_id: provider.id,
      model: "MiniMax-Text-01"
    });

    expect(store.listLlmProviderPresets().map((preset) => preset.id)).not.toContain("mock");
    expect(store.listLlmProviderConfigs().map((item) => item.adapterType)).not.toContain("mock");

    await app.inject({ method: "DELETE", url: `/api/llm/providers/${provider.id}` });
    expect(store.listEvents().map((event) => event.type)).toEqual(
      expect.arrayContaining(["llm.provider.created", "llm.route.updated", "llm.provider.disabled"])
    );
    expect(store.listAuditRecords().map((record) => record.action)).toEqual(
      expect.arrayContaining(["llm.provider.created", "llm.route.updated", "llm.provider.disabled"])
    );

    await app.close();
    store.close();
  });

  it("supports conversation, memory inbox, graph, worker, and audit endpoints", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const app = await buildBrainServer({
      store,
      llmProvider: {
        name: "fake-test-provider",
        async generateAssistantReply(input) {
          return { content: `Fake reply: ${input.ownerMessage}`, provider: "fake-test-provider", model: "test" };
        },
        async extractMemoryCandidates(input) {
          return {
            candidates: input.ownerMessage === "我是双鱼座" ? [] : [{
                  type: "preference",
                  label: "Prefers concise implementation plans",
                  subject: "owner",
                  predicate: "prefers",
                  object: "concise implementation plans",
                  scope_type: "profile",
                  scope_id: null,
                  confidence: 0.9,
                  risk: "low",
                  evidence_quote: input.ownerMessage
                }],
            profile_patches: input.ownerMessage === "我是双鱼座"
              ? [{
                  target: "owner_profile",
                  operation: "add",
                  attribute_key: "zodiac_sign",
                  semantic_type: "identity",
                  value: { sign: "双鱼座" },
                  normalized_value: "双鱼座",
                  confidence: 0.95,
                  risk: "low",
                  evidence_quote: "我是双鱼座",
                  reason: "The owner stated a stable profile attribute."
                }]
              : []
          };
        }
      }
    });

    const createdConversation = await app.inject({
      method: "POST",
      url: "/api/conversations",
      payload: { title: "MVP smoke" }
    });
    expect(createdConversation.statusCode).toBe(201);
    const conversation = createdConversation.json();

    const postedMessage = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/messages`,
      payload: { content: "I prefer concise implementation plans. My project is Sedna Brain MVP." }
    });
    expect(postedMessage.statusCode).toBe(201);
    expect(postedMessage.json().assistantMessage.content).toContain("Fake reply:");

    const candidates = await app.inject({ method: "GET", url: "/api/memory/candidates" });
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json().length).toBeGreaterThan(0);

    const candidate = candidates.json().find((item: { label: string }) => item.label.includes("implementation plans"));
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/memory/candidates/${candidate.id}`,
      payload: { label: "Sedna Brain MVP project" }
    });
    expect(edited.statusCode).toBe(200);

    const approved = await app.inject({
      method: "POST",
      url: `/api/memory/candidates/${candidate.id}/approve`
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe("active");

    const graph = await app.inject({ method: "GET", url: "/api/graph/views/Profile" });
    expect(graph.statusCode).toBe(200);
    expect(graph.json().nodes.length).toBeGreaterThan(0);
    const queryGraph = await app.inject({ method: "GET", url: "/api/graph?view=Profile" });
    expect(queryGraph.statusCode).toBe(200);
    expect(queryGraph.json().nodes.map((node: { type: string }) => node.type)).toEqual(expect.arrayContaining(["owner", "owner_profile"]));

    const zodiacMessage = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/messages`,
      payload: { content: "我是双鱼座" }
    });
    expect(zodiacMessage.statusCode).toBe(201);
    const profile = await app.inject({ method: "GET", url: "/api/profile" });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "zodiac_sign",
        semanticType: "identity",
        normalizedValue: "双鱼座"
      })
    ]));
    expect(graph.json().nodes.map((node: { type: string }) => node.type)).toEqual(expect.arrayContaining(["owner", "owner_profile"]));
    expect(store.getGraph().evidence.some((item) => item.quote === "我是双鱼座")).toBe(true);

    const pairCode = await app.inject({ method: "POST", url: "/api/workers/pair-codes", payload: { ttl_ms: 600000 } });
    const worker = await app.inject({
      method: "POST",
      url: "/api/workers/pair",
      payload: {
        code: pairCode.json().code,
        display_name: "Home Mac mini",
        environment_type: "macos",
        location: "home",
        capabilities: [{ name: "worker.status", risk: "low", read_only: true, requires_confirmation: false }]
      }
    });
    expect(worker.statusCode).toBe(201);

    const audit = await app.inject({ method: "GET", url: "/api/audit" });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().map((record: { action: string }) => record.action)).toContain("memory.approve");

    await app.close();
    store.close();
  });

  it("supports renaming and deleting conversations", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const app = await buildBrainServer({ store });

    const first = await app.inject({
      method: "POST",
      url: "/api/conversations",
      payload: { title: "Original title" }
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/conversations",
      payload: { title: "Delete me" }
    });

    const firstConversation = first.json();
    const secondConversation = second.json();
    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/conversations/${firstConversation.id}`,
      payload: { title: "Renamed conversation" }
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().title).toBe("Renamed conversation");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/conversations/${secondConversation.id}`
    });
    expect(deleted.statusCode).toBe(204);

    const conversations = await app.inject({ method: "GET", url: "/api/conversations" });
    expect(conversations.json().map((conversation: { id: string }) => conversation.id)).toEqual([firstConversation.id]);

    const missing = await app.inject({ method: "GET", url: `/api/conversations/${secondConversation.id}` });
    expect(missing.statusCode).toBe(404);

    expect(store.listEvents().map((event) => event.type)).toEqual(
      expect.arrayContaining(["conversation.renamed", "conversation.deleted"])
    );
    expect(store.listAuditRecords().map((record) => record.action)).toEqual(
      expect.arrayContaining(["conversation.rename", "conversation.delete"])
    );

    await app.close();
    store.close();
  });

  it("returns a clear provider configuration error when no LLM provider is configured", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const app = await buildBrainServer({ store });
    const conversation = store.createConversation("No provider");

    const postedMessage = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/messages`,
      payload: { content: "hello" }
    });

    expect(postedMessage.statusCode).toBe(201);
    expect(postedMessage.json().assistantMessage.content).toContain("No LLM provider configured. Configure one in Settings.");
    await app.close();
    store.close();
  });

  it("registers a worker, accepts heartbeat, dispatches a read-only job, and records result events", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const app = await buildBrainServer({ store });

    const pairCode = await app.inject({ method: "POST", url: "/api/workers/pair-codes", payload: { ttl_ms: 600000 } });
    expect(pairCode.statusCode).toBe(201);
    expect(pairCode.json().code).toBeDefined();

    const paired = await app.inject({
      method: "POST",
      url: "/api/workers/pair",
      payload: {
        code: pairCode.json().code,
        display_name: "Local worker",
        environment_type: "local",
        host_name: "test-host",
        os: "test-os",
        capabilities: [
          { name: "worker.status", risk: "low", read_only: true, requires_confirmation: false, allowed_scopes: ["self"] },
          { name: "file.search", risk: "low", read_only: true, requires_confirmation: false, allowed_scopes: ["approved_paths"] }
        ],
        path_scopes: [
          { label: "Temp", path: "/tmp/sedna-worker", mode: "read_only" }
        ]
      }
    });
    expect(paired.statusCode).toBe(201);
    expect(paired.json().credential).toMatch(/^sedna_worker_/);
    const worker = paired.json().worker;
    const auth = { authorization: `Bearer ${paired.json().credential}` };
    expect(worker.status).toBe("online");

    const heartbeat = await app.inject({
      method: "POST",
      url: `/api/workers/${worker.id}/heartbeat`,
      headers: auth,
      payload: { metadata: { pid: 123 } }
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json().lastSeenAt).toBeDefined();

    const job = await app.inject({
      method: "POST",
      url: "/api/worker-jobs",
      payload: {
        worker_id: worker.id,
        capability: "file.search",
        input: { query: "README", paths: ["/tmp/sedna-worker"], max_results: 10 }
      }
    });
    expect(job.statusCode).toBe(201);

    const pending = await app.inject({ method: "GET", url: `/api/workers/${worker.id}/jobs/pending`, headers: auth });
    expect(pending.statusCode).toBe(200);
    expect(pending.json()).toHaveLength(1);

    const started = await app.inject({ method: "POST", url: `/api/workers/${worker.id}/jobs/${job.json().id}/start`, headers: auth });
    expect(started.json().status).toBe("running");

    const completed = await app.inject({
      method: "POST",
      url: `/api/workers/${worker.id}/jobs/${job.json().id}/complete`,
      headers: auth,
      payload: { result: { matches: [] } }
    });
    expect(completed.json().status).toBe("completed");

    const detail = await app.inject({ method: "GET", url: `/api/workers/${worker.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().capabilities.map((capability: { name: string }) => capability.name)).toEqual(["file.search", "worker.status"]);
    expect(detail.json().recentJobs[0].status).toBe("completed");
    expect(store.listEvents().map((event) => event.type)).toEqual(expect.arrayContaining([
      "worker.registered",
      "worker.paired",
      "worker.heartbeat",
      "worker.job.created",
      "worker.job.started",
      "worker.job.completed"
    ]));
    expect(store.listAuditRecords().map((record) => record.action)).toContain("worker.job.complete");

    await app.close();
    store.close();
  });

  it("pairs workers with a one-time code and requires per-worker credentials", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const app = await buildBrainServer({ store });

    const rejectedRegister = await app.inject({
      method: "POST",
      url: "/api/workers/register",
      payload: { display_name: "Remote worker" }
    });
    expect(rejectedRegister.statusCode).toBe(410);

    const invalidPair = await app.inject({
      method: "POST",
      url: "/api/workers/pair",
      payload: { code: "WRONG-CODE", display_name: "Remote worker" }
    });
    expect(invalidPair.statusCode).toBe(400);

    const pairCode = await app.inject({ method: "POST", url: "/api/workers/pair-codes", payload: { ttl_ms: 600000 } });
    expect(pairCode.statusCode).toBe(201);

    const paired = await app.inject({
      method: "POST",
      url: "/api/workers/pair",
      payload: {
        code: pairCode.json().code,
        display_name: "Remote worker",
        capabilities: [
          { name: "worker.status", risk: "low", read_only: true, requires_confirmation: false }
        ]
      }
    });
    expect(paired.statusCode).toBe(201);
    const worker = paired.json().worker;
    const auth = { authorization: `Bearer ${paired.json().credential}` };

    const reusedPair = await app.inject({
      method: "POST",
      url: "/api/workers/pair",
      payload: { code: pairCode.json().code, display_name: "Another worker" }
    });
    expect(reusedPair.statusCode).toBe(400);

    const rejectedHeartbeat = await app.inject({
      method: "POST",
      url: `/api/workers/${worker.id}/heartbeat`,
      payload: { metadata: { pid: 123 } }
    });
    expect(rejectedHeartbeat.statusCode).toBe(401);

    const heartbeat = await app.inject({
      method: "POST",
      url: `/api/workers/${worker.id}/heartbeat`,
      headers: auth,
      payload: { metadata: { pid: 123 } }
    });
    expect(heartbeat.statusCode).toBe(200);

    const wrongHeartbeat = await app.inject({
      method: "POST",
      url: `/api/workers/${worker.id}/heartbeat`,
      headers: { authorization: "Bearer wrong-token" },
      payload: { metadata: { pid: 123 } }
    });
    expect(wrongHeartbeat.statusCode).toBe(401);

    const rejectedPending = await app.inject({
      method: "GET",
      url: `/api/workers/${worker.id}/jobs/pending`
    });
    expect(rejectedPending.statusCode).toBe(401);

    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/workers/${worker.id}`
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().status).toBe("revoked");

    const heartbeatAfterRevoke = await app.inject({
      method: "POST",
      url: `/api/workers/${worker.id}/heartbeat`,
      headers: auth,
      payload: { metadata: { pid: 123 } }
    });
    expect(heartbeatAfterRevoke.statusCode).toBe(401);
    const activeWorkers = await app.inject({ method: "GET", url: "/api/workers" });
    expect(activeWorkers.json().map((item: { id: string }) => item.id)).not.toContain(worker.id);
    const allWorkers = await app.inject({ method: "GET", url: "/api/workers?include_revoked=true" });
    expect(allWorkers.json().map((item: { id: string }) => item.id)).toContain(worker.id);
    expect(store.listEvents().map((event) => event.type)).toContain("worker.revoked");
    expect(store.listAuditRecords().map((record) => record.action)).toContain("worker.revoke");

    await app.close();
    store.close();
  });

  it("lets the owner manage worker capability and path scope policy", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const app = await buildBrainServer({ store });

    const pairCode = await app.inject({ method: "POST", url: "/api/workers/pair-codes", payload: { ttl_ms: 600000 } });
    const paired = await app.inject({
      method: "POST",
      url: "/api/workers/pair",
      payload: {
        code: pairCode.json().code,
        display_name: "Policy worker",
        environment_type: "local",
        capabilities: [
          { name: "file.read", risk: "medium", read_only: true, requires_confirmation: false, allowed_scopes: ["approved_paths"] }
        ],
        path_scopes: [{ label: "Workspace", path: "/tmp/sedna-worker", mode: "read_only" }]
      }
    });
    const worker = paired.json().worker;
    const capabilityId = store.listWorkerCapabilities(worker.id)[0].id;
    const auth = { authorization: `Bearer ${paired.json().credential}` };

    const patchedCapability = await app.inject({
      method: "PATCH",
      url: `/api/workers/${worker.id}/capabilities/${capabilityId}`,
      payload: { enabled: false, requires_confirmation: true, risk: "high" }
    });
    expect(patchedCapability.statusCode).toBe(200);
    expect(patchedCapability.json()).toMatchObject({
      enabled: false,
      requiresConfirmation: true,
      risk: "high"
    });

    const redeclared = await app.inject({
      method: "POST",
      url: `/api/workers/${worker.id}/capabilities`,
      headers: auth,
      payload: {
        name: "file.read",
        risk: "low",
        read_only: true,
        requires_confirmation: false,
        enabled: true,
        allowed_scopes: ["approved_paths"]
      }
    });
    expect(redeclared.statusCode).toBe(201);
    expect(redeclared.json()).toMatchObject({
      enabled: false,
      requiresConfirmation: true,
      risk: "high"
    });

    const createdScope = await app.inject({
      method: "POST",
      url: `/api/workers/${worker.id}/path-scopes`,
      payload: { label: "Docs", path: "/tmp/docs", mode: "read_only", enabled: true }
    });
    expect(createdScope.statusCode).toBe(201);

    const policy = await app.inject({ method: "GET", url: `/api/workers/${worker.id}/policy`, headers: auth });
    expect(policy.statusCode).toBe(200);
    expect(policy.json().pathScopes.map((scope: { path: string }) => scope.path)).toEqual(
      expect.arrayContaining(["/tmp/sedna-worker", "/tmp/docs"])
    );

    const deletedScope = await app.inject({
      method: "DELETE",
      url: `/api/workers/${worker.id}/path-scopes/${createdScope.json().id}`
    });
    expect(deletedScope.statusCode).toBe(204);

    await app.close();
    store.close();
  });

  it("supports MCP server discovery, tool registry policy, tool execution, and skills", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    vi.stubGlobal("fetch", createMockStreamableMcpFetch());
    const skillsDir = await mkdtemp(join(tmpdir(), "sedna-server-skills-"));
    const app = await buildBrainServer({ store, skillsDir });

    const created = await app.inject({
      method: "POST",
      url: "/api/mcp/servers",
      payload: {
        name: "Test streamable MCP",
        transport: "streamable_http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer test-key" },
        enabled: true,
        trust_level: "untrusted"
      }
    });
    expect(created.statusCode).toBe(201);
    const server = created.json();
    expect(server.has_headers).toBe(true);

    const tested = await app.inject({ method: "POST", url: `/api/mcp/servers/${server.id}/test` });
    expect(tested.statusCode).toBe(200);
    expect(tested.json()).toMatchObject({ ok: true });

    const refreshed = await app.inject({ method: "POST", url: `/api/mcp/servers/${server.id}/refresh` });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining(["mock.echo", "mock.external_write"])
    );

    const tools = await app.inject({ method: "GET", url: "/api/tools" });
    expect(tools.statusCode).toBe(200);
    const registryTools = tools.json();
    const echoTool = registryTools.find((tool: { source: string; name: string }) => tool.source === "mcp" && tool.name === "mock.echo");
    expect(echoTool).toMatchObject({
      source: "mcp",
      requires_confirmation: true,
      enabled: true
    });

    const policy = await app.inject({
      method: "PATCH",
      url: `/api/tools/${echoTool.id}/policy`,
      payload: { risk_level: "low", requires_confirmation: false, enabled: true }
    });
    expect(policy.statusCode).toBe(200);
    expect(policy.json()).toMatchObject({ requires_confirmation: false });

    const executed = await app.inject({
      method: "POST",
      url: `/api/tools/${echoTool.id}/test`,
      payload: { input: { text: "hello" } }
    });
    expect(executed.statusCode).toBe(200);
    expect(executed.json()).toMatchObject({ status: "completed" });

    const riskyTool = (await app.inject({ method: "GET", url: "/api/tools" })).json()
      .find((tool: { name: string }) => tool.name === "mock.external_write");
    const riskyExecution = await app.inject({
      method: "POST",
      url: `/api/tools/${riskyTool.id}/test`,
      payload: { input: { target: "external" } }
    });
    expect(riskyExecution.statusCode).toBe(200);
    expect(riskyExecution.json()).toMatchObject({ status: "confirmation_required" });

    const skills = await app.inject({ method: "GET", url: "/api/skills" });
    expect(skills.statusCode).toBe(200);
    expect(skills.json()).toEqual([]);

    const zip = new AdmZip();
    zip.addFile(
      "planning/SKILL.md",
      Buffer.from(`---
name: planning
description: Owner-defined planning workflow.
required_tools: task.create
risk_level: low
---
# Planning

Return audit-safe next steps.`)
    );
    const upload = buildMultipartZip("skills.zip", zip.toBuffer());
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/skills/upload",
      payload: upload.payload,
      headers: upload.headers
    });
    expect(uploaded.statusCode).toBe(201);
    const createdSkill = uploaded.json().imported[0];
    expect(createdSkill).toMatchObject({
      name: "planning",
      source_type: "imported",
      enabled: true
    });

    const skillRun = await app.inject({
      method: "POST",
      url: `/api/skills/${createdSkill.id}/test`,
      payload: { input: { goal: "organize next steps" } }
    });
    expect(skillRun.statusCode).toBe(200);
    expect(skillRun.json()).toMatchObject({ status: "completed", skill_id: createdSkill.id });

    const deleted = await app.inject({ method: "DELETE", url: `/api/skills/${createdSkill.id}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ ok: true, name: "planning" });
    expect((await app.inject({ method: "GET", url: "/api/skills" })).json()).toEqual([]);

    expect(store.listEvents().map((event) => event.type)).toEqual(
      expect.arrayContaining(["mcp.server.created", "mcp.tools.refreshed", "mcp.tool.completed", "skill.run.completed", "skill.imported", "skill.removed"])
    );
    expect(store.listAuditRecords().map((record) => record.action)).toEqual(
      expect.arrayContaining(["mcp.server.created", "mcp.tools.refreshed", "mcp.tool.completed", "skill.run.completed", "skill.imported", "skill.removed"])
    );

    await app.close();
    store.close();
    vi.unstubAllGlobals();
  });
});
