import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./index.js";
import type { ProfilePatchProposal } from "@sedna/protocol";

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
        "llm_model_routes",
        "profiles",
        "profile_attributes",
        "profile_attribute_history"
      ])
    );
  });

  it("stores editable LLM providers and model routes without exposing API keys", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();

    const presetNames = store.listLlmProviderPresets().map((preset) => preset.displayName);
    expect(presetNames).toEqual(expect.arrayContaining(["OpenAI", "MiniMax", "Zhipu / Z.ai / GLM", "Volcengine Ark", "Alibaba Cloud Bailian / DashScope"]));
    expect(store.listLlmProviderPresets().map((preset) => preset.id)).not.toContain("mock");
    expect(store.listLlmProviderConfigs()).toHaveLength(0);

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

  it("persists web tools settings and hot-swaps provider configuration", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();

    expect(store.getWebToolsSettings()).toMatchObject({
      enabled: true,
      searchProvider: "duckduckgo",
      configured: true
    });

    const updated = store.updateWebToolsSettings({
      searchProvider: "brave",
      braveApiKey: "secret-brave-key"
    });

    expect(updated).toMatchObject({
      searchProvider: "brave",
      hasBraveApiKey: true,
      configured: true
    });
    expect(store.getWebToolsConfig().braveApiKey).toBe("secret-brave-key");
    expect(store.listEvents().map((event) => event.type)).toContain("web.tools.updated");
    store.close();
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

  it("registers workers, heartbeats, and records read-only job lifecycle", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const worker = store.registerWorker({
      displayName: "Local worker",
      environment: "local",
      hostName: "test-host",
      os: "test-os",
      capabilities: [
        {
          name: "worker.status",
          risk: "low",
          readOnly: true,
          requiresConfirmation: false,
          allowedScopes: ["self"]
        },
        {
          name: "agent.execute",
          risk: "medium",
          readOnly: true,
          requiresConfirmation: false,
          allowedScopes: ["approved_paths"]
        }
      ],
      pathScopes: [
        { label: "Workspace", path: "/tmp/sedna-worker", mode: "read_only" }
      ]
    });

    expect(worker.status).toBe("online");
    expect(store.listWorkerCapabilities(worker.id).map((capability) => capability.name)).toEqual(["agent.execute", "worker.status"]);
    expect(store.listWorkerPathScopes(worker.id)[0]?.path).toBe("/tmp/sedna-worker");

    const heartbeat = store.heartbeatWorker(worker.id, { pid: 123 });
    expect(heartbeat.lastSeenAt).toBeDefined();

    const job = store.createWorkerJob({
      workerId: worker.id,
      capability: "agent.execute",
      input: { goal: "List files under /tmp/sedna-worker" }
    });
    expect(store.listWorkerJobs({ workerId: worker.id, status: "queued" })).toHaveLength(1);

    expect(store.startWorkerJob(worker.id, job.id).status).toBe("running");
    expect(store.completeWorkerJob(worker.id, job.id, {
      success: true,
      answer: "README.md is present.",
      steps: [{ tool: "file_list", summary: "1 entry" }]
    }).status).toBe("completed");
    expect(store.listEvents().map((event) => event.type)).toEqual(expect.arrayContaining([
      "worker.registered",
      "worker.heartbeat",
      "worker.job.created",
      "worker.job.started",
      "worker.job.completed"
    ]));
    expect(store.listAuditRecords().map((record) => record.action)).toEqual(expect.arrayContaining([
      "worker.register",
      "worker.job.create",
      "worker.job.start",
      "worker.job.complete"
    ]));
  });

  it("rejects agent.execute jobs without a goal", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const worker = store.registerWorker({
      displayName: "Local worker",
      environment: "local",
      capabilities: [
        {
          name: "agent.execute",
          risk: "medium",
          readOnly: true,
          requiresConfirmation: false,
          allowedScopes: ["approved_paths"]
        }
      ],
      pathScopes: [
        { label: "Workspace", path: "/tmp/sedna-worker", mode: "read_only" }
      ]
    });

    expect(() => store.createWorkerJob({
      workerId: worker.id,
      capability: "agent.execute",
      input: { context: "missing goal" }
    })).toThrow("requires goal");
  });

  it("accepts agent.execute jobs when the capability is mutating", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const worker = store.registerWorker({
      displayName: "Local worker",
      environment: "local",
      capabilities: [
        {
          name: "agent.execute",
          risk: "high",
          readOnly: false,
          requiresConfirmation: false,
          allowedScopes: ["self"]
        }
      ]
    });

    const job = store.createWorkerJob({
      workerId: worker.id,
      capability: "agent.execute",
      input: { goal: "Create /tmp/sedna-demo.txt with hello" }
    });

    expect(job.capability).toBe("agent.execute");
    expect(job.input.goal).toBe("Create /tmp/sedna-demo.txt with hello");
  });

  it("preserves owner capability policy when worker re-declares capabilities", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const worker = store.registerWorker({
      displayName: "Local worker",
      environment: "local",
      capabilities: [
        {
          name: "agent.execute",
          risk: "medium",
          readOnly: true,
          requiresConfirmation: false,
          enabled: true,
          allowedScopes: ["approved_paths"]
        }
      ]
    });

    store.updateWorkerCapabilityPolicy(worker.id, store.listWorkerCapabilities(worker.id)[0].id, {
      enabled: false,
      requiresConfirmation: true,
      risk: "high"
    });

    store.declareWorkerCapability(worker.id, {
      name: "agent.execute",
      risk: "low",
      readOnly: true,
      requiresConfirmation: false,
      enabled: true,
      allowedScopes: ["approved_paths"]
    });

    const capability = store.getWorkerPolicy(worker.id).capabilities[0];
    expect(capability.enabled).toBe(false);
    expect(capability.requiresConfirmation).toBe(true);
    expect(capability.risk).toBe("high");
  });

  it("removes undeclared worker capabilities during capability sync", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const worker = store.registerWorker({
      displayName: "Local worker",
      environment: "local",
      capabilities: [
        {
          name: "file.list",
          risk: "low",
          readOnly: true,
          requiresConfirmation: false,
          enabled: true,
          allowedScopes: ["approved_paths"]
        },
        {
          name: "worker.status",
          risk: "low",
          readOnly: true,
          requiresConfirmation: false,
          enabled: true,
          allowedScopes: ["self"]
        }
      ]
    });

    store.syncWorkerCapabilities(worker.id, [
      {
        name: "worker.status",
        risk: "low",
        readOnly: true,
        requiresConfirmation: false,
        enabled: true,
        allowedScopes: ["self"]
      },
      {
        name: "agent.execute",
        risk: "medium",
        readOnly: true,
        requiresConfirmation: false,
        enabled: true,
        allowedScopes: ["approved_paths"]
      }
    ]);

    expect(store.listWorkerCapabilities(worker.id).map((capability) => capability.name)).toEqual([
      "agent.execute",
      "worker.status"
    ]);
  });

  it("updates and deletes worker path scopes from owner policy", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const worker = store.registerWorker({
      displayName: "Local worker",
      environment: "local",
      pathScopes: [{ label: "Workspace", path: "/tmp/sedna-worker", mode: "read_only" }]
    });
    const scope = store.listWorkerPathScopes(worker.id)[0];
    const updated = store.updateWorkerPathScope(worker.id, scope.id, {
      label: "Docs",
      path: "/tmp/docs",
      enabled: false
    });
    expect(updated).toMatchObject({ label: "Docs", path: "/tmp/docs", enabled: false });
    store.deleteWorkerPathScope(worker.id, scope.id);
    expect(store.listWorkerPathScopes(worker.id)).toHaveLength(0);
  });

  it("hides revoked workers from the worker graph view", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const worker = store.registerWorker({
      displayName: "Local worker",
      environment: "local",
      capabilities: [
        {
          name: "agent.execute",
          risk: "medium",
          readOnly: true,
          requiresConfirmation: false,
          allowedScopes: ["approved_paths"]
        }
      ]
    });

    expect(store.getGraph({ view: "Worker" }).nodes.some((node) => node.type === "worker")).toBe(true);
    store.revokeWorker(worker.id);
    const workerGraph = store.getGraph({ view: "Worker" });
    expect(workerGraph.nodes.filter((node) => node.type === "worker")).toHaveLength(0);
    expect(workerGraph.nodes.filter((node) => node.type === "capability")).toHaveLength(0);
  });

  it("merges open vocabulary owner profile patch proposals", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Profile patches");
    const message = store.createMessage(conversation.id, "owner", "我比较典型双鱼", {});

    store.applyProfilePatchProposal(profilePatch({
      attributeKey: "zodiac_sign",
      semanticType: "identity",
      value: { sign: "双鱼座" },
      normalizedValue: "双鱼座",
      evidenceQuote: "我比较典型双鱼"
    }), message);

    const profile = store.getOwnerProfile();
    expect(profile.attributes).toHaveLength(1);
    expect(profile.attributes[0]).toMatchObject({
      key: "zodiac_sign",
      semanticType: "identity",
      normalizedValue: "双鱼座",
      status: "active"
    });
    expect(profile.attributes[0]?.history[0]).toMatchObject({ operation: "add" });
    expect(store.getGraph({ view: "Profile" }).nodes.map((node) => node.type)).toEqual(
      expect.arrayContaining(["owner", "owner_profile", "profile_attribute"])
    );
    const profileGraph = store.getGraph({ view: "Profile" });
    expect(profileGraph.edges.some((edge) => edge.relation === "has_attribute")).toBe(true);
    expect(profileGraph.nodes.some((node) => node.type === "profile_attribute" && node.label.includes("双鱼座"))).toBe(true);
  });

  it("imports legacy profile_fact candidates into owner profile attributes", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Legacy profile facts");
    const message = store.createMessage(conversation.id, "owner", "我是男生", {});

    store.createMemoryCandidatesFromMessage(message, [
      {
        kind: "profile_fact",
        label: "用户是男生",
        proposedNodeType: "profile_fact",
        proposedRelation: "has_gender",
        payload: {
          subject: "owner",
          predicate: "has_gender",
          object: "男生",
          scopeType: "profile",
          scopeId: null
        },
        confidence: 0.95,
        risk: "low",
        evidenceQuote: "我是男生"
      }
    ]);

    const profile = store.getOwnerProfile();

    expect(profile.attributes).toHaveLength(1);
    expect(profile.attributes[0]).toMatchObject({
      key: "gender",
      semanticType: "identity",
      normalizedValue: "男生",
      status: "active"
    });
    expect(store.getGraph().evidence.some((item) => item.quote === "我是男生")).toBe(true);
  });

  it("accepts unknown profile attribute keys and deduplicates normalized values", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Unknown profile key");
    const message = store.createMessage(conversation.id, "owner", "我平时更像夜猫子", {});
    const patch = profilePatch({
      attributeKey: "work_energy_pattern",
      semanticType: "habit",
      value: { pattern: "夜猫子" },
      normalizedValue: "night_owl",
      evidenceQuote: "我平时更像夜猫子"
    });

    store.applyProfilePatchProposal(patch, message);
    store.applyProfilePatchProposal(patch, message);

    const profile = store.getOwnerProfile();
    expect(profile.attributes).toHaveLength(1);
    expect(profile.attributes[0]).toMatchObject({
      key: "work_energy_pattern",
      semanticType: "habit",
      normalizedValue: "night_owl"
    });
    expect(profile.attributes[0]?.history.map((item) => item.operation)).toEqual(["add", "ignore"]);
  });

  it("marks same key different value as conflict unless replacement is explicit", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Profile conflict");
    const message = store.createMessage(conversation.id, "owner", "我做 AI infra", {});
    store.applyProfilePatchProposal(profilePatch({
      attributeKey: "role",
      semanticType: "work_context",
      value: { role: "AI infra" },
      normalizedValue: "ai_infra"
    }), message);

    const conflicted = store.applyProfilePatchProposal(profilePatch({
      attributeKey: "role",
      semanticType: "work_context",
      value: { role: "product" },
      normalizedValue: "product",
      reason: "The owner may be describing a different role."
    }), message);
    expect(conflicted).toMatchObject({ key: "role", status: "quarantined", requiresConfirmation: true });

    const replaced = store.applyProfilePatchProposal(profilePatch({
      operation: "replace",
      attributeKey: "role",
      semanticType: "work_context",
      value: { role: "AI product" },
      normalizedValue: "ai_product",
      reason: "The owner corrected the previous role."
    }), message);
    expect(replaced).toMatchObject({ key: "role", normalizedValue: "ai_product", status: "active" });
  });

  it("keeps high-risk profile attributes in review and still retrieves active profile attributes", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Profile risk");
    const message = store.createMessage(conversation.id, "owner", "我住在江边附近，也更习惯英文资料", {});
    const language = store.applyProfilePatchProposal(profilePatch({
      attributeKey: "preferred_language",
      semanticType: "communication_style",
      value: { language: "英文资料" },
      normalizedValue: "english_materials"
    }), message);
    const sensitive = store.applyProfilePatchProposal(profilePatch({
      operation: "ask_confirmation",
      attributeKey: "home_location_hint",
      semanticType: "location",
      value: { location: "江边附近" },
      normalizedValue: "江边附近",
      risk: "high"
    }), message);

    expect(language).toMatchObject({ status: "active" });
    expect(sensitive).toMatchObject({ status: "candidate", requiresConfirmation: true });
    expect(store.listActiveMemoryNodes("我习惯什么语言资料？")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "profile_attribute",
          payload: expect.objectContaining({ attributeKey: "preferred_language" })
        })
      ])
    );
  });

  it("retrieves active location profile attributes for implicit weather questions", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Profile weather");
    const message = store.createMessage(conversation.id, "owner", "我常驻城市是杭州", {});
    store.applyProfilePatchProposal(profilePatch({
      attributeKey: "home_city",
      semanticType: "location",
      value: { city: "杭州" },
      normalizedValue: "杭州"
    }), message);

    expect(store.listActiveMemoryNodes("明天天气怎么样")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "profile_attribute",
          payload: expect.objectContaining({ attributeKey: "home_city" })
        })
      ])
    );
  });

  it("retrieves gender profile attributes for outfit advice questions", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Profile outfit");
    const message = store.createMessage(conversation.id, "owner", "我是男生", {});
    store.applyProfilePatchProposal(profilePatch({
      attributeKey: "gender",
      semanticType: "identity",
      value: { gender: "男生" },
      normalizedValue: "男生"
    }), message);

    expect(store.listActiveMemoryNodes("明天穿什么")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "profile_attribute",
          payload: expect.objectContaining({ attributeKey: "gender" })
        })
      ])
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

function profilePatch(patch: Partial<ProfilePatchProposal> & Pick<ProfilePatchProposal, "attributeKey" | "semanticType" | "value" | "normalizedValue">): ProfilePatchProposal {
  return {
    target: "owner_profile",
    operation: patch.operation ?? "add",
    attributeKey: patch.attributeKey,
    semanticType: patch.semanticType,
    value: patch.value,
    normalizedValue: patch.normalizedValue,
    confidence: patch.confidence ?? 0.95,
    risk: patch.risk ?? "low",
    evidenceQuote: patch.evidenceQuote ?? "test evidence",
    reason: patch.reason ?? "Stable owner profile attribute."
  };
}
