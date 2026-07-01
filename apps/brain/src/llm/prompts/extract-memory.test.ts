import { describe, expect, it } from "vitest";
import { buildExtractMemoryPrompt } from "./extract-memory.js";

describe("memory extraction prompt", () => {
  it("requires root extraction object and open vocabulary profile patches", () => {
    const prompt = buildExtractMemoryPrompt({
      ownerMessage: "我是男生，1997年3月10日出生，双鱼座",
      assistantMessage: "收到。",
      recentMessages: [],
      activeMemories: []
    });

    expect(prompt).toContain('"candidates": []');
    expect(prompt).toContain('"profile_patches": []');
    expect(prompt).toContain("Do not return a top-level array.");
    expect(prompt).toContain("attribute_key is open vocabulary, not an enum.");
    expect(prompt).toContain("我是男生，1997年3月10日出生，双鱼座");
  });
});
