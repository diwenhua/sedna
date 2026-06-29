import type { MemoryStore } from "@sedna/memory";
import type { ToolRegistryEntry } from "@sedna/protocol";
import { McpClient } from "../mcp/client.js";

export interface ToolExecutionResult {
  status: "completed" | "confirmation_required" | "failed";
  tool: ToolRegistryEntry;
  observation: Record<string, unknown>;
}

export async function executeTool(
  store: MemoryStore,
  toolId: string,
  input: Record<string, unknown> = {},
  client = new McpClient()
): Promise<ToolExecutionResult> {
  const tool = store.getToolRegistryEntry(toolId);
  if (!tool) {
    throw new Error(`Tool not found: ${toolId}`);
  }
  store.recordEvent("mcp.tool.called", "Tool called", {
    toolId,
    source: tool.source,
    inputKeys: Object.keys(input)
  });
  store.recordAuditRecord("assistant", "mcp.tool.called", "tool", toolId, {
    source: tool.source,
    inputKeys: Object.keys(input)
  });
  if (tool.requiresConfirmation || tool.riskLevel === "high") {
    return {
      status: "confirmation_required",
      tool,
      observation: { message: "Confirmation required before tool execution" }
    };
  }
  try {
    let observation: Record<string, unknown>;
    if (tool.source === "mcp") {
      const mcpTool = store.listMcpTools().find((item) => item.id === tool.sourceId);
      if (!mcpTool) {
        throw new Error(`MCP tool not found: ${tool.sourceId}`);
      }
      const server = store.getMcpServer(mcpTool.serverId);
      if (!server) {
        throw new Error(`MCP server not found: ${mcpTool.serverId}`);
      }
      observation = (await client.callTool(server, mcpTool.name, input)).content;
    } else if (tool.source === "skill") {
      observation = { message: "Use /api/skills/:id/test to run skill workflows in the MVP" };
    } else {
      observation = { message: "Internal tool executed", input };
    }
    store.markToolUsed(toolId);
    store.recordEvent("mcp.tool.completed", "Tool completed", { toolId, source: tool.source });
    store.recordAuditRecord("assistant", "mcp.tool.completed", "tool", toolId, {
      source: tool.source,
      outputKeys: Object.keys(observation)
    });
    return { status: "completed", tool, observation };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    store.recordEvent("mcp.tool.failed", "Tool failed", { toolId, source: tool.source, error: message });
    store.recordAuditRecord("assistant", "mcp.tool.failed", "tool", toolId, { source: tool.source, error: message });
    return { status: "failed", tool, observation: { error: message } };
  }
}
