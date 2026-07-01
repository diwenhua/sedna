import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@sedna/memory";
import { readOwnerProfile, searchActiveMemories } from "./agent-context-tools.js";

describe("agent context tools", () => {
  it("returns active owner profile attributes on demand", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Profile");
    const message = store.createMessage(conversation.id, "owner", "我是男生，常驻杭州", {});

    store.applyProfilePatchProposal({
      target: "owner_profile",
      operation: "add",
      attributeKey: "gender",
      semanticType: "identity",
      value: { gender: "男生" },
      normalizedValue: "男生",
      confidence: 0.95,
      risk: "low",
      evidenceQuote: "我是男生",
      reason: "Stable identity"
    }, message);
    store.applyProfilePatchProposal({
      target: "owner_profile",
      operation: "add",
      attributeKey: "home_city",
      semanticType: "location",
      value: { city: "杭州" },
      normalizedValue: "杭州",
      confidence: 0.95,
      risk: "low",
      evidenceQuote: "常驻杭州",
      reason: "Stable location"
    }, message);

    expect(readOwnerProfile(store).attributes.map((item) => item.key)).toEqual(
      expect.arrayContaining(["gender", "home_city"])
    );
    expect(readOwnerProfile(store, "gender").attributes).toEqual([
      expect.objectContaining({ key: "gender", value: "男生" })
    ]);

    store.close();
  });

  it("searches active memories with an agent-provided query", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    const conversation = store.createConversation("Memory");
    const message = store.createMessage(conversation.id, "owner", "我比较典型双鱼", {});
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
      reason: "Stable identity"
    }, message);

    const result = searchActiveMemories(store, "双鱼座");
    expect(result.memories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: expect.stringContaining("zodiac_sign") })
      ])
    );

    store.close();
  });
});
