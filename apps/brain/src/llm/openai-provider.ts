import { buildChatMessages } from "./prompts/chat.js";
import { buildExtractMemoryPrompt } from "./prompts/extract-memory.js";
import { extractionJsonSchema } from "./schemas.js";
import type { LlmConversationInput, LlmExtractionInput, LlmProvider, LlmTextResult } from "./provider.js";

export interface OpenAiProviderOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export class OpenAiLlmProvider implements LlmProvider {
  readonly name = "openai";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAiProviderOptions) {
    if (!options.apiKey) {
      throw new Error("OpenAI provider requires OPENAI_API_KEY. Set OPENAI_API_KEY or use LLM_PROVIDER=mock.");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateAssistantReply(input: LlmConversationInput): Promise<LlmTextResult> {
    const response = await this.callResponsesApi({
      model: this.options.model,
      input: buildChatMessages(input)
    });
    return {
      content: extractResponseText(response),
      provider: "openai",
      model: this.options.model
    };
  }

  async extractMemoryCandidates(input: LlmExtractionInput): Promise<unknown> {
    const response = await this.callResponsesApi({
      model: this.options.model,
      input: [
        {
          role: "system",
          content: "Return only JSON that matches the provided candidate memory schema."
        },
        {
          role: "user",
          content: buildExtractMemoryPrompt(input)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "sedna_memory_extraction",
          strict: true,
          schema: extractionJsonSchema
        }
      }
    });
    return JSON.parse(extractResponseText(response)) as unknown;
  }

  private async callResponsesApi(body: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI Responses API request failed: ${response.status} ${text}`);
    }
    return response.json() as Promise<unknown>;
  }
}

function extractResponseText(response: unknown): string {
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
  throw new Error("OpenAI response did not include output text.");
}
