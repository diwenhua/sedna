import type { MemoryStore, WebToolsConfig } from "@sedna/memory";
import type { WebSearchProvider } from "@sedna/protocol";

export type WebSearchProviderId = WebSearchProvider;

export function resolveWebToolsConfig(store: MemoryStore): WebToolsConfig {
  return store.getWebToolsConfig();
}

export function isWebToolsConfigured(store: MemoryStore): boolean {
  return store.getWebToolsSettings().configured;
}

/** @deprecated Use resolveWebToolsConfig(store) in runtime code. Kept for env-only tests. */
export function loadWebToolsConfig(env: NodeJS.ProcessEnv = process.env): WebToolsConfig {
  const enabled = (env.WEB_TOOLS_ENABLED ?? "true") !== "false";
  const fetchMaxChars = Number.parseInt(env.WEB_FETCH_MAX_CHARS ?? "8000", 10);
  const fetchTimeoutMs = Number.parseInt(env.WEB_FETCH_TIMEOUT_MS ?? "15000", 10);
  const searchMaxResults = Number.parseInt(env.WEB_SEARCH_MAX_RESULTS ?? "5", 10);
  const braveApiKey = env.BRAVE_SEARCH_API_KEY?.trim() || undefined;
  const dashscopeApiKey = env.DASHSCOPE_API_KEY?.trim() || undefined;
  const searxngUrl = env.SEARXNG_URL?.trim() || undefined;
  const explicitProvider = env.WEB_SEARCH_PROVIDER?.trim().toLowerCase();

  let searchProvider: WebSearchProvider = "duckduckgo";
  if (explicitProvider === "brave" || explicitProvider === "searxng" || explicitProvider === "duckduckgo" || explicitProvider === "bailian") {
    searchProvider = explicitProvider;
  } else if (dashscopeApiKey) {
    searchProvider = "bailian";
  } else if (braveApiKey) {
    searchProvider = "brave";
  } else if (searxngUrl) {
    searchProvider = "searxng";
  }

  return {
    enabled,
    searchProvider,
    braveApiKey,
    dashscopeApiKey,
    searxngUrl,
    fetchMaxChars: Number.isFinite(fetchMaxChars) && fetchMaxChars > 0 ? fetchMaxChars : 8000,
    fetchTimeoutMs: Number.isFinite(fetchTimeoutMs) && fetchTimeoutMs > 0 ? fetchTimeoutMs : 15000,
    searchMaxResults: Number.isFinite(searchMaxResults) && searchMaxResults > 0 ? Math.min(searchMaxResults, 10) : 5
  };
}

export function isWebToolsConfiguredFromEnv(config: WebToolsConfig = loadWebToolsConfig()): boolean {
  if (!config.enabled) {
    return false;
  }
  switch (config.searchProvider) {
    case "brave":
      return Boolean(config.braveApiKey);
    case "bailian":
      return Boolean(config.dashscopeApiKey);
    case "searxng":
      return Boolean(config.searxngUrl);
    case "duckduckgo":
      return true;
    default:
      return false;
  }
}
