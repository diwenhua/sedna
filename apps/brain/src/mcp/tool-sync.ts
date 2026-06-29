import type { MemoryStore } from "@sedna/memory";
import { McpClient } from "./client.js";

export async function testMcpServer(store: MemoryStore, serverId: string, client = new McpClient()) {
  const server = store.getMcpServer(serverId);
  if (!server) {
    throw new Error(`MCP server not found: ${serverId}`);
  }
  const result = await client.testConnection(server);
  store.recordMcpConnection(serverId, result.ok, result.message);
  return result;
}

export async function refreshMcpServerTools(store: MemoryStore, serverId: string, client = new McpClient()) {
  const server = store.getMcpServer(serverId);
  if (!server) {
    throw new Error(`MCP server not found: ${serverId}`);
  }
  const connection = await client.testConnection(server);
  store.recordMcpConnection(serverId, connection.ok, connection.message);
  if (!connection.ok) {
    throw new Error(connection.message);
  }
  const discovery = await client.discover(server);
  return store.refreshMcpDiscovery(serverId, discovery);
}
