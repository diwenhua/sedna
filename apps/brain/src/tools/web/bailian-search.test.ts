import { describe, expect, it } from "vitest";
import { parseBailianSearchResults } from "./bailian-search.js";
import { BAILIAN_WEBSEARCH_MCP_URL, searchBailian } from "./bailian-search.js";

describe("searchBailian", () => {
  it("calls Bailian WebSearch MCP and normalizes JSON results", async () => {
    const result = await searchBailian(
      "sedna agent",
      2,
      "sk-test",
      async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (!url.includes("/mcp")) {
          throw new Error(`Unexpected URL: ${url}`);
        }
        const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: Record<string, unknown> };
        if (body.method === "initialize") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: body.params,
            result: { protocolVersion: "2024-11-05", capabilities: {} }
          }), {
            status: 200,
            headers: { "Content-Type": "application/json", "mcp-session-id": "sess-1" }
          });
        }
        if (body.method === "notifications/initialized") {
          return new Response("", { status: 202 });
        }
        if (body.method === "tools/list") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: {
              tools: [{
                name: "web_search",
                inputSchema: {
                  type: "object",
                  properties: { query: { type: "string" }, max_results: { type: "number" } }
                }
              }]
            }
          }), {
            status: 200,
            headers: { "Content-Type": "application/json", "mcp-session-id": "sess-1" }
          });
        }
        if (body.method === "tools/call") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            result: {
              content: [{
                type: "text",
                text: JSON.stringify([
                  { title: "Sedna docs", url: "https://example.com/sedna", snippet: "Agent framework" }
                ])
              }]
            }
          }), {
            status: 200,
            headers: { "Content-Type": "application/json", "mcp-session-id": "sess-1" }
          });
        }
        throw new Error(`Unexpected MCP method: ${body.method}`);
      }
    );

    expect(result).toEqual([
      { title: "Sedna docs", url: "https://example.com/sedna", snippet: "Agent framework" }
    ]);
  });
});

describe("parseBailianSearchResults", () => {
  it("parses structured result arrays", () => {
    expect(parseBailianSearchResults({
      results: [{ title: "A", url: "https://a.test", description: "Alpha" }]
    }, 5)).toEqual([
      { title: "A", url: "https://a.test", snippet: "Alpha" }
    ]);
  });
});

describe("BAILIAN_WEBSEARCH_MCP_URL", () => {
  it("points at the Bailian WebSearch MCP endpoint", () => {
    expect(BAILIAN_WEBSEARCH_MCP_URL).toContain("/mcps/WebSearch/mcp");
  });
});
