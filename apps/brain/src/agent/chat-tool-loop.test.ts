import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@sedna/memory";
import { canUseAgentToolLoop, canUseWebToolLoop, runChatWithWebTools } from "./chat-tool-loop.js";

describe("canUseWebToolLoop", () => {
  it("supports anthropic-compatible providers such as DeepSeek", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    store.updateWebToolsSettings({ enabled: true, searchProvider: "duckduckgo" });
    const provider = store.createLlmProviderConfig({
      displayName: "DeepSeek",
      adapterType: "anthropic",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKey: "test-key",
      defaultModel: "deepseek-chat",
      enabled: true
    });
    store.updateLlmModelRoute("chat_reply", {
      providerConfigId: provider.id,
      model: "deepseek-chat",
      temperature: 0.2,
      maxTokens: 1200,
      enabled: true
    });

    expect(canUseWebToolLoop(store)).toBe(true);
    expect(canUseAgentToolLoop(store)).toBe(true);
    store.close();
  });

  it("supports agent loop even when web tools are disabled", () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    store.updateWebToolsSettings({ enabled: false });
    const provider = store.createLlmProviderConfig({
      displayName: "DeepSeek",
      adapterType: "anthropic",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKey: "test-key",
      defaultModel: "deepseek-chat",
      enabled: true
    });
    store.updateLlmModelRoute("chat_reply", {
      providerConfigId: provider.id,
      model: "deepseek-chat",
      temperature: 0.2,
      maxTokens: 1200,
      enabled: true
    });

    expect(canUseWebToolLoop(store)).toBe(false);
    expect(canUseAgentToolLoop(store)).toBe(true);
    store.close();
  });
});

describe("chat tool loop", () => {
  it("executes web_search and returns the final assistant reply", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    store.createLlmProviderConfig({
      presetId: "openai",
      displayName: "Test OpenAI",
      adapterType: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: "test-key",
      defaultModel: "gpt-test",
      enabled: true
    });
    const provider = store.listLlmProviderConfigs()[0]!;
    store.updateLlmModelRoute("chat_reply", {
      providerConfigId: provider.id,
      model: "gpt-test",
      temperature: 0.2,
      maxTokens: 500,
      enabled: true
    });

    let callCount = 0;
    const result = await runChatWithWebTools(
      {
        ownerMessage: "What is the latest release of Sedna?",
        recentMessages: [],
        activeMemories: [],
        replyLocale: "en"
      },
      {
        store,
        fetchImpl: async (input) => {
          const url = typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
          if (url.endsWith("/chat/completions")) {
            callCount += 1;
            if (callCount === 1) {
              return new Response(JSON.stringify({
                choices: [{
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [{
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "web_search",
                        arguments: JSON.stringify({ query: "Sedna latest release" })
                      }
                    }]
                  }
                }]
              }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
            return new Response(JSON.stringify({
              choices: [{ message: { role: "assistant", content: "The latest release is 0.2." } }]
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          if (url.includes("html.duckduckgo.com")) {
            return new Response(`
              <a class="result__a" href="https://example.com/release">Sedna 0.2</a>
              <a class="result__snippet">Release notes for Sedna 0.2.</a>
            `, { status: 200 });
          }
          throw new Error(`Unexpected fetch: ${url}`);
        }
      }
    );

    expect(result.content).toBe("The latest release is 0.2.");
    expect(callCount).toBe(2);
  });
});
