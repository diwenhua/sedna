import type { MemoryStore } from "@sedna/memory";
import { resolveWebToolsConfig } from "./web/index.js";
import { runWebFetch } from "./web/fetch.js";
import { runWebSearch } from "./web/providers.js";

export async function executeInternalTool(
  store: MemoryStore,
  sourceId: string,
  input: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  const config = resolveWebToolsConfig(store);
  switch (sourceId) {
    case "web.search": {
      const query = typeof input.query === "string" ? input.query : "";
      const maxResults = typeof input.max_results === "number"
        ? input.max_results
        : config.searchMaxResults;
      const result = await runWebSearch(query, maxResults, config, fetchImpl);
      return result as unknown as Record<string, unknown>;
    }
    case "web.fetch": {
      const url = typeof input.url === "string" ? input.url : "";
      const maxChars = typeof input.max_chars === "number" ? input.max_chars : config.fetchMaxChars;
      const result = await runWebFetch(url, maxChars, config, fetchImpl);
      return result as unknown as Record<string, unknown>;
    }
    case "task.create":
      return {
        success: true,
        message: "Task creation is handled through the agent runtime confirmation flow.",
        input
      };
    case "suggest_action":
      return {
        success: true,
        message: "Suggested internal action recorded.",
        input
      };
    default:
      throw new Error(`Unsupported internal tool: ${sourceId}`);
  }
}
