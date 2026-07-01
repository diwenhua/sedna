import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@sedna/memory";
import { runConversationMessageFlow } from "./message-flow.js";
import type { LlmProvider } from "../llm/provider.js";

describe("conversation message flow", () => {
  it("uses an online worker file.search result as reply context", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Worker search");
    const worker = store.registerWorker({
      displayName: "Test Worker",
      environment: "local",
      capabilities: [
        {
          name: "file.search",
          risk: "low",
          readOnly: true,
          requiresConfirmation: false,
          enabled: true,
          allowedScopes: ["approved_paths"],
          inputSchema: {},
          outputSchema: {}
        }
      ],
      pathScopes: [
        {
          label: "project",
          path: "/tmp/sedna-worker",
          mode: "read_only",
          enabled: true
        }
      ]
    });
    let observedWorkerContext = "";
    const workerPump = setInterval(() => {
      for (const job of store.listWorkerJobs({ workerId: worker.id, status: "queued" })) {
        store.startWorkerJob(worker.id, job.id);
        store.completeWorkerJob(worker.id, job.id, {
          matches: [
            {
              path: "/tmp/sedna-worker/README.md",
              name: "README.md",
              size: 123,
              modified_at: "2026-06-30T00:00:00.000Z"
            }
          ]
        });
      }
    }, 5);

    try {
      const result = await runConversationMessageFlow({
        store,
        provider: {
          name: "worker-aware-fake",
          async generateAssistantReply(input) {
            observedWorkerContext = input.workerContext ?? "";
            return { content: observedWorkerContext.includes("README.md") ? "找到了 README.md。" : "没有 worker 结果。", provider: "worker-aware-fake" };
          },
          async extractMemoryCandidates() {
            return { candidates: [] };
          }
        },
        conversationId: conversation.id,
        content: "帮我在本地搜索 README"
      });

      expect(result.assistantMessage.content).toBe("找到了 README.md。");
      expect(observedWorkerContext).toContain("file.search");
      expect(observedWorkerContext).toContain("README.md");
      expect(store.listWorkerJobs({ workerId: worker.id })[0]).toMatchObject({
        capability: "file.search",
        status: "completed"
      });
      expect(store.listEvents().map((event) => event.type)).toEqual(expect.arrayContaining([
        "worker.job.created",
        "worker.job.completed"
      ]));
    } finally {
      clearInterval(workerPump);
      store.close();
    }
  });

  it("uses an online worker file.list result as reply context", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Worker list");
    const worker = store.registerWorker({
      displayName: "Test Worker",
      environment: "local",
      capabilities: [
        {
          name: "file.list",
          risk: "low",
          readOnly: true,
          requiresConfirmation: false,
          enabled: true,
          allowedScopes: ["approved_paths"],
          inputSchema: {},
          outputSchema: {}
        }
      ],
      pathScopes: [
        {
          label: "project",
          path: "/tmp/sedna-worker",
          mode: "read_only",
          enabled: true
        }
      ]
    });
    let observedWorkerContext = "";
    const workerPump = setInterval(() => {
      for (const job of store.listWorkerJobs({ workerId: worker.id, status: "queued" })) {
        store.startWorkerJob(worker.id, job.id);
        store.completeWorkerJob(worker.id, job.id, {
          path: "/tmp/sedna-worker",
          entries: [
            { path: "/tmp/sedna-worker/README.md", name: "README.md", type: "file", size: 123, modified_at: "2026-06-30T00:00:00.000Z" }
          ],
          truncated: false
        });
      }
    }, 5);

    try {
      const result = await runConversationMessageFlow({
        store,
        provider: {
          name: "worker-list-fake",
          async generateAssistantReply(input) {
            observedWorkerContext = input.workerContext ?? "";
            return { content: observedWorkerContext.includes("file.list") && observedWorkerContext.includes("README.md") ? "目录里有 README.md。" : "没有目录结果。", provider: "worker-list-fake" };
          },
          async extractMemoryCandidates() {
            return { candidates: [] };
          }
        },
        conversationId: conversation.id,
        content: "列出 /tmp/sedna-worker 下面有哪些文件"
      });

      expect(result.assistantMessage.content).toBe("目录里有 README.md。");
      expect(observedWorkerContext).toContain("file.list");
      expect(store.listWorkerJobs({ workerId: worker.id })[0]).toMatchObject({
        capability: "file.list",
        status: "completed"
      });
    } finally {
      clearInterval(workerPump);
      store.close();
    }
  });

  it("prefers file.list when the message mentions Local Worker and files", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Local Worker list");
    const worker = store.registerWorker({
      displayName: "Local Worker",
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
      ],
      pathScopes: [
        { label: "project", path: "/tmp/sedna-worker", mode: "read_only", enabled: true }
      ]
    });
    let observedWorkerContext = "";
    const workerPump = setInterval(() => {
      for (const job of store.listWorkerJobs({ workerId: worker.id, status: "queued" })) {
        store.startWorkerJob(worker.id, job.id);
        store.completeWorkerJob(worker.id, job.id, {
          path: "/tmp/sedna-worker",
          entries: [{ path: "/tmp/sedna-worker/README.md", name: "README.md", type: "file", size: 1, modified_at: "2026-06-30T00:00:00.000Z" }],
          truncated: false
        });
      }
    }, 5);

    try {
      const result = await runConversationMessageFlow({
        store,
        provider: {
          name: "local-worker-list-fake",
          async generateAssistantReply(input) {
            observedWorkerContext = input.workerContext ?? "";
            return {
              content: observedWorkerContext.includes("file.list") ? "已列出 Local Worker 文件。" : "没有 file.list 结果。",
              provider: "local-worker-list-fake"
            };
          },
          async extractMemoryCandidates() {
            return { candidates: [] };
          }
        },
        conversationId: conversation.id,
        content: "列出 Local Worker 允许路径下有哪些文件"
      });

      expect(observedWorkerContext).toContain("file.list");
      expect(result.assistantMessage.content).toContain("已列出");
    } finally {
      clearInterval(workerPump);
      store.close();
    }
  });

  it("reads an explicit local file path without including trailing Chinese text in the path", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Worker read");
    const worker = store.registerWorker({
      displayName: "Test Worker",
      environment: "local",
      capabilities: [
        {
          name: "file.read",
          risk: "medium",
          readOnly: true,
          requiresConfirmation: false,
          enabled: true,
          allowedScopes: ["approved_paths"],
          inputSchema: {},
          outputSchema: {}
        }
      ],
      pathScopes: [
        { label: "project", path: "/tmp/sedna-worker", mode: "read_only", enabled: true }
      ]
    });
    let createdInput: Record<string, unknown> | undefined;
    const workerPump = setInterval(() => {
      for (const job of store.listWorkerJobs({ workerId: worker.id, status: "queued" })) {
        createdInput = job.input;
        store.startWorkerJob(worker.id, job.id);
        store.completeWorkerJob(worker.id, job.id, {
          path: "/tmp/sedna-worker/README.zh-CN.md",
          content: "# Sedna 中文说明",
          truncated: false,
          size: 14
        });
      }
    }, 5);

    try {
      const result = await runConversationMessageFlow({
        store,
        provider: {
          name: "worker-read-fake",
          async generateAssistantReply(input) {
            return { content: input.workerContext?.includes("Sedna 中文说明") ? "读到了中文 README。" : "没有读取结果。", provider: "worker-read-fake" };
          },
          async extractMemoryCandidates() {
            return { candidates: [] };
          }
        },
        conversationId: conversation.id,
        content: "读取 /tmp/sedna-worker/README.zh-CN.md里面都写了什么？"
      });

      expect(result.assistantMessage.content).toBe("读到了中文 README。");
      expect(createdInput).toMatchObject({ path: "/tmp/sedna-worker/README.zh-CN.md" });
    } finally {
      clearInterval(workerPump);
      store.close();
    }
  });

  it("uses the most specific worker path scope for file.search", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Worker search scope");
    const worker = store.registerWorker({
      displayName: "Test Worker",
      environment: "local",
      capabilities: [
        {
          name: "file.search",
          risk: "low",
          readOnly: true,
          requiresConfirmation: false,
          enabled: true,
          allowedScopes: ["approved_paths"],
          inputSchema: {},
          outputSchema: {}
        }
      ],
      pathScopes: [
        { label: "old-wide", path: "/tmp", mode: "read_only", enabled: true },
        { label: "project", path: "/tmp/sedna-worker", mode: "read_only", enabled: true }
      ]
    });
    let createdInput: Record<string, unknown> | undefined;
    const workerPump = setInterval(() => {
      for (const job of store.listWorkerJobs({ workerId: worker.id, status: "queued" })) {
        createdInput = job.input;
        store.startWorkerJob(worker.id, job.id);
        store.completeWorkerJob(worker.id, job.id, { matches: [] });
      }
    }, 5);

    try {
      await runConversationMessageFlow({
        store,
        provider: {
          name: "worker-search-scope-fake",
          async generateAssistantReply() {
            return { content: "搜索完成。", provider: "worker-search-scope-fake" };
          },
          async extractMemoryCandidates() {
            return { candidates: [] };
          }
        },
        conversationId: conversation.id,
        content: "帮我在本地搜索 README"
      });

      expect(createdInput).toMatchObject({ paths: ["/tmp/sedna-worker"] });
    } finally {
      clearInterval(workerPump);
      store.close();
    }
  });

  it("includes registered worker inventory in reply context when the owner asks about workers", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Worker inventory");
    store.registerWorker({
      displayName: "Home Mac",
      environment: "local",
      hostName: "mac.local",
      capabilities: [
        {
          name: "file.list",
          risk: "low",
          readOnly: true,
          requiresConfirmation: false,
          enabled: true,
          allowedScopes: ["approved_paths"]
        }
      ],
      pathScopes: [
        { label: "Docs", path: "/Users/me/Documents", mode: "read_only", enabled: true }
      ]
    });
    store.heartbeatWorker(store.listWorkers()[0].id, { pid: 1 });
    let observedInventory = "";
    const result = await runConversationMessageFlow({
      store,
      provider: {
        name: "worker-inventory-fake",
        async generateAssistantReply(input) {
          observedInventory = input.workerInventory ?? "";
          return {
            content: observedInventory.includes("Home Mac") ? "当前有一个 Worker：Home Mac。" : "没有看到 Worker。",
            provider: "worker-inventory-fake"
          };
        },
        async extractMemoryCandidates() {
          return { candidates: [] };
        }
      },
      conversationId: conversation.id,
      content: "现在有哪些可用的 worker？"
    });

    expect(observedInventory).toContain("Home Mac");
    expect(observedInventory).toContain("file.list");
    expect(observedInventory).toContain("/Users/me/Documents");
    expect(result.assistantMessage.content).toContain("Home Mac");
    store.close();
  });

  it("returns worker status context for online checks even when the worker is offline", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Worker online check");
    const worker = store.registerWorker({
      displayName: "Offline Mac",
      environment: "local",
      capabilities: [
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
    store.updateWorker(worker.id, { status: "offline" });
    let observedWorkerContext = "";
    const result = await runConversationMessageFlow({
      store,
      provider: {
        name: "worker-status-fake",
        async generateAssistantReply(input) {
          observedWorkerContext = input.workerContext ?? "";
          return {
            content: observedWorkerContext.includes("status=offline") ? "Worker 当前离线。" : "无法判断 Worker 状态。",
            provider: "worker-status-fake"
          };
        },
        async extractMemoryCandidates() {
          return { candidates: [] };
        }
      },
      conversationId: conversation.id,
      content: "Worker 现在在线吗？"
    });

    expect(observedWorkerContext).toContain("status=offline");
    expect(result.assistantMessage.content).toContain("离线");
    store.close();
  });

  it("saves owner and assistant messages and creates memory candidates with an internal fake provider", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("LLM flow");

    const result = await runConversationMessageFlow({
      store,
      provider: {
        name: "fake-test",
        async generateAssistantReply() {
          return { content: "I will remember that preference.", provider: "fake-test", model: "test" };
        },
        async extractMemoryCandidates() {
          return {
            candidates: [
              {
                type: "preference",
                label: "Prefers implementation plans",
                subject: "owner",
                predicate: "prefers",
                object: "implementation plans",
                scope_type: "global",
                scope_id: null,
                confidence: 0.9,
                risk: "low",
                evidence_quote: "I prefer implementation plans."
              }
            ]
          };
        }
      },
      conversationId: conversation.id,
      content: "I prefer implementation plans."
    });

    const messages = store.listMessages(conversation.id);
    const candidates = store.listMemoryCandidates();
    const graph = store.getGraph();

    expect(result.ownerMessage.role).toBe("owner");
    expect(result.assistantMessage.content).toBe("I will remember that preference.");
    expect(messages.map((message) => message.role)).toEqual(["owner", "assistant"]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.label).toBe("Prefers implementation plans");
    expect(graph.evidence[0]?.quote).toBe("I prefer implementation plans.");
  });

  it("merges owner profile patch proposals from an internal fake provider", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Profile facts");

    await runConversationMessageFlow({
      store,
      provider: {
        name: "profile-fake",
        async generateAssistantReply() {
          return { content: "我会把这条个人画像信息放入候选记忆。", provider: "profile-fake", model: "test" };
        },
        async extractMemoryCandidates() {
          return {
            candidates: [],
            profile_patches: [
              {
                target: "owner_profile",
                operation: "add",
                attribute_key: "zodiac_sign",
                semantic_type: "identity",
                value: { sign: "双鱼座" },
                normalized_value: "双鱼座",
                confidence: 0.95,
                risk: "low",
                evidence_quote: "我是双鱼座",
                reason: "The owner stated a stable personal profile attribute."
              }
            ]
          };
        }
      },
      conversationId: conversation.id,
      content: "我是双鱼座"
    });

    const profile = store.getOwnerProfile();
    expect(profile.attributes[0]).toMatchObject({
      key: "zodiac_sign",
      semanticType: "identity",
      normalizedValue: "双鱼座",
      status: "active"
    });
    expect(store.getGraph().evidence.some((item) => item.quote === "我是双鱼座")).toBe(true);
    store.close();
  });

  it("does not create profile attributes when the provider returns no profile patches", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("No profile fallback");

    await runConversationMessageFlow({
      store,
      provider: {
        name: "empty-extraction-fake",
        async generateAssistantReply() {
          return { content: "收到。", provider: "empty-extraction-fake", model: "test" };
        },
        async extractMemoryCandidates() {
          return { candidates: [] };
        }
      },
      conversationId: conversation.id,
      content: "我是双鱼座"
    });

    expect(store.getOwnerProfile().attributes).toHaveLength(0);
    store.close();
  });

  it("does not create profile attributes when reply generation fails before extraction", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Profile extraction skipped on failure");

    await runConversationMessageFlow({
      store,
      provider: {
        name: "failing-provider",
        async generateAssistantReply() {
          throw new Error("No LLM provider configured. Configure one in Settings.");
        },
        async extractMemoryCandidates() {
          throw new Error("should not run");
        }
      },
      conversationId: conversation.id,
      content: "我是双鱼座"
    });

    expect(store.getOwnerProfile().attributes).toHaveLength(0);
    store.close();
  });

  it("uses settings to resolve assistant reply language", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    store.updateSettings({ uiLocale: "zh-CN", assistantReplyLocale: "follow_ui" });
    const conversation = store.createConversation("Locale flow");
    let observedLocale: string | undefined;

    await runConversationMessageFlow({
      store,
      provider: {
        name: "locale-observer",
        async generateAssistantReply(input) {
          observedLocale = input.replyLocale;
          return { content: "中文回复", provider: "locale-observer" };
        },
        async extractMemoryCandidates() {
          return { candidates: [] };
        }
      },
      conversationId: conversation.id,
      content: "请用中文回复。"
    });

    expect(observedLocale).toBe("zh-CN");
    expect(store.listMessages(conversation.id)[1]?.content).toBe("中文回复");
  });

  it("passes relevant active profile memories to the provider in fallback mode", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const sourceConversation = store.createConversation("Profile source");
    const queryConversation = store.createConversation("Profile query");
    const sourceMessage = store.createMessage(sourceConversation.id, "owner", "我比较典型双鱼", {});
    store.applyProfilePatchProposal({
      target: "owner_profile",
      operation: "add",
      attributeKey: "zodiac_sign",
      semanticType: "identity",
      value: { sign: "双鱼座" },
      normalizedValue: "双鱼座",
      confidence: 0.95,
      risk: "low",
      evidenceQuote: "我比较典型双鱼",
      reason: "Stable owner profile attribute."
    }, sourceMessage);
    let observedMemoryLabels: string[] = [];

    await runConversationMessageFlow({
      store,
      provider: {
        name: "memory-observer",
        async generateAssistantReply(input) {
          observedMemoryLabels = input.activeMemories.map((memory) => memory.label);
          return { content: "你是双鱼座。", provider: "memory-observer" };
        },
        async extractMemoryCandidates() {
          return { candidates: [] };
        }
      },
      conversationId: queryConversation.id,
      content: "我是什么星座？"
    });

    expect(observedMemoryLabels).toContain("zodiac_sign: 双鱼座");
  });

  it("streams assistant deltas before the final assistant message", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Streaming flow");
    const observedEvents: string[] = [];

    const result = await runConversationMessageFlow({
      store,
      provider: {
        name: "streaming-test",
        async generateAssistantReply() {
          throw new Error("generateAssistantReply should not be used when streaming is available");
        },
        async streamAssistantReply(_input, onDelta) {
          await onDelta("hello ");
          await onDelta("world");
          return { content: "hello world", provider: "streaming-test", model: "test" };
        },
        async extractMemoryCandidates() {
          return { candidates: [] };
        }
      },
      conversationId: conversation.id,
      content: "stream please",
      onProgress(event) {
        if (event.type === "assistant_delta") {
          observedEvents.push(`delta:${event.content}`);
        }
        if (event.type === "assistant_message") {
          observedEvents.push(`message:${event.message.content}`);
        }
      }
    });

    expect(result.assistantMessage.content).toBe("hello world");
    expect(observedEvents).toEqual(["delta:hello ", "delta:world", "message:hello world"]);
  });

  it("rejects invalid extraction output without deleting the assistant reply", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Invalid extraction");

    await runConversationMessageFlow({
      store,
      provider: {
        name: "invalid-extraction",
        async generateAssistantReply() {
          return { content: "Reply was saved.", provider: "invalid-extraction" };
        },
        async extractMemoryCandidates() {
          return { candidates: [{ label: "Missing required fields" }] };
        }
      } satisfies LlmProvider,
      conversationId: conversation.id,
      content: "Remember this invalid extraction path."
    });

    const messages = store.listMessages(conversation.id);
    const candidates = store.listMemoryCandidates();
    const events = store.listEvents();
    const audit = store.listAuditRecords();

    expect(messages.map((message) => message.role)).toEqual(["owner", "assistant"]);
    expect(messages[1]?.content).toBe("Reply was saved.");
    expect(candidates).toHaveLength(0);
    expect(events.map((event) => event.type)).toContain("memory.extraction_failed");
    expect(audit.map((record) => record.action)).toContain("memory.extraction_failed");
  });

  it("saves the owner message and returns a useful assistant error when reply generation fails", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Reply failure");

    const result = await runConversationMessageFlow({
      store,
      provider: {
        name: "failing-reply",
        async generateAssistantReply() {
          throw new Error("provider unavailable");
        },
        async extractMemoryCandidates() {
          throw new Error("should not run");
        }
      },
      conversationId: conversation.id,
      content: "Can you answer?"
    });

    const messages = store.listMessages(conversation.id);
    const events = store.listEvents();

    expect(messages.map((message) => message.role)).toEqual(["owner", "assistant"]);
    expect(result.assistantMessage.content).toContain("I could not generate a reply");
    expect(events.map((event) => event.type)).toContain("llm.error");
    expect(store.listMemoryCandidates()).toHaveLength(0);
  });
});
