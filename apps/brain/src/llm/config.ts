import { OpenAiLlmProvider } from "./openai-provider.js";
import type { LlmProvider } from "./provider.js";
import type { MemoryStore } from "@sedna/memory";

export interface LlmEnv {
  LLM_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

export function createLlmProviderFromEnv(env: LlmEnv = process.env): LlmProvider {
  const provider = env.LLM_PROVIDER;
  if (!provider) {
    throw new Error("No LLM provider configured. Configure one in Settings.");
  }
  if (provider === "openai") {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OpenAI provider requires OPENAI_API_KEY.");
    }
    return new OpenAiLlmProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL ?? "gpt-4.1-mini"
    });
  }
  throw new Error(`Unsupported LLM_PROVIDER: ${provider}`);
}

export function syncLlmEnvConfig(store: MemoryStore, env: LlmEnv = process.env): void {
  const provider = env.LLM_PROVIDER?.trim();
  if (!provider) {
    return;
  }
  if (provider !== "openai") {
    throw new Error(`Unsupported LLM_PROVIDER: ${provider}`);
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return;
  }

  const existing = store.listLlmProviderConfigs().find((config) => config.displayName === "OpenAI from environment");
  const model = env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
  const config = existing
    ? store.updateLlmProviderConfig(existing.id, {
        presetId: "openai",
        displayName: "OpenAI from environment",
        adapterType: "openai-native",
        baseUrl: "https://api.openai.com/v1",
        apiKey,
        defaultModel: model,
        enabled: true
      })
    : store.createLlmProviderConfig({
        presetId: "openai",
        displayName: "OpenAI from environment",
        adapterType: "openai-native",
        baseUrl: "https://api.openai.com/v1",
        apiKey,
        defaultModel: model,
        enabled: true
      });

  store.updateLlmModelRoute("chat_reply", {
    providerConfigId: config.id,
    model,
    temperature: 0.2,
    maxTokens: 16384,
    enabled: true
  });
  store.updateLlmModelRoute("memory_extraction", {
    providerConfigId: config.id,
    model,
    temperature: 0,
    maxTokens: 2000,
    enabled: true
  });
}
