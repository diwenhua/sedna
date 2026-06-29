import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./index.js";

describe("memory store", () => {
  it("creates the MVP schema tables through migrations", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();

    const tableNames = store.listTables();

    expect(tableNames).toEqual(
      expect.arrayContaining([
        "conversations",
        "messages",
        "events",
        "nodes",
        "edges",
        "evidence",
        "memory_candidates",
        "audit_log",
        "workers",
        "worker_capabilities",
        "settings",
        "llm_provider_presets",
        "llm_provider_configs",
        "llm_model_routes"
      ])
    );
  });

  it("stores editable LLM providers and model routes without exposing API keys", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();

    const presetNames = store.listLlmProviderPresets().map((preset) => preset.displayName);
    expect(presetNames).toEqual(expect.arrayContaining(["OpenAI", "MiniMax", "Zhipu / Z.ai / GLM", "Volcengine Ark", "Alibaba Cloud Bailian / DashScope"]));

    const provider = store.createLlmProviderConfig({
      presetId: "deepseek",
      displayName: "DeepSeek private",
      adapterType: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "unit-test-placeholder",
      defaultModel: "deepseek-chat",
      enabled: true
    });

    expect(provider.hasApiKey).toBe(true);
    expect(provider).not.toHaveProperty("apiKey");
    expect(store.getLlmProviderConfigWithSecret(provider.id)?.apiKey).toBe("unit-test-placeholder");

    const route = store.updateLlmModelRoute("memory_extraction", {
      providerConfigId: provider.id,
      temperature: 0,
      maxTokens: 2000,
      enabled: true
    });

    expect(route.providerConfigId).toBe(provider.id);
    expect(route.model).toBe("deepseek-chat");
    expect(store.listEvents().map((event) => event.type)).toEqual(
      expect.arrayContaining(["llm.provider.created", "llm.route.updated"])
    );
    expect(store.listAuditRecords().map((record) => record.action)).toEqual(
      expect.arrayContaining(["llm.provider.created", "llm.route.updated"])
    );

    const disabled = store.disableLlmProviderConfig(provider.id);
    expect(disabled.enabled).toBe(false);
    expect(store.listEvents().map((event) => event.type)).toContain("llm.provider.disabled");
  });

  it("persists language settings and records audit and events", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();

    expect(store.getSettings()).toMatchObject({
      uiLocale: "en",
      assistantReplyLocale: "follow_ui"
    });

    const updated = store.updateSettings({
      uiLocale: "zh-CN",
      assistantReplyLocale: "zh-CN"
    });

    expect(updated).toMatchObject({
      uiLocale: "zh-CN",
      assistantReplyLocale: "zh-CN"
    });
    expect(store.listEvents().map((event) => event.type)).toContain("settings.updated");
    expect(store.listAuditRecords().map((record) => record.action)).toContain("settings.updated");
  });

  it("records a conversation message as timeline, memory candidates, graph, evidence, and audit data", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();

    const conversation = store.createConversation("First run");
    const result = store.addOwnerMessage(
      conversation.id,
      "I prefer concise implementation plans. My current project is Sedna Brain MVP."
    );

    const candidates = store.listMemoryCandidates();
    const graph = store.getGraph();
    const events = store.listEvents();
    const audit = store.listAuditRecords();

    expect(result.ownerMessage.role).toBe("owner");
    expect(result.assistantMessage.role).toBe("assistant");
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(graph.nodes.some((node) => node.label.includes("concise implementation plans"))).toBe(true);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["message.created", "memory.candidate_created", "memory.promoted"])
    );
    expect(audit.map((record) => record.action)).toEqual(
      expect.arrayContaining(["conversation.create", "message.create", "memory.promote"])
    );
  });

  it("approves, rejects, and edits memory candidates with audit records", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();

    const conversation = store.createConversation("Review");
    store.addOwnerMessage(conversation.id, "Never upload .env files.");
    const candidate = store.listMemoryCandidates({ status: "candidate" })[0];

    const edited = store.updateMemoryCandidate(candidate.id, {
      label: "Never upload environment files",
      payload: { value: "Never upload .env or environment files." }
    });
    const approved = store.approveMemoryCandidate(edited.id);
    const rejected = store.rejectMemoryCandidate(approved.id);

    expect(edited.label).toBe("Never upload environment files");
    expect(approved.status).toBe("active");
    expect(rejected.status).toBe("rejected");
    expect(store.listAuditRecords().map((record) => record.action)).toEqual(
      expect.arrayContaining(["memory.edit", "memory.approve", "memory.reject"])
    );
  });

  it("registers mock workers and exposes them as graph nodes", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();

    const worker = store.registerMockWorker({
      displayName: "Home Mac mini",
      environment: "macos",
      location: "home",
      capabilities: [
        {
          name: "worker.status",
          risk: "low",
          readOnly: true,
          requiresConfirmation: false,
          allowedScopes: ["self"]
        }
      ]
    });

    const workers = store.listWorkers();
    const graph = store.getGraph({ view: "Worker" });

    expect(workers[0]?.id).toBe(worker.id);
    expect(graph.nodes.some((node) => node.type === "worker" && node.label === "Home Mac mini")).toBe(true);
  });
});
