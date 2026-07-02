import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { runWorkerAgentTask } from "./agent-loop.js";

describe("worker agent loop", () => {
  it("uses local file tools through an OpenAI-compatible tool loop", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `sedna-worker-agent-${randomUUID()}-`));
    await writeFile(path.join(root, "README.md"), "# Sedna", "utf8");

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: unknown[] };
      const last = body.messages?.at(-1) as { role?: string } | undefined;
      if (last?.role !== "tool") {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: "call_1",
                type: "function",
                function: {
                  name: "file_list",
                  arguments: JSON.stringify({ path: root })
                }
              }]
            }
          }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: "Found README.md in the directory."
          }
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const result = await runWorkerAgentTask({
      goal: `List files under ${root}`,
      policy: {
        allowedPaths: [root],
        maxReadBytes: 200000,
        maxWriteBytes: 500000,
        maxSearchResults: 50,
        maxListEntries: 50,
        maxCommandMs: 5000,
        maxCommandOutputBytes: 200000
      },
      llm: {
        adapterType: "openai-compatible",
        apiKey: "test-key",
        model: "test-model",
        temperature: 0.2,
        maxTokens: 1000
      },
      fetchImpl
    });

    expect(result.success).toBe(true);
    expect(result.answer).toContain("README.md");
    expect(result.steps).toEqual([{ tool: "file_list", summary: "1 entry" }]);
  });

  it("uses the OpenAI responses API for openai-native adapters", async () => {
    const root = "/tmp/sedna-worker";
    let requestedUrl = "";
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "Done." }]
        }],
        output_text: "Done."
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const result = await runWorkerAgentTask({
      goal: `List files under ${root}`,
      policy: {
        allowedPaths: [root],
        maxReadBytes: 200000,
        maxWriteBytes: 500000,
        maxSearchResults: 50,
        maxListEntries: 50,
        maxCommandMs: 5000,
        maxCommandOutputBytes: 200000
      },
      llm: {
        adapterType: "openai-native",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-key",
        model: "gpt-4.1-mini",
        temperature: 0.2,
        maxTokens: 1000
      },
      fetchImpl
    });

    expect(requestedUrl).toBe("https://api.openai.com/v1/responses");
    expect(result.success).toBe(true);
    expect(result.answer).toBe("Done.");
  });

  it("batches anthropic tool_result blocks into one user message", async () => {
    const root = "/tmp/sedna-worker";
    let requestBody: { messages?: unknown[] } = {};
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as { messages?: unknown[] };
      const messages = requestBody.messages ?? [];
      const last = messages.at(-1) as { role?: string; content?: unknown } | undefined;
      if (last?.role !== "user" || !Array.isArray(last.content) || last.content.length === 0) {
        return new Response(JSON.stringify({
          content: [
            { type: "tool_use", id: "call_a", name: "file_list", input: { path: root } },
            { type: "tool_use", id: "call_b", name: "file_search", input: { query: "README", paths: [root] } }
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "Found README.md." }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const result = await runWorkerAgentTask({
      goal: "Inspect project files",
      policy: {
        allowedPaths: [root],
        maxReadBytes: 200000,
        maxWriteBytes: 500000,
        maxSearchResults: 50,
        maxListEntries: 50,
        maxCommandMs: 5000,
        maxCommandOutputBytes: 200000
      },
      llm: {
        adapterType: "anthropic",
        apiKey: "test-key",
        model: "claude-sonnet-4-20250514",
        temperature: 0.2,
        maxTokens: 1000
      },
      fetchImpl
    });

    const secondRequestMessages = requestBody.messages ?? [];
    const toolResultMessage = secondRequestMessages.at(-1) as {
      role?: string;
      content?: Array<{ type?: string; tool_use_id?: string }>;
    };
    expect(toolResultMessage.role).toBe("user");
    expect(toolResultMessage.content?.map((item) => item.tool_use_id)).toEqual(["call_a", "call_b"]);
    expect(result.success).toBe(true);
    expect(result.answer).toBe("Found README.md.");
  });
});
