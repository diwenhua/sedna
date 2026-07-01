import type { WebToolsConfig } from "@sedna/memory";
import type { WebSearchResponse, WebSearchResultItem } from "./types.js";
import { searchBailian } from "./bailian-search.js";

const USER_AGENT = "Sedna/0.1 (+https://github.com/sedna-agent; self-hosted personal assistant)";

export async function runWebSearch(
  query: string,
  limit: number,
  config: WebToolsConfig,
  fetchImpl: typeof fetch = fetch
): Promise<WebSearchResponse> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      success: false,
      provider: config.searchProvider,
      query: trimmedQuery,
      results: [],
      error: "Search query must not be empty."
    };
  }

  try {
    const results = await dispatchSearch(trimmedQuery, limit, config, fetchImpl);
    return {
      success: true,
      provider: config.searchProvider,
      query: trimmedQuery,
      results
    };
  } catch (error) {
    return {
      success: false,
      provider: config.searchProvider,
      query: trimmedQuery,
      results: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function dispatchSearch(
  query: string,
  limit: number,
  config: WebToolsConfig,
  fetchImpl: typeof fetch
): Promise<WebSearchResultItem[]> {
  switch (config.searchProvider) {
    case "brave":
      return searchBrave(query, limit, config.braveApiKey!, fetchImpl);
    case "bailian":
      return searchBailian(query, limit, config.dashscopeApiKey!, fetchImpl);
    case "searxng":
      return searchSearxng(query, limit, config.searxngUrl!, fetchImpl);
    case "duckduckgo":
      return searchDuckDuckGo(query, limit, fetchImpl);
    default:
      throw new Error(`Unsupported web search provider: ${config.searchProvider}`);
  }
}

async function searchBrave(
  query: string,
  limit: number,
  apiKey: string,
  fetchImpl: typeof fetch
): Promise<WebSearchResultItem[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey
    }
  });
  if (!response.ok) {
    throw new Error(`Brave Search request failed: ${response.status}`);
  }
  const payload = await response.json() as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return (payload.web?.results ?? [])
    .slice(0, limit)
    .map((item) => ({
      title: item.title?.trim() || item.url || "Untitled",
      url: item.url ?? "",
      snippet: item.description?.trim() ?? ""
    }))
    .filter((item) => item.url.length > 0);
}

async function searchSearxng(
  query: string,
  limit: number,
  baseUrl: string,
  fetchImpl: typeof fetch
): Promise<WebSearchResultItem[]> {
  const url = new URL("/search", baseUrl.replace(/\/+$/, ""));
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT }
  });
  if (!response.ok) {
    throw new Error(`SearXNG request failed: ${response.status}`);
  }
  const payload = await response.json() as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (payload.results ?? [])
    .slice(0, limit)
    .map((item) => ({
      title: item.title?.trim() || item.url || "Untitled",
      url: item.url ?? "",
      snippet: item.content?.trim() ?? ""
    }))
    .filter((item) => item.url.length > 0);
}

async function searchDuckDuckGo(
  query: string,
  limit: number,
  fetchImpl: typeof fetch
): Promise<WebSearchResultItem[]> {
  const response = await fetchImpl("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT
    },
    body: new URLSearchParams({ q: query, b: "", kl: "" }).toString()
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo search request failed: ${response.status}`);
  }
  const html = await response.text();
  return parseDuckDuckGoHtml(html, limit);
}

function parseDuckDuckGoHtml(html: string, limit: number): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = [];
  const linkPattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  const links = [...html.matchAll(linkPattern)];
  const snippets = [...html.matchAll(snippetPattern)];

  for (let index = 0; index < links.length && results.length < limit; index += 1) {
    const rawUrl = decodeHtmlEntities(stripTags(decodeRedirectUrl(links[index]?.[1] ?? "")));
    const title = decodeHtmlEntities(stripTags(links[index]?.[2] ?? "")).trim();
    const snippet = decodeHtmlEntities(stripTags(snippets[index]?.[1] ?? "")).trim();
    if (!rawUrl.startsWith("http")) {
      continue;
    }
    results.push({ title: title || rawUrl, url: rawUrl, snippet });
  }
  return results;
}

function decodeRedirectUrl(value: string): string {
  if (value.includes("uddg=")) {
    try {
      const parsed = new URL(value, "https://duckduckgo.com");
      const target = parsed.searchParams.get("uddg");
      if (target) {
        return decodeURIComponent(target);
      }
    } catch {
      return value;
    }
  }
  return value;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
