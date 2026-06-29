import type { MemoryStore } from "@sedna/memory";
import type { ToolRegistryEntry } from "@sedna/protocol";

export function listPolicyFilteredTools(store: MemoryStore): ToolRegistryEntry[] {
  return store
    .listToolRegistryEntries()
    .filter((tool) => tool.enabled)
    .map((tool) => ({
      ...tool,
      description: sanitizeToolDescription(tool.description)
    }));
}

function sanitizeToolDescription(description: string): string {
  return description.replace(/\b(ignore|override|bypass)\b/gi, "[redacted-policy-word]");
}
