import type { McpDiscoveryResult } from "@sedna/memory";
import type { McpServer } from "@sedna/protocol";
import { normalizeMcpToolResult, StreamableHttpMcpSession } from "./streamable-http.js";

export interface McpConnectionTestResult {
  ok: boolean;
  serverId: string;
  message: string;
}

export interface McpToolCallResult {
  ok: boolean;
  content: Record<string, unknown>;
}

export interface McpClientOptions {
  fetchImpl?: typeof fetch;
}

export class McpClient {
  constructor(private readonly options: McpClientOptions = {}) {}

  async testConnection(server: McpServer): Promise<McpConnectionTestResult> {
    if (!server.enabled) {
      return { ok: false, serverId: server.id, message: "MCP server is disabled" };
    }
    if (server.transport === "stdio") {
      return {
        ok: false,
        serverId: server.id,
        message: "Stdio MCP transport is not supported yet. Use streamable_http for Bailian WebSearch."
      };
    }
    if (!server.url) {
      return { ok: false, serverId: server.id, message: "Streamable HTTP MCP server URL is missing" };
    }
    try {
      const session = new StreamableHttpMcpSession(server, this.options);
      await session.connect();
      return {
        ok: true,
        serverId: server.id,
        message: "Streamable HTTP MCP session established"
      };
    } catch (error) {
      return {
        ok: false,
        serverId: server.id,
        message: error instanceof Error ? error.message : "MCP connection failed"
      };
    }
  }

  async discover(server: McpServer): Promise<McpDiscoveryResult> {
    if (server.transport !== "streamable_http" || !server.url) {
      return { tools: [], resources: [], prompts: [] };
    }
    const session = new StreamableHttpMcpSession(server, this.options);
    await session.connect();
    const [tools, resources, prompts] = await Promise.all([
      session.request("tools/list").catch(() => ({})),
      session.request("resources/list").catch(() => ({})),
      session.request("prompts/list").catch(() => ({}))
    ]);
    return {
      tools: normalizeTools(toArray(toResult(tools).tools)),
      resources: normalizeResources(toArray(toResult(resources).resources)),
      prompts: normalizePrompts(toArray(toResult(prompts).prompts))
    };
  }

  async callTool(server: McpServer, toolName: string, input: Record<string, unknown>): Promise<McpToolCallResult> {
    if (server.transport !== "streamable_http" || !server.url) {
      throw new Error("MCP tool execution requires a streamable_http server URL");
    }
    const session = new StreamableHttpMcpSession(server, this.options);
    await session.connect();
    const result = await session.request("tools/call", { name: toolName, arguments: input });
    return { ok: true, content: normalizeMcpToolResult(result) };
  }
}

function toResult(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && "result" in value) {
    const wrapped = value as { result?: unknown };
    if (typeof wrapped.result === "object" && wrapped.result !== null) {
      return wrapped.result as Record<string, unknown>;
    }
  }
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function toArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];
}

function normalizeTools(values: Record<string, unknown>[]) {
  return values.map((item) => ({
    name: String(item.name),
    title: typeof item.title === "string" ? item.title : String(item.name),
    description: typeof item.description === "string" ? item.description : "",
    inputSchema: typeof item.inputSchema === "object" && item.inputSchema !== null ? item.inputSchema as Record<string, unknown> : {},
    outputSchema: typeof item.outputSchema === "object" && item.outputSchema !== null ? item.outputSchema as Record<string, unknown> : {}
  })).filter((item) => item.name.length > 0);
}

function normalizeResources(values: Record<string, unknown>[]) {
  return values.map((item) => ({
    uri: String(item.uri),
    name: typeof item.name === "string" ? item.name : String(item.uri),
    description: typeof item.description === "string" ? item.description : "",
    mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined
  })).filter((item) => item.uri.length > 0);
}

function normalizePrompts(values: Record<string, unknown>[]) {
  return values.map((item) => ({
    name: String(item.name),
    title: typeof item.title === "string" ? item.title : String(item.name),
    description: typeof item.description === "string" ? item.description : "",
    argumentsSchema: typeof item.argumentsSchema === "object" && item.argumentsSchema !== null ? item.argumentsSchema as Record<string, unknown> : {}
  })).filter((item) => item.name.length > 0);
}
