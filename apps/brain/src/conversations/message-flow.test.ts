import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@sedna/memory";
import { runConversationMessageFlow } from "./message-flow.js";
import type { LlmProvider } from "../llm/provider.js";

describe("conversation message flow", () => {
  it("saves owner and assistant messages and creates memory candidates with mock provider", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("LLM flow");

    const result = await runConversationMessageFlow({
      store,
      provider: {
        name: "mock-test",
        async generateAssistantReply() {
          return { content: "I will remember that preference.", provider: "mock-test", model: "test" };
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
