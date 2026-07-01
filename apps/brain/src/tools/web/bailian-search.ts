import type { McpServer } from "@sedna/protocol";
import { normalizeMcpToolResult, StreamableHttpMcpSession } from "../../mcp/streamable-http.js";
import type { WebSearchResultItem } from "./types.js";

export const BAILIAN_WEBSEARCH_MCP_URL = "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp";

export async function searchBailian(
  query: string,
  limit: number,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<WebSearchResultItem[]> {
  const session = new StreamableHttpMcpSession(createEphemeralBailianServer(apiKey), { fetchImpl });
  await session.connect();
  const listRaw = await session.request("tools/list");
  const tools = extractToolList(listRaw);
  const searchTool = tools.find((tool) => /search/i.test(tool.name)) ?? tools[0];
  if (!searchTool) {
    throw new Error("Bailian WebSearch MCP returned no tools");
  }
  const result = await session.request("tools/call", {
    name: searchTool.name,
    arguments: buildSearchArguments(searchTool.inputSchema, query, limit)
  });
  return parseBailianSearchResults(result, limit);
}

function createEphemeralBailianServer(apiKey: string): McpServer {
  const now = new Date().toISOString();
  return {
    id: "builtin_bailian_websearch",
    name: "Bailian WebSearch",
    transport: "streamable_http",
    url: BAILIAN_WEBSEARCH_MCP_URL,
    headers: { Authorization: `Bearer ${apiKey}` },
    args: [],
    enabled: true,
    trustLevel: "first_party",
    status: "unknown",
    createdAt: now,
    updatedAt: now
  };
}

function extractToolList(value: unknown): Array<{ name: string; inputSchema: Record<string, unknown> }> {
  const record = toRecord(value);
  const nested = toRecord(record.tools);
  const tools = Array.isArray(nested.tools) ? nested.tools : Array.isArray(record.tools) ? record.tools : [];
  return tools
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      name: String(item.name ?? ""),
      inputSchema: typeof item.inputSchema === "object" && item.inputSchema !== null
        ? item.inputSchema as Record<string, unknown>
        : {}
    }))
    .filter((item) => item.name.length > 0);
}

function buildSearchArguments(
  inputSchema: Record<string, unknown>,
  query: string,
  limit: number
): Record<string, unknown> {
  const properties = typeof inputSchema.properties === "object" && inputSchema.properties !== null
    ? inputSchema.properties as Record<string, unknown>
    : {};
  const keys = Object.keys(properties);
  const queryKey = keys.find((key) => /query|q|search/i.test(key)) ?? "query";
  const limitKey = keys.find((key) => /max|limit|count|num/i.test(key));
  const args: Record<string, unknown> = { [queryKey]: query };
  if (limitKey) {
    args[limitKey] = limit;
  }
  return args;
}

export function parseBailianSearchResults(result: unknown, limit: number): WebSearchResultItem[] {
  const normalized = normalizeMcpToolResult(result);
  const candidates = [
    normalized.results,
    normalized.items,
    normalized.data,
    normalized.output,
    normalized.text
  ];

  for (const candidate of candidates) {
    const parsed = parseResultCandidate(candidate);
    if (parsed.length > 0) {
      return parsed.slice(0, limit);
    }
  }

  if (typeof normalized.text === "string" && normalized.text.trim().length > 0) {
    return [{
      title: "Bailian WebSearch",
      url: "",
      snippet: normalized.text.trim()
    }];
  }

  return [];
}

function parseResultCandidate(candidate: unknown): WebSearchResultItem[] {
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return [];
    }
    try {
      return parseResultCandidate(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(candidate)) {
    return [];
  }
  return candidate
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      title: pickString(item, ["title", "name", "page_title"]) || pickString(item, ["url", "link"]) || "Untitled",
      url: pickString(item, ["url", "link", "href"]) || "",
      snippet: pickString(item, ["snippet", "description", "summary", "content", "text", "body"]) || ""
    }))
    .filter((item) => item.title.length > 0 || item.snippet.length > 0);
}

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
