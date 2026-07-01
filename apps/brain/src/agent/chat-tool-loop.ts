import type { MemoryStore } from "@sedna/memory";
import type { LlmProviderConfigSecret } from "@sedna/memory";
import type { LlmModelRoute, ToolRegistryEntry } from "@sedna/protocol";
import { buildChatMessages } from "../llm/prompts/chat.js";
import type { LlmConversationInput, LlmTextResult } from "../llm/provider.js";
import { McpClient } from "../mcp/client.js";
import { executeTool } from "../tools/tool-executor.js";
import { readOwnerProfile, searchActiveMemories } from "./agent-context-tools.js";
import { executeInternalTool } from "../tools/internal-tools.js";
import { isWebToolsConfigured } from "../tools/web/index.js";

export type ChatToolProgressEvent =
  | {
      type: "tool_status";
      tool: string;
      phase: "search" | "fetch" | "tool";
      title: string;
      query?: string;
      url?: string;
    }
  | {
      type: "tool_result";
      tool: string;
      summary: string;
    };

interface FunctionToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const CONTEXT_TOOL_DEFINITIONS: FunctionToolDefinition[] = [
  {
    type: "function",
    name: "owner_profile_read",
    description: "Read the owner's active profile attributes such as home city, gender, language preferences, identity, and habits. Call this when you need personal context before answering.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional focus text to narrow which attributes to return. Omit to read all active attributes." },
        limit: { type: "number", description: "Maximum number of attributes to return (1-50)." }
      },
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "memory_search",
    description: "Search Sedna active memories for stored owner facts and profile-linked memories. Call this when recent chat is not enough.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you need to recall." },
        limit: { type: "number", description: "Maximum number of memories to return (1-20)." }
      },
      required: ["query"],
      additionalProperties: false
    }
  }
];

const WEB_TOOL_DEFINITIONS: FunctionToolDefinition[] = [
  {
    type: "function",
    name: "web_search",
    description: "Search the public web for current information, news, documentation, or facts not present in Sedna memory.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        max_results: { type: "number", description: "Maximum number of results to return (1-10)." }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "web_fetch",
    description: "Fetch readable text content from a public HTTP or HTTPS URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public URL to fetch." },
        max_chars: { type: "number", description: "Maximum characters to return." }
      },
      required: ["url"],
      additionalProperties: false
    }
  }
];

export interface ChatToolLoopOptions {
  store: MemoryStore;
  fetchImpl?: typeof fetch;
  onProgress?: (event: ChatToolProgressEvent) => void | Promise<void>;
}

function supportsToolCallingProvider(store: MemoryStore): boolean {
  try {
    const { provider } = resolveChatRoute(store);
    return provider.adapterType === "openai-native"
      || provider.adapterType === "openai-compatible"
      || provider.adapterType === "anthropic";
  } catch {
    return false;
  }
}

export function canUseWebToolLoop(store: MemoryStore): boolean {
  return isWebToolsConfigured(store) && supportsToolCallingProvider(store);
}

export function canUseAgentToolLoop(store: MemoryStore): boolean {
  return supportsToolCallingProvider(store);
}

function resolveMcpToolsForLoop(store: MemoryStore, input: LlmConversationInput): ToolRegistryEntry[] {
  const mcpTools = store.listToolRegistryEntries().filter((tool) => tool.enabled && tool.source === "mcp");
  const selectedNames = input.selectedTools?.map((tool) => tool.name) ?? [];
  if (selectedNames.length === 0) {
    return mcpTools;
  }
  const selected = new Set(selectedNames);
  return mcpTools.filter((tool) => selected.has(tool.name));
}

function buildAgentToolDefinitions(store: MemoryStore, input: LlmConversationInput): FunctionToolDefinition[] {
  const reserved = new Set<string>();
  const tools: FunctionToolDefinition[] = [];

  for (const tool of CONTEXT_TOOL_DEFINITIONS) {
    tools.push(tool);
    reserved.add(tool.name);
  }

  if (isWebToolsConfigured(store)) {
    for (const tool of WEB_TOOL_DEFINITIONS) {
      tools.push(tool);
      reserved.add(tool.name);
    }
  }

  for (const tool of resolveMcpToolsForLoop(store, input)) {
    if (reserved.has(tool.name)) {
      continue;
    }
    tools.push(registryToolToDefinition(tool));
    reserved.add(tool.name);
  }

  return tools;
}

function registryToolToDefinition(tool: ToolRegistryEntry): FunctionToolDefinition {
  const parameters = normalizeToolSchema(tool.inputSchema);
  return {
    type: "function",
    name: tool.name,
    description: tool.description || tool.title,
    parameters
  };
}

function normalizeToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type === "object") {
    return schema;
  }
  return {
    type: "object",
    properties: schema.properties && typeof schema.properties === "object" ? schema.properties : {},
    required: Array.isArray(schema.required) ? schema.required : [],
    additionalProperties: schema.additionalProperties ?? false
  };
}

function toAnthropicTools(tools: FunctionToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  }));
}

export async function runChatWithWebTools(
  input: LlmConversationInput,
  options: ChatToolLoopOptions
): Promise<LlmTextResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { route, provider } = resolveChatRoute(options.store);
  const toolDefinitions = buildAgentToolDefinitions(options.store, input);
  if (toolDefinitions.length === 0) {
    throw new Error("No agent tools are configured.");
  }

  const enrichedInput = {
    ...input,
    activeMemories: [],
    agentToolsEnabled: true
  };
  const messages = buildChatMessages(enrichedInput);
  let transcript: unknown[] = messages.map((message) => ({
    role: message.role,
    content: message.content
  }));

  while (true) {
    const response = await callModelWithTools(provider, route, transcript, toolDefinitions, fetchImpl);
    const toolCalls = extractToolCalls(provider.adapterType, response);
    if (toolCalls.length === 0) {
      return {
        content: extractAssistantText(provider.adapterType, response),
        provider: provider.displayName,
        model: route.model
      };
    }

    transcript = appendToolRound(provider.adapterType, transcript, response, toolCalls);
    for (const toolCall of toolCalls) {
      await options.onProgress?.({
        type: "tool_status",
        tool: toolCall.name,
        phase: toolCall.name === "web_search" ? "search" : toolCall.name === "web_fetch" ? "fetch" : "tool",
        title: toolProgressTitle(toolCall.name),
        query: toolCall.name === "web_search" ? readToolArg(toolCall.arguments, "query") : undefined,
        url: toolCall.name === "web_fetch" ? readToolArg(toolCall.arguments, "url") : undefined
      });
      const observation = await executeAgentTool(toolCall, options.store, fetchImpl);
      await options.onProgress?.({
        type: "tool_result",
        tool: toolCall.name,
        summary: summarizeObservation(toolCall.name, observation)
      });
      transcript = appendToolOutput(provider.adapterType, transcript, toolCall, observation);
    }
  }
}

function toolProgressTitle(toolName: string): string {
  if (toolName === "web_search") {
    return "Searching the web";
  }
  if (toolName === "web_fetch") {
    return "Fetching page content";
  }
  if (toolName === "owner_profile_read") {
    return "Reading owner profile";
  }
  if (toolName === "memory_search") {
    return "Searching memories";
  }
  return `Running ${toolName}`;
}

function resolveChatRoute(store: MemoryStore): { route: LlmModelRoute; provider: LlmProviderConfigSecret } {
  const route = store.getLlmModelRoute("chat_reply");
  if (!route || !route.enabled) {
    throw new Error("No LLM provider configured. Configure one in Settings.");
  }
  const provider = store.getLlmProviderConfigWithSecret(route.providerConfigId);
  if (!provider || !provider.enabled) {
    throw new Error("No LLM provider configured. Configure one in Settings.");
  }
  if (!provider.apiKey) {
    throw new Error(`LLM provider ${provider.displayName} requires an API key.`);
  }
  return { route, provider };
}

async function callModelWithTools(
  provider: LlmProviderConfigSecret,
  route: Pick<LlmModelRoute, "model" | "temperature" | "maxTokens">,
  transcript: unknown[],
  tools: FunctionToolDefinition[],
  fetchImpl: typeof fetch
): Promise<unknown> {
  if (provider.adapterType === "openai-native") {
    const response = await fetchImpl(`${trimBaseUrl(provider.baseUrl ?? "https://api.openai.com/v1")}/responses`, {
      method: "POST",
      headers: authHeaders(provider.apiKey),
      body: JSON.stringify({
        model: route.model,
        input: transcript,
        tools,
        temperature: route.temperature,
        max_output_tokens: route.maxTokens
      })
    });
    return readJsonResponse(response);
  }

  if (provider.adapterType === "anthropic") {
    const anthropicRequest = buildAnthropicToolRequest(transcript);
    const response = await fetchImpl(`${trimBaseUrl(provider.baseUrl ?? "https://api.anthropic.com/v1")}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey ?? "",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: route.model,
        system: anthropicRequest.system,
        messages: anthropicRequest.messages,
        tools: toAnthropicTools(tools),
        temperature: route.temperature,
        max_tokens: route.maxTokens
      })
    });
    return readJsonResponse(response);
  }

  const response = await fetchImpl(`${trimBaseUrl(provider.baseUrl ?? "https://api.openai.com/v1")}/chat/completions`, {
    method: "POST",
    headers: authHeaders(provider.apiKey),
    body: JSON.stringify({
      model: route.model,
      messages: transcript,
      tools: tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      })),
      temperature: route.temperature,
      max_tokens: route.maxTokens
    })
  });
  return readJsonResponse(response);
}

interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

function extractToolCalls(adapterType: LlmProviderConfigSecret["adapterType"], response: unknown): ParsedToolCall[] {
  if (adapterType === "openai-native") {
    const output = (response as { output?: Array<Record<string, unknown>> }).output ?? [];
    return output
      .filter((item) => item.type === "function_call")
      .map((item) => ({
        id: String(item.call_id ?? item.id ?? ""),
        name: String(item.name ?? ""),
        arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {})
      }))
      .filter((item) => item.id && item.name);
  }

  if (adapterType === "anthropic") {
    const content = (response as { content?: Array<Record<string, unknown>> }).content ?? [];
    return content
      .filter((item) => item.type === "tool_use")
      .map((item) => ({
        id: String(item.id ?? ""),
        name: String(item.name ?? ""),
        arguments: JSON.stringify(item.input ?? {})
      }))
      .filter((item) => item.id && item.name);
  }

  const message = (response as { choices?: Array<{ message?: Record<string, unknown> }> }).choices?.[0]?.message;
  const toolCalls = (message?.tool_calls as Array<{ id?: string; function?: { name?: string; arguments?: string } }> | undefined) ?? [];
  return toolCalls
    .map((item) => ({
      id: item.id ?? "",
      name: item.function?.name ?? "",
      arguments: item.function?.arguments ?? "{}"
    }))
    .filter((item) => item.id && item.name);
}

function extractAssistantText(adapterType: LlmProviderConfigSecret["adapterType"], response: unknown): string {
  if (adapterType === "openai-native") {
    const outputText = (response as { output_text?: unknown }).output_text;
    if (typeof outputText === "string" && outputText.length > 0) {
      return outputText;
    }
    const output = (response as { output?: Array<{ content?: Array<{ text?: string }> }> }).output;
    const text = output?.flatMap((item) => item.content ?? []).find((content) => typeof content.text === "string")?.text;
    if (text) {
      return text;
    }
    throw new Error("Provider response did not include output text.");
  }

  if (adapterType === "anthropic") {
    const text = (response as { content?: Array<{ type?: string; text?: string }> }).content
      ?.filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
    throw new Error("Provider response did not include Anthropic text content.");
  }

  const content = (response as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
  if (content) {
    return content;
  }
  throw new Error("Provider response did not include chat completion content.");
}

function appendToolRound(
  adapterType: LlmProviderConfigSecret["adapterType"],
  transcript: unknown[],
  response: unknown,
  toolCalls: ParsedToolCall[]
): unknown[] {
  if (adapterType === "openai-native") {
    const output = (response as { output?: unknown[] }).output ?? [];
    return [...transcript, ...output.filter((item) => {
      const typed = item as { type?: string };
      return typed.type === "function_call" || typed.type === "message";
    })];
  }

  if (adapterType === "anthropic") {
    const content = (response as { content?: Array<Record<string, unknown>> }).content ?? [];
    return [
      ...transcript,
      {
        role: "assistant",
        content
      }
    ];
  }

  const message = (response as { choices?: Array<{ message?: Record<string, unknown> }> }).choices?.[0]?.message;
  if (!message) {
    return transcript;
  }
  return [...transcript, message];
}

function appendToolOutput(
  adapterType: LlmProviderConfigSecret["adapterType"],
  transcript: unknown[],
  toolCall: ParsedToolCall,
  observation: Record<string, unknown>
): unknown[] {
  const output = JSON.stringify(observation);
  if (adapterType === "openai-native") {
    return [
      ...transcript,
      {
        type: "function_call_output",
        call_id: toolCall.id,
        output
      }
    ];
  }
  if (adapterType === "anthropic") {
    return [
      ...transcript,
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: output
          }
        ]
      }
    ];
  }
  return [
    ...transcript,
    {
      role: "tool",
      tool_call_id: toolCall.id,
      content: output
    }
  ];
}

async function executeAgentTool(
  toolCall: ParsedToolCall,
  store: MemoryStore,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown>> {
  const args = parseToolArguments(toolCall.arguments);
  if (toolCall.name === "owner_profile_read") {
    return readOwnerProfile(
      store,
      typeof args.query === "string" ? args.query : undefined,
      typeof args.limit === "number" ? args.limit : undefined
    );
  }
  if (toolCall.name === "memory_search") {
    return searchActiveMemories(
      store,
      typeof args.query === "string" ? args.query : "",
      typeof args.limit === "number" ? args.limit : undefined
    );
  }
  if (toolCall.name === "web_search") {
    return executeInternalTool(store, "web.search", {
      query: args.query,
      max_results: args.max_results
    }, fetchImpl);
  }
  if (toolCall.name === "web_fetch") {
    return executeInternalTool(store, "web.fetch", {
      url: args.url,
      max_chars: args.max_chars
    }, fetchImpl);
  }

  const registryTool = store.listToolRegistryEntries().find((tool) => tool.enabled && tool.name === toolCall.name);
  if (!registryTool) {
    return { success: false, error: `Unsupported tool: ${toolCall.name}` };
  }

  const result = await executeTool(
    store,
    registryTool.id,
    args,
    new McpClient({ fetchImpl }),
    { fetchImpl }
  );
  return {
    status: result.status,
    ...result.observation
  };
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readToolArg(raw: string, key: string): string | undefined {
  const value = parseToolArguments(raw)[key];
  return typeof value === "string" ? value : undefined;
}

function summarizeObservation(toolName: string, observation: Record<string, unknown>): string {
  if (observation.status === "confirmation_required") {
    return "Confirmation required";
  }
  if (observation.success === false || observation.status === "failed") {
    return typeof observation.error === "string" ? observation.error : "Tool failed.";
  }
  if (toolName === "web_search") {
    const results = Array.isArray(observation.results) ? observation.results.length : 0;
    return `${results} result${results === 1 ? "" : "s"}`;
  }
  if (toolName === "web_fetch") {
    const chars = typeof observation.content === "string" ? observation.content.length : 0;
    return `${chars} characters fetched`;
  }
  if (toolName === "owner_profile_read") {
    const count = Array.isArray(observation.attributes) ? observation.attributes.length : 0;
    return `${count} attribute${count === 1 ? "" : "s"}`;
  }
  if (toolName === "memory_search") {
    const count = Array.isArray(observation.memories) ? observation.memories.length : 0;
    return `${count} memor${count === 1 ? "y" : "ies"}`;
  }
  if (typeof observation.text === "string" && observation.text.length > 0) {
    return `${observation.text.length} characters returned`;
  }
  return "Completed";
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey ?? ""}`,
    "Content-Type": "application/json"
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Provider request failed: ${response.status} ${text.slice(0, 500)}`);
  }
  return text.length > 0 ? JSON.parse(text) as unknown : {};
}

function buildAnthropicToolRequest(
  transcript: unknown[]
): { system: string; messages: Array<{ role: "user" | "assistant"; content: unknown }> } {
  const systemParts: string[] = [];
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [];

  for (const entry of transcript) {
    const item = entry as { role?: string; content?: unknown };
    if (item.role === "system") {
      systemParts.push(String(item.content ?? ""));
      continue;
    }
    if (item.role === "user" || item.role === "assistant") {
      messages.push({
        role: item.role,
        content: item.content ?? ""
      });
    }
  }

  return {
    system: systemParts.join("\n\n"),
    messages: messages.length > 0 ? messages : [{ role: "user", content: "Hello" }]
  };
}

export function getActiveWebSearchProviderLabel(store: MemoryStore): string {
  return store.getWebToolsSettings().searchProvider;
}
