import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@sedna/memory";
import { buildBrainServer } from "./server.js";

describe("Brain API", () => {
  it("reads and updates language settings through the Brain API", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const app = buildBrainServer({ store });

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

  it("manages LLM providers and routes without returning API keys", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const app = buildBrainServer({ store });

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

    const mockProvider = store.listLlmProviderConfigs().find((item) => item.adapterType === "mock");
    const test = await app.inject({ method: "POST", url: `/api/llm/providers/${mockProvider?.id}/test` });
    expect(test.statusCode).toBe(200);
    expect(test.json()).toMatchObject({ ok: true, adapter_type: "mock" });

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
    const app = buildBrainServer({ store });

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
    expect(postedMessage.json().assistantMessage.content).toBe(
      "Sedna heard: I prefer concise implementation plans. My project is Sedna Brain MVP."
    );

    const candidates = await app.inject({ method: "GET", url: "/api/memory/candidates" });
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json().length).toBeGreaterThan(0);

    const candidate = candidates.json().find((item: { status: string }) => item.status === "candidate");
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

    const worker = await app.inject({
      method: "POST",
      url: "/api/workers/register-mock",
      payload: {
        displayName: "Home Mac mini",
        environment: "macos",
        location: "home",
        capabilities: [{ name: "worker.status", risk: "low", readOnly: true, requiresConfirmation: false }]
      }
    });
    expect(worker.statusCode).toBe(201);

    const audit = await app.inject({ method: "GET", url: "/api/audit" });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().map((record: { action: string }) => record.action)).toContain("memory.approve");

    await app.close();
    store.close();
  });

  it("supports MCP server discovery, tool registry policy, tool execution, and skills", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const app = buildBrainServer({ store });

    const created = await app.inject({
      method: "POST",
      url: "/api/mcp/servers",
      payload: {
        name: "Mock stdio MCP",
        transport: "stdio",
        command: "mock-stdio",
        args: [],
        enabled: true,
        trust_level: "untrusted"
      }
    });
    expect(created.statusCode).toBe(201);
    const server = created.json();
    expect(server.has_headers).toBe(false);

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
    expect(skills.json().map((skill: { name: string }) => skill.name)).toEqual(
      expect.arrayContaining(["onboarding", "memory-review", "planning", "resource-learning", "code-review-method"])
    );
    const planning = skills.json().find((skill: { name: string }) => skill.name === "planning");
    const skillRun = await app.inject({
      method: "POST",
      url: `/api/skills/${planning.id}/test`,
      payload: { input: { goal: "organize next steps" } }
    });
    expect(skillRun.statusCode).toBe(200);
    expect(skillRun.json()).toMatchObject({ status: "completed", skill_id: planning.id });

    expect(store.listEvents().map((event) => event.type)).toEqual(
      expect.arrayContaining(["mcp.server.created", "mcp.tools.refreshed", "mcp.tool.completed", "skill.run.completed"])
    );
    expect(store.listAuditRecords().map((record) => record.action)).toEqual(
      expect.arrayContaining(["mcp.server.created", "mcp.tools.refreshed", "mcp.tool.completed", "skill.run.completed"])
    );

    await app.close();
    store.close();
  });
});
