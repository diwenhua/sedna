import type { MemoryStore } from "@sedna/memory";

/** @deprecated Bailian web search is configured via Settings → Web Search (provider: bailian). */
export const BAILIAN_WEBSEARCH_MCP_URL = "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp";

export interface SyncMcpEnvResult {
  synced: boolean;
}

/** No-op: legacy env-based Bailian MCP auto-provisioning has been removed. */
export async function syncMcpEnvConfig(_store: MemoryStore): Promise<SyncMcpEnvResult> {
  return { synced: false };
}
