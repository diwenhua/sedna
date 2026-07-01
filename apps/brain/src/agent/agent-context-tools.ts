import type { MemoryStore } from "@sedna/memory";
import type { ProfileAttribute } from "@sedna/protocol";

export interface OwnerProfileAttributeEntry {
  key: string;
  semanticType: string;
  value: string;
  normalizedValue: string;
}

export function readOwnerProfile(
  store: MemoryStore,
  query?: string,
  limit = 20
): { success: true; attributes: OwnerProfileAttributeEntry[] } {
  const active = store.getOwnerProfile().attributes.filter((attribute) => attribute.status === "active");
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  const filtered = normalizedQuery.length === 0
    ? active
    : active.filter((attribute) => profileAttributeMatchesQuery(attribute, normalizedQuery));
  const boundedLimit = Math.min(Math.max(limit, 1), 50);

  return {
    success: true,
    attributes: filtered.slice(0, boundedLimit).map(formatProfileAttributeEntry)
  };
}

export function searchActiveMemories(
  store: MemoryStore,
  query: string,
  limit = 12
): { success: true; memories: Array<{ type: string; label: string; status: string }> } {
  const boundedLimit = Math.min(Math.max(limit, 1), 20);
  const memories = store.listActiveMemoryNodes(query.trim(), boundedLimit);

  return {
    success: true,
    memories: memories.map((node) => ({
      type: node.type,
      label: node.label,
      status: node.status
    }))
  };
}

function profileAttributeMatchesQuery(attribute: ProfileAttribute, query: string): boolean {
  const haystack = [
    attribute.key,
    attribute.semanticType,
    attribute.normalizedValue,
    ...Object.values(attribute.value).filter((value): value is string => typeof value === "string")
  ].join(" ").toLowerCase();
  const terms = query.split(/\s+/).filter((term) => term.length > 0);
  if (terms.length === 0) {
    return true;
  }
  return terms.some((term) => haystack.includes(term));
}

function formatProfileAttributeEntry(attribute: ProfileAttribute): OwnerProfileAttributeEntry {
  const normalizedValue = attribute.normalizedValue.trim().replace(/_/g, " ");
  let value = normalizedValue;
  if (value.length === 0) {
    for (const entry of Object.values(attribute.value)) {
      if (typeof entry === "string" && entry.trim().length > 0) {
        value = entry.trim();
        break;
      }
    }
  }
  if (value.length === 0) {
    value = attribute.key;
  }
  return {
    key: attribute.key,
    semanticType: attribute.semanticType,
    value,
    normalizedValue: attribute.normalizedValue
  };
}
