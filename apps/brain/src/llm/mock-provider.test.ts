import { describe, expect, it } from "vitest";
import { MockLlmProvider } from "./mock-provider.js";

describe("MockLlmProvider", () => {
  it("returns deterministic assistant replies and extracted candidates", async () => {
    const provider = new MockLlmProvider();
    const reply = await provider.generateAssistantReply({
      ownerMessage: "I prefer concrete plans before coding.",
      recentMessages: [],
      activeMemories: [],
      replyLocale: "en"
    });
    const extraction = await provider.extractMemoryCandidates({
      ownerMessage: "I prefer concrete plans before coding.",
      assistantMessage: reply.content,
      recentMessages: [],
      activeMemories: [],
      replyLocale: "en"
    });

    expect(reply).toEqual({
      content: "Sedna heard: I prefer concrete plans before coding.",
      provider: "mock",
      model: "mock-deterministic"
    });
    expect(extraction).toEqual({
      candidates: [
        {
          type: "preference",
          label: "Prefers concrete plans before coding",
          subject: "owner",
          predicate: "prefers",
          object: "concrete plans before coding",
          scope_type: "global",
          scope_id: null,
          confidence: 0.91,
          risk: "low",
          evidence_quote: "I prefer concrete plans before coding."
        }
      ]
    });
  });

  it("returns Chinese deterministic replies when requested", async () => {
    const provider = new MockLlmProvider();
    const reply = await provider.generateAssistantReply({
      ownerMessage: "I prefer concrete plans before coding.",
      recentMessages: [],
      activeMemories: [],
      replyLocale: "zh-CN"
    });

    expect(reply.content).toBe("Sedna 已收到：I prefer concrete plans before coding.");
  });
});
