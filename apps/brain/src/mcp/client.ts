import type { McpDiscoveryResult } from "@sedna/memory";
import type { McpServer } from "@sedna/protocol";

export interface McpConnectionTestResult {
  ok: boolean;
  serverId: string;
  message: string;
}

export interface McpToolCallResult {
  ok: boolean;
  content: Record<string, unknown>;
}

export class McpClient {
  async testConnection(server: McpServer): Promise<McpConnectionTestResult> {
    if (!server.enabled) {
      return { ok: false, serverId: server.id, message: "MCP server is disabled" };
    }
    if (isMockServer(server)) {
      return { ok: true, serverId: server.id, message: "Mock MCP server is reachable" };
    }
    if (server.transport === "stdio") {
      return {
        ok: Boolean(server.command),
        serverId: server.id,
        message: server.command ? "Stdio MCP server command is configured" : "Stdio MCP server command is missing"
      };
    }
    if (!server.url) {
      return { ok: false, serverId: server.id, message: "Streamable HTTP MCP server URL is missing" };
    }
    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...server.headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: "sedna-capabilities", method: "initialize", params: {} })
      });
      return {
        ok: response.ok,
        serverId: server.id,
        message: response.ok ? "Streamable HTTP MCP server responded" : `HTTP ${response.status}`
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
    if (isMockServer(server)) {
      return {
        tools: [
          {
            name: "mock.echo",
            title: "Mock Echo",
            description: "Return the provided input as an audit-safe observation.",
            inputSchema: { type: "object", properties: { text: { type: "string" } } },
            outputSchema: { type: "object", properties: { text: { type: "string" } } },
            riskLevel: "low"
          },
          {
            name: "mock.external_write",
            title: "Mock External Write",
            description: "Simulate a risky external write action. Requires confirmation by default.",
            inputSchema: { type: "object", properties: { target: { type: "string" } } },
            outputSchema: { type: "object" },
            riskLevel: "high"
          }
        ],
        resources: [
          {
            uri: "mock://status",
            name: "Mock status",
            description: "Synthetic MCP server status resource.",
            mimeType: "application/json"
          }
        ],
        prompts: [
          {
            name: "mock.plan",
            title: "Mock plan",
            description: "Synthetic planning prompt.",
            argumentsSchema: { type: "object" }
          }
        ]
      };
    }
    if (server.transport === "streamable_http" && server.url) {
      return this.discoverHttp(server);
    }
    return { tools: [], resources: [], prompts: [] };
  }

  async callTool(server: McpServer, toolName: string, input: Record<string, unknown>): Promise<McpToolCallResult> {
    if (isMockServer(server)) {
      return {
        ok: true,
        content: {
          tool: toolName,
          observation: toolName.includes("external_write")
            ? "Mock external write was not executed; confirmation is required."
            : input
        }
      };
    }
    if (server.transport === "streamable_http" && server.url) {
      const response = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...server.headers },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `sedna-tools-call-${Date.now()}`,
          method: "tools/call",
          params: { name: toolName, arguments: input }
        })
      });
      if (!response.ok) {
        throw new Error(`MCP tools/call failed: HTTP ${response.status}`);
      }
      return { ok: true, content: await response.json() as Record<string, unknown> };
    }
    throw new Error("MCP stdio execution is not enabled in this MVP runtime");
  }

  private async discoverHttp(server: McpServer): Promise<McpDiscoveryResult> {
    const [tools, resources, prompts] = await Promise.all([
      this.callListMethod(server, "tools/list"),
      this.callListMethod(server, "resources/list"),
      this.callListMethod(server, "prompts/list")
    ]);
    return {
      tools: normalizeTools(toArray(toResult(tools).tools)),
      resources: normalizeResources(toArray(toResult(resources).resources)),
      prompts: normalizePrompts(toArray(toResult(prompts).prompts))
    };
  }

  private async callListMethod(server: McpServer, method: string): Promise<Record<string, unknown>> {
    const response = await fetch(server.url as string, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...server.headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: `sedna-${method}`, method, params: {} })
    });
    if (!response.ok) {
      return {};
    }
    return response.json() as Promise<Record<string, unknown>>;
  }
}

function isMockServer(server: McpServer): boolean {
  return server.command === "mock" || server.command === "mock-stdio" || server.name.toLowerCase().includes("mock");
}

function toResult(value: Record<string, unknown>): Record<string, unknown> {
  return typeof value.result === "object" && value.result !== null ? value.result as Record<string, unknown> : value;
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
