import { describe, expect, it } from "vitest";
import { parseModelJson } from "./json.js";

describe("model JSON parsing", () => {
  it("parses raw JSON objects", () => {
    expect(parseModelJson('{"candidates":[],"profile_patches":[]}')).toEqual({
      candidates: [],
      profile_patches: []
    });
  });

  it("parses JSON wrapped in Markdown fences", () => {
    expect(parseModelJson('```json\n{"candidates":[],"profile_patches":[]}\n```')).toEqual({
      candidates: [],
      profile_patches: []
    });
  });
});
