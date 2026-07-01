import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@sedna/memory";
import { syncLlmEnvConfig } from "./config.js";

describe("LLM environment configuration", () => {
  it("syncs explicit OpenAI env config into provider routes", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();

    syncLlmEnvConfig(store, {
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "unit-test-placeholder",
      OPENAI_MODEL: "gpt-4.1-mini"
    });

    const provider = store.listLlmProviderConfigs().find((item) => item.displayName === "OpenAI from environment");
    expect(provider).toMatchObject({
      adapterType: "openai-native",
      enabled: true,
      hasApiKey: true
    });
    expect(provider).not.toHaveProperty("apiKey");
    expect(store.getLlmModelRoute("chat_reply")).toMatchObject({
      providerConfigId: provider?.id,
      model: "gpt-4.1-mini"
    });
    expect(store.getLlmModelRoute("memory_extraction")).toMatchObject({
      providerConfigId: provider?.id,
      model: "gpt-4.1-mini"
    });

    store.close();
  });

  it("skips OpenAI env sync when the API key is missing", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();

    syncLlmEnvConfig(store, { LLM_PROVIDER: "openai" });

    expect(store.listLlmProviderConfigs()).toEqual([]);

    store.close();
  });
});
