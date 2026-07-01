import { describe, expect, it } from "vitest";
import { normalizeMcpToolResult, parseSseJsonRpc } from "./streamable-http.js";

describe("parseSseJsonRpc", () => {
  it("extracts the first JSON-RPC result from SSE data lines", () => {
    const body = [
      "event: message",
      'data: {"jsonrpc":"2.0","id":"1","result":{"tools":[]}}',
      "",
      'data: {"jsonrpc":"2.0","id":"2","result":{"ignored":true}}'
    ].join("\n");

    expect(parseSseJsonRpc(body)).toEqual({
      jsonrpc: "2.0",
      id: "1",
      result: { tools: [] }
    });
  });

  it("returns JSON-RPC errors from SSE payloads", () => {
    const body = 'data: {"jsonrpc":"2.0","id":"1","error":{"message":"failed"}}';
    expect(parseSseJsonRpc(body)).toEqual({
      jsonrpc: "2.0",
      id: "1",
      error: { message: "failed" }
    });
  });
});

describe("normalizeMcpToolResult", () => {
  it("joins text content blocks into a text field", () => {
    expect(normalizeMcpToolResult({
      content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }]
    })).toMatchObject({
      text: "hello\nworld"
    });
  });
});
