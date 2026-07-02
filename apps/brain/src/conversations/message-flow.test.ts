import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@sedna/memory";
import { runConversationMessageFlow } from "./message-flow.js";
import type { LlmProvider } from "../llm/provider.js";

describe("conversation message flow", () => {
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
          name: "agent.execute",
          risk: "medium",
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
    expect(observedInventory).toContain("agent.execute");
    expect(result.assistantMessage.content).toContain("Home Mac");
    store.close();
  });

  it("includes offline worker status in the registered worker inventory context", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Worker online check");
    const worker = store.registerWorker({
      displayName: "Offline Mac",
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
    store.updateWorker(worker.id, { status: "offline" });
    let observedInventory = "";
    const result = await runConversationMessageFlow({
      store,
      provider: {
        name: "worker-status-fake",
        async generateAssistantReply(input) {
          observedInventory = input.workerInventory ?? "";
          return {
            content: observedInventory.includes("status=offline") ? "Worker 当前离线。" : "无法判断 Worker 状态。",
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

    expect(observedInventory).toContain("status=offline");
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
