import { describe, expect, it } from "vitest";
import { createLlmProviderFromEnv } from "./config.js";

describe("OpenAI provider configuration", () => {
  it("fails clearly when OpenAI is selected without an API key", () => {
    expect(() =>
      createLlmProviderFromEnv({
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "",
        OPENAI_MODEL: "gpt-4.1-mini"
      })
    ).toThrow("OpenAI provider requires OPENAI_API_KEY.");
  });
});
