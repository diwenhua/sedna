import type { McpServer } from "@sedna/protocol";

const MCP_PROTOCOL_VERSION = "2024-11-05";

export interface StreamableHttpOptions {
  fetchImpl?: typeof fetch;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export class StreamableHttpMcpSession {
  private sessionId?: string;
  private initialized = false;

  constructor(
    private readonly server: McpServer,
    private readonly options: StreamableHttpOptions = {}
  ) {}

  async connect(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "sedna-brain", version: "0.1.0" }
    });
    await this.notify("notifications/initialized", {});
    this.initialized = true;
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const response = await this.postJsonRpc({
      jsonrpc: "2.0",
      id: `sedna-${method}-${Date.now()}`,
      method,
      params: params ?? {}
    });
    if (response.error) {
      throw new Error(response.error.message ?? `MCP ${method} failed`);
    }
    return response.result;
  }

  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    await this.postJsonRpc(
      {
        jsonrpc: "2.0",
        method,
        params: params ?? {}
      },
      { allowEmpty: true }
    );
  }

  private async postJsonRpc(
    payload: Record<string, unknown>,
    options: { allowEmpty?: boolean } = {}
  ): Promise<JsonRpcResponse> {
    if (!this.server.url) {
      throw new Error("Streamable HTTP MCP server URL is missing");
    }
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...this.server.headers
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const response = await fetchImpl(this.server.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    const nextSessionId = response.headers.get("mcp-session-id");
    if (nextSessionId) {
      this.sessionId = nextSessionId;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      return parseSseJsonRpc(text);
    }

    const text = await response.text();
    if (!text.trim()) {
      if (options.allowEmpty) {
        return {};
      }
      return {};
    }
    return JSON.parse(text) as JsonRpcResponse;
  }
}

export function parseSseJsonRpc(body: string): JsonRpcResponse {
  for (const block of body.split(/\n\n/)) {
    const dataLines = block
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());
    for (const data of dataLines) {
      if (!data || data === "[DONE]") {
        continue;
      }
      const parsed = JSON.parse(data) as JsonRpcResponse;
      if (parsed.result !== undefined || parsed.error) {
        return parsed;
      }
    }
  }
  return {};
}

export function normalizeMcpToolResult(result: unknown): Record<string, unknown> {
  if (typeof result !== "object" || result === null) {
    return { content: result };
  }
  const record = result as Record<string, unknown>;
  if (Array.isArray(record.content)) {
    const textParts = record.content
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => (typeof item.text === "string" ? item.text : JSON.stringify(item)))
      .filter(Boolean);
    if (textParts.length > 0) {
      return {
        ...record,
        text: textParts.join("\n"),
        content: record.content
      };
    }
  }
  return record;
}
