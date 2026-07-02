import { commandRun, fileList, fileRead, fileSearch, fileWrite, type WorkerRuntimePolicy } from "./capabilities.js";

export interface WorkerAgentLlmConfig {
  adapterType: "openai-compatible" | "openai-native" | "anthropic" | "gemini";
  baseUrl?: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

interface LocalToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface WorkerAgentStep {
  tool: string;
  summary: string;
}

const LOCAL_TOOL_DEFINITIONS: LocalToolDefinition[] = [
  {
    type: "function",
    name: "file_list",
    description: "List direct child files and directories under one path. Does not recurse.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute directory path." },
        max_entries: { type: "number", description: "Maximum entries (1-200)." }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "file_search",
    description: "Search file names recursively under one or more paths.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Filename or keyword." },
        paths: { type: "array", items: { type: "string" }, description: "Optional root paths. Defaults to home directory." },
        max_results: { type: "number", description: "Maximum matches (1-50)." }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "file_read",
    description: "Read one local text file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute file path." },
        max_bytes: { type: "number", description: "Maximum bytes (1-200000)." }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "file_write",
    description: "Create or update a local text file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute file path." },
        content: { type: "string", description: "Text content to write." },
        mode: { type: "string", enum: ["overwrite", "append"], description: "Write mode." },
        create_directories: { type: "boolean", description: "Create parent directories when missing." }
      },
      required: ["path", "content"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "command_run",
    description: "Run a shell command on the local machine and return stdout, stderr, and exit code.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute." },
        cwd: { type: "string", description: "Working directory. Defaults to worker process cwd." },
        timeout_ms: { type: "number", description: "Timeout in milliseconds." }
      },
      required: ["command"],
      additionalProperties: false
    }
  }
];

export async function runWorkerAgentTask(input: {
  goal: string;
  context?: string;
  policy: WorkerRuntimePolicy;
  llm: WorkerAgentLlmConfig;
  fetchImpl?: typeof fetch;
  maxRounds?: number;
}): Promise<Record<string, unknown>> {
  if (input.llm.adapterType === "gemini") {
    return { success: false, error: "Worker agent does not support Gemini adapter yet. Use openai-native, openai-compatible, or anthropic for chat_reply." };
  }

  const fetchImpl = input.fetchImpl ?? fetch;

  const systemPrompt = [
    "You are Sedna Worker Agent, a general-purpose local execution agent on the owner's device.",
    "Complete the assigned task using the available local tools: file_list, file_search, file_read, file_write, and command_run.",
    "You may inspect and modify the local filesystem and run shell commands when needed.",
    "Sensitive paths such as .env, .ssh, credentials, secrets, and runtime databases are blocked.",
    "Never invent file names, directory contents, command output, or file text.",
    "Prefer direct evidence from tools. Use command_run for git, package managers, build tools, and other CLI workflows.",
    "When you have enough evidence, answer with concise factual results for the Central Brain to summarize."
  ].join("\n");

  const userPrompt = [
    `Task goal:\n${input.goal.trim()}`,
    input.context?.trim() ? `\nAdditional context:\n${input.context.trim()}` : ""
  ].join("");

  let transcript: unknown[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];
  const steps: WorkerAgentStep[] = [];
  const maxRounds = input.maxRounds ?? 16;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await callModelWithTools(input.llm, transcript, LOCAL_TOOL_DEFINITIONS, fetchImpl);
    const toolCalls = extractToolCalls(input.llm.adapterType, response);
    if (toolCalls.length === 0) {
      const answer = extractAssistantText(input.llm.adapterType, response);
      return {
        success: true,
        summary: answer.slice(0, 500),
        answer,
        steps
      };
    }

    transcript = appendToolRound(input.llm.adapterType, transcript, response, toolCalls);
    const toolResults: Array<{ toolCall: ParsedToolCall; observation: Record<string, unknown> }> = [];
    for (const toolCall of toolCalls) {
      const args = parseToolArguments(toolCall.arguments);
      const observation = await executeLocalTool(toolCall.name, args, input.policy);
      steps.push({ tool: toolCall.name, summary: summarizeLocalTool(toolCall.name, observation) });
      toolResults.push({ toolCall, observation });
    }
    transcript = appendToolOutputs(input.llm.adapterType, transcript, toolResults);
  }

  return {
    success: false,
    error: "Worker agent exceeded the maximum tool rounds.",
    steps
  };
}

async function callModelWithTools(
  llm: WorkerAgentLlmConfig,
  transcript: unknown[],
  tools: LocalToolDefinition[],
  fetchImpl: typeof fetch
): Promise<unknown> {
  if (llm.adapterType === "openai-native") {
    const response = await fetchImpl(`${trimBaseUrl(llm.baseUrl ?? "https://api.openai.com/v1")}/responses`, {
      method: "POST",
      headers: authHeaders(llm.apiKey),
      body: JSON.stringify({
        model: llm.model,
        input: transcript,
        tools,
        temperature: llm.temperature,
        max_output_tokens: llm.maxTokens
      })
    });
    return readJsonResponse(response);
  }

  if (llm.adapterType === "anthropic") {
    const anthropicRequest = buildAnthropicToolRequest(transcript);
    const response = await fetchImpl(`${trimBaseUrl(llm.baseUrl ?? "https://api.anthropic.com/v1")}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": llm.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: llm.model,
        system: anthropicRequest.system,
        messages: anthropicRequest.messages,
        tools: toAnthropicTools(tools),
        temperature: llm.temperature,
        max_tokens: llm.maxTokens
      })
    });
    return readJsonResponse(response);
  }

  const response = await fetchImpl(`${trimBaseUrl(llm.baseUrl ?? "https://api.openai.com/v1")}/chat/completions`, {
    method: "POST",
    headers: authHeaders(llm.apiKey),
    body: JSON.stringify({
      model: llm.model,
      messages: transcript,
      tools: tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      })),
      temperature: llm.temperature,
      max_tokens: llm.maxTokens
    })
  });
  return readJsonResponse(response);
}

async function executeLocalTool(
  toolName: string,
  args: Record<string, unknown>,
  policy: WorkerRuntimePolicy
): Promise<Record<string, unknown>> {
  try {
    if (toolName === "file_list") {
      const path = typeof args.path === "string" ? args.path : "";
      if (path.length === 0) {
        return { success: false, error: "file_list requires path." };
      }
      return { success: true, ...(await fileList({
        path,
        max_entries: typeof args.max_entries === "number" ? args.max_entries : undefined
      }, policy)) };
    }
    if (toolName === "file_search") {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (query.length === 0) {
        return { success: false, error: "file_search requires query." };
      }
      const paths = Array.isArray(args.paths)
        ? args.paths.map(String)
        : policy.allowedPaths;
      return { success: true, ...(await fileSearch({
        query,
        paths,
        max_results: typeof args.max_results === "number" ? args.max_results : undefined
      }, policy)) };
    }
    if (toolName === "file_read") {
      const path = typeof args.path === "string" ? args.path : "";
      if (path.length === 0) {
        return { success: false, error: "file_read requires path." };
      }
      return { success: true, ...(await fileRead({
        path,
        max_bytes: typeof args.max_bytes === "number" ? args.max_bytes : undefined
      }, policy)) };
    }
    if (toolName === "file_write") {
      const pathValue = typeof args.path === "string" ? args.path : "";
      const content = typeof args.content === "string" ? args.content : "";
      if (pathValue.length === 0) {
        return { success: false, error: "file_write requires path." };
      }
      if (content.length === 0) {
        return { success: false, error: "file_write requires content." };
      }
      const mode = args.mode === "append" ? "append" : "overwrite";
      return { success: true, ...(await fileWrite({
        path: pathValue,
        content,
        mode,
        create_directories: args.create_directories === true
      }, policy)) };
    }
    if (toolName === "command_run") {
      const command = typeof args.command === "string" ? args.command : "";
      if (command.trim().length === 0) {
        return { success: false, error: "command_run requires command." };
      }
      return { success: true, ...(await commandRun({
        command,
        cwd: typeof args.cwd === "string" ? args.cwd : undefined,
        timeout_ms: typeof args.timeout_ms === "number" ? args.timeout_ms : undefined
      }, policy)) };
    }
    return { success: false, error: `Unsupported local tool: ${toolName}` };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function summarizeLocalTool(toolName: string, observation: Record<string, unknown>): string {
  if (observation.success === false) {
    return typeof observation.error === "string" ? observation.error : "Tool failed.";
  }
  if (toolName === "file_list") {
    const count = Array.isArray(observation.entries) ? observation.entries.length : 0;
    return `${count} entr${count === 1 ? "y" : "ies"}`;
  }
  if (toolName === "file_search") {
    const count = Array.isArray(observation.matches) ? observation.matches.length : 0;
    return `${count} match${count === 1 ? "" : "es"}`;
  }
  if (toolName === "file_read") {
    const size = typeof observation.size === "number" ? observation.size : 0;
    return `${size} byte${size === 1 ? "" : "s"} read`;
  }
  if (toolName === "file_write") {
    const bytes = typeof observation.bytes_written === "number" ? observation.bytes_written : 0;
    return `${bytes} byte${bytes === 1 ? "" : "s"} written`;
  }
  if (toolName === "command_run") {
    const exitCode = observation.exit_code;
    return typeof exitCode === "number" ? `exit ${exitCode}` : "command finished";
  }
  return "Completed";
}

function extractToolCalls(adapterType: WorkerAgentLlmConfig["adapterType"], response: unknown): ParsedToolCall[] {
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

function extractAssistantText(adapterType: WorkerAgentLlmConfig["adapterType"], response: unknown): string {
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
    return "";
  }

  if (adapterType === "anthropic") {
    return (response as { content?: Array<{ type?: string; text?: string }> }).content
      ?.filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
      .trim() ?? "";
  }

  const content = (response as { choices?: Array<{ message?: { content?: string | null } }> }).choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function appendToolRound(
  adapterType: WorkerAgentLlmConfig["adapterType"],
  transcript: unknown[],
  response: unknown,
  toolCalls: ParsedToolCall[]
): unknown[] {
  void toolCalls;
  if (adapterType === "openai-native") {
    const output = (response as { output?: unknown[] }).output ?? [];
    return [...transcript, ...output.filter((item) => {
      const typed = item as { type?: string };
      return typed.type === "function_call" || typed.type === "message";
    })];
  }

  if (adapterType === "anthropic") {
    const content = (response as { content?: Array<Record<string, unknown>> }).content ?? [];
    return [...transcript, { role: "assistant", content }];
  }

  const message = (response as { choices?: Array<{ message?: Record<string, unknown> }> }).choices?.[0]?.message;
  return message ? [...transcript, message] : transcript;
}

function appendToolOutputs(
  adapterType: WorkerAgentLlmConfig["adapterType"],
  transcript: unknown[],
  results: Array<{ toolCall: ParsedToolCall; observation: Record<string, unknown> }>
): unknown[] {
  if (results.length === 0) {
    return transcript;
  }
  if (adapterType === "anthropic") {
    return [...transcript, {
      role: "user",
      content: results.map(({ toolCall, observation }) => ({
        type: "tool_result",
        tool_use_id: toolCall.id,
        content: JSON.stringify(observation)
      }))
    }];
  }
  let next = transcript;
  for (const { toolCall, observation } of results) {
    next = appendToolOutput(adapterType, next, toolCall, observation);
  }
  return next;
}

function appendToolOutput(
  adapterType: WorkerAgentLlmConfig["adapterType"],
  transcript: unknown[],
  toolCall: ParsedToolCall,
  observation: Record<string, unknown>
): unknown[] {
  const output = JSON.stringify(observation);
  if (adapterType === "openai-native") {
    return [...transcript, { type: "function_call_output", call_id: toolCall.id, output }];
  }
  if (adapterType === "anthropic") {
    return [...transcript, {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolCall.id, content: output }]
    }];
  }
  return [...transcript, { role: "tool", tool_call_id: toolCall.id, content: output }];
}

function toAnthropicTools(tools: LocalToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  }));
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
      messages.push({ role: item.role, content: item.content ?? "" });
    }
  }

  return {
    system: systemParts.join("\n\n"),
    messages: messages.length > 0 ? messages : [{ role: "user", content: "Hello" }]
  };
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Worker agent LLM request failed: ${response.status} ${text.slice(0, 500)}`);
  }
  return text.length > 0 ? JSON.parse(text) as unknown : {};
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
