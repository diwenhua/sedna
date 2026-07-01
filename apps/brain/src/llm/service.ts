import type { LlmProviderConfigSecret, MemoryStore } from "@sedna/memory";
import type { LlmModelRoute, LlmRoutePurpose } from "@sedna/protocol";
import { buildChatMessages } from "./prompts/chat.js";
import { buildExtractMemoryPrompt } from "./prompts/extract-memory.js";
import { parseModelJson } from "./json.js";
import { extractionJsonSchema } from "./schemas.js";
import type { LlmConversationInput, LlmExtractionInput, LlmProvider, LlmTextResult } from "./provider.js";

export interface LlmServiceOptions {
  fetchImpl?: typeof fetch;
}

export interface LlmConnectionTestResult {
  ok: boolean;
  providerConfigId: string;
  adapterType: LlmProviderConfigSecret["adapterType"];
  model: string;
  message: string;
}

export class RoutedLlmService implements LlmProvider {
  readonly name = "routed";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly store: MemoryStore, options: LlmServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateAssistantReply(input: LlmConversationInput): Promise<LlmTextResult> {
    const { route, provider } = this.resolveRoute("chat_reply");
    return {
      content: await this.callTextModel(provider, route, buildChatMessages(input), false),
      provider: provider.displayName,
      model: route.model
    };
  }

  async streamAssistantReply(
    input: LlmConversationInput,
    onDelta: (delta: string) => void | Promise<void>
  ): Promise<LlmTextResult> {
    const { route, provider } = this.resolveRoute("chat_reply");
    const content = await this.callStreamingTextModel(provider, route, buildChatMessages(input), onDelta);
    return {
      content,
      provider: provider.displayName,
      model: route.model
    };
  }

  async extractMemoryCandidates(input: LlmExtractionInput): Promise<unknown> {
    const { route, provider } = this.resolveRoute("memory_extraction");
    const messages = [
      { role: "system" as const, content: "Return only JSON that matches the provided candidate memory schema." },
      { role: "user" as const, content: buildExtractMemoryPrompt(input) }
    ];
    const content = await this.callTextModel(provider, route, messages, true);
    return parseModelJson(content);
  }

  async testProvider(providerConfigId: string): Promise<LlmConnectionTestResult> {
    const provider = this.store.getLlmProviderConfigWithSecret(providerConfigId);
    if (!provider) {
      throw new Error(`LLM provider config not found: ${providerConfigId}`);
    }
    if (!provider.enabled) {
      return {
        ok: false,
        providerConfigId,
        adapterType: provider.adapterType,
        model: provider.defaultModel,
        message: "Provider is disabled."
      };
    }
    if (!provider.apiKey) {
      return {
        ok: false,
        providerConfigId,
        adapterType: provider.adapterType,
        model: provider.defaultModel,
        message: "API key is required for this provider."
      };
    }

    try {
      await this.callTextModel(
        provider,
        {
          model: provider.defaultModel,
          temperature: 0,
          maxTokens: 16
        },
        [{ role: "user", content: "Reply with ok." }],
        false
      );
      return {
        ok: true,
        providerConfigId,
        adapterType: provider.adapterType,
        model: provider.defaultModel,
        message: "Provider connection test passed."
      };
    } catch (error) {
      return {
        ok: false,
        providerConfigId,
        adapterType: provider.adapterType,
        model: provider.defaultModel,
        message: sanitizeProviderError(error)
      };
    }
  }

  private resolveRoute(purpose: LlmRoutePurpose): { route: LlmModelRoute; provider: LlmProviderConfigSecret } {
    const route = this.store.getLlmModelRoute(purpose);
    if (!route || !route.enabled) {
      throw new Error("No LLM provider configured. Configure one in Settings.");
    }
    const provider = this.store.getLlmProviderConfigWithSecret(route.providerConfigId);
    if (!provider || !provider.enabled) {
      throw new Error("No LLM provider configured. Configure one in Settings.");
    }
    if (!provider.apiKey) {
      throw new Error(`LLM provider ${provider.displayName} requires an API key.`);
    }
    return { route, provider };
  }

  private async callTextModel(
    provider: LlmProviderConfigSecret,
    route: Pick<LlmModelRoute, "model" | "temperature" | "maxTokens">,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    jsonMode: boolean
  ): Promise<string> {
    switch (provider.adapterType) {
      case "openai-native":
        return this.callOpenAiResponses(provider, route, messages, jsonMode);
      case "openai-compatible":
        return this.callOpenAiCompatible(provider, route, messages, jsonMode);
      case "anthropic":
        return this.callAnthropic(provider, route, messages);
      case "gemini":
        return this.callGemini(provider, route, messages);
      default:
        throw new Error(`Unsupported LLM adapter: ${provider.adapterType}`);
    }
  }

  private async callStreamingTextModel(
    provider: LlmProviderConfigSecret,
    route: Pick<LlmModelRoute, "model" | "temperature" | "maxTokens">,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    onDelta: (delta: string) => void | Promise<void>
  ): Promise<string> {
    switch (provider.adapterType) {
      case "openai-native":
        return this.streamOpenAiResponses(provider, route, messages, onDelta);
      case "openai-compatible":
        return this.streamOpenAiCompatible(provider, route, messages, onDelta);
      case "anthropic":
        return this.streamAnthropic(provider, route, messages, onDelta);
      case "gemini":
        return this.callGemini(provider, route, messages);
      default:
        throw new Error(`Unsupported LLM adapter: ${provider.adapterType}`);
    }
  }

  private async callOpenAiResponses(
    provider: LlmProviderConfigSecret,
    route: Pick<LlmModelRoute, "model" | "temperature" | "maxTokens">,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    jsonMode: boolean
  ): Promise<string> {
    const response = await this.fetchImpl(`${trimBaseUrl(provider.baseUrl ?? "https://api.openai.com/v1")}/responses`, {
      method: "POST",
      headers: authHeaders(provider.apiKey),
      body: JSON.stringify({
        model: route.model,
        input: messages,
        temperature: route.temperature,
        max_output_tokens: route.maxTokens,
        ...(jsonMode ? {
          text: {
            format: {
              type: "json_schema",
              name: "sedna_memory_extraction",
              strict: true,
              schema: extractionJsonSchema
            }
          }
        } : {})
      })
    });
    return extractOpenAiText(await readJsonResponse(response));
  }

  private async callOpenAiCompatible(
    provider: LlmProviderConfigSecret,
    route: Pick<LlmModelRoute, "model" | "temperature" | "maxTokens">,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    jsonMode: boolean
  ): Promise<string> {
    const baseUrl = provider.baseUrl ? trimBaseUrl(provider.baseUrl) : "https://api.openai.com/v1";
    const response = await this.fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(provider.apiKey),
      body: JSON.stringify({
        model: route.model,
        messages,
        temperature: route.temperature,
        max_tokens: route.maxTokens,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {})
      })
    });
    return extractOpenAiCompatibleText(await readJsonResponse(response));
  }

  private async callAnthropic(
    provider: LlmProviderConfigSecret,
    route: Pick<LlmModelRoute, "model" | "temperature" | "maxTokens">,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
  ): Promise<string> {
    const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const response = await this.fetchImpl(`${trimBaseUrl(provider.baseUrl ?? "https://api.anthropic.com/v1")}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey ?? "",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: route.model,
        system,
        messages: messages
          .filter((message) => message.role !== "system")
          .map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content })),
        temperature: route.temperature,
        max_tokens: route.maxTokens
      })
    });
    return extractAnthropicText(await readJsonResponse(response));
  }

  private async callGemini(
    provider: LlmProviderConfigSecret,
    route: Pick<LlmModelRoute, "model" | "temperature" | "maxTokens">,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
  ): Promise<string> {
    const baseUrl = trimBaseUrl(provider.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta");
    const response = await this.fetchImpl(`${baseUrl}/models/${encodeURIComponent(route.model)}:generateContent?key=${encodeURIComponent(provider.apiKey ?? "")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: `${message.role}: ${message.content}` }]
        })),
        generationConfig: {
          temperature: route.temperature,
          maxOutputTokens: route.maxTokens
        }
      })
    });
    return extractGeminiText(await readJsonResponse(response));
  }

  private async streamOpenAiResponses(
    provider: LlmProviderConfigSecret,
    route: Pick<LlmModelRoute, "model" | "temperature" | "maxTokens">,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    onDelta: (delta: string) => void | Promise<void>
  ): Promise<string> {
    const response = await this.fetchImpl(`${trimBaseUrl(provider.baseUrl ?? "https://api.openai.com/v1")}/responses`, {
      method: "POST",
      headers: authHeaders(provider.apiKey),
      body: JSON.stringify({
        model: route.model,
        input: messages,
        temperature: route.temperature,
        max_output_tokens: route.maxTokens,
        stream: true
      })
    });
    return readSseText(response, async (event) => {
      const type = typeof event.type === "string" ? event.type : "";
      if (type === "response.output_text.delta" && typeof event.delta === "string") {
        await onDelta(event.delta);
        return event.delta;
      }
      return "";
    });
  }

  private async streamOpenAiCompatible(
    provider: LlmProviderConfigSecret,
    route: Pick<LlmModelRoute, "model" | "temperature" | "maxTokens">,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    onDelta: (delta: string) => void | Promise<void>
  ): Promise<string> {
    const baseUrl = provider.baseUrl ? trimBaseUrl(provider.baseUrl) : "https://api.openai.com/v1";
    const response = await this.fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(provider.apiKey),
      body: JSON.stringify({
        model: route.model,
        messages,
        temperature: route.temperature,
        max_tokens: route.maxTokens,
        stream: true
      })
    });
    return readSseText(response, async (event) => {
      const delta = (event as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        await onDelta(delta);
        return delta;
      }
      return "";
    });
  }

  private async streamAnthropic(
    provider: LlmProviderConfigSecret,
    route: Pick<LlmModelRoute, "model" | "temperature" | "maxTokens">,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    onDelta: (delta: string) => void | Promise<void>
  ): Promise<string> {
    const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const response = await this.fetchImpl(`${trimBaseUrl(provider.baseUrl ?? "https://api.anthropic.com/v1")}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey ?? "",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: route.model,
        system,
        messages: messages
          .filter((message) => message.role !== "system")
          .map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content })),
        temperature: route.temperature,
        max_tokens: route.maxTokens,
        stream: true
      })
    });
    return readSseText(response, async (event) => {
      const type = typeof event.type === "string" ? event.type : "";
      if (type === "content_block_delta") {
        const delta = (event as { delta?: { type?: string; text?: string } }).delta;
        if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
          await onDelta(delta.text);
          return delta.text;
        }
      }
      return "";
    });
  }
}

export function createRoutedLlmService(store: MemoryStore, options?: LlmServiceOptions): RoutedLlmService {
  return new RoutedLlmService(store, options);
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
  return {
    "Authorization": `Bearer ${apiKey ?? ""}`,
    "Content-Type": "application/json"
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Provider request failed: ${response.status} ${safeResponseText(text)}`);
  }
  return text.length > 0 ? JSON.parse(text) as unknown : {};
}

async function readSseText(
  response: Response,
  onEvent: (event: Record<string, unknown>) => Promise<string>
): Promise<string> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provider request failed: ${response.status} ${safeResponseText(text)}`);
  }
  if (!response.body) {
    throw new Error("Provider stream response did not include a body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const delta = await handleSseBlock(block, onEvent);
      fullText += delta;
    }
  }

  if (buffer.trim().length > 0) {
    fullText += await handleSseBlock(buffer, onEvent);
  }

  return fullText;
}

async function handleSseBlock(
  block: string,
  onEvent: (event: Record<string, unknown>) => Promise<string>
): Promise<string> {
  const dataLines = block
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  let text = "";
  for (const data of dataLines) {
    if (data === "[DONE]" || data.length === 0) {
      continue;
    }
    text += await onEvent(JSON.parse(data) as Record<string, unknown>);
  }
  return text;
}

function safeResponseText(text: string): string {
  return text.slice(0, 500);
}

function sanitizeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");
}

function extractOpenAiText(response: unknown): string {
  if (typeof response === "object" && response !== null && "output_text" in response) {
    const outputText = (response as { output_text?: unknown }).output_text;
    if (typeof outputText === "string") {
      return outputText;
    }
  }
  const output = (response as { output?: Array<{ content?: Array<{ text?: string }> }> }).output;
  const text = output?.flatMap((item) => item.content ?? []).find((content) => typeof content.text === "string")?.text;
  if (text) {
    return text;
  }
  throw new Error("Provider response did not include output text.");
}

function extractOpenAiCompatibleText(response: unknown): string {
  const choice = (response as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0];
  if (choice?.message?.content) {
    return choice.message.content;
  }
  throw new Error("Provider response did not include chat completion content.");
}

function extractAnthropicText(response: unknown): string {
  const text = (response as { content?: Array<{ text?: string }> }).content?.find((item) => typeof item.text === "string")?.text;
  if (text) {
    return text;
  }
  throw new Error("Provider response did not include Anthropic content.");
}

function extractGeminiText(response: unknown): string {
  const text = (response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
  if (text) {
    return text;
  }
  throw new Error("Provider response did not include Gemini content.");
}
