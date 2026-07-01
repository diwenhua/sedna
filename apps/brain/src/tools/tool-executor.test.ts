import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@sedna/memory";
import { executeTool } from "./tool-executor.js";

describe("tool executor web tools", () => {
  it("executes web.search through the internal tool registry", async () => {
    const store = createMemoryStore(":memory:");
    store.migrate();
    store.updateWebToolsSettings({
      enabled: true,
      searchProvider: "brave",
      braveApiKey: "test-key"
    });
    const tool = store.listToolRegistryEntries().find((entry) => entry.sourceId === "web.search");
    expect(tool).toBeDefined();

    const result = await executeTool(
      store,
      tool!.id,
      { query: "sedna agent", max_results: 1 },
      undefined,
      {
        fetchImpl: async () => new Response(JSON.stringify({
          web: { results: [{ title: "Result", url: "https://example.com", description: "Snippet" }] }
        }), { status: 200 })
      }
    );

    expect(result.status).toBe("completed");
    expect(result.observation.success).toBe(true);
    expect(result.observation.results).toHaveLength(1);
  });
});
