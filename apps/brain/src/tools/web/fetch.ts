import type { WebToolsConfig } from "@sedna/memory";
import type { WebFetchResponse } from "./types.js";

const USER_AGENT = "Sedna/0.1 (+https://github.com/sedna-agent; self-hosted personal assistant)";

export async function runWebFetch(
  rawUrl: string,
  maxChars: number | undefined,
  config: WebToolsConfig,
  fetchImpl: typeof fetch = fetch
): Promise<WebFetchResponse> {
  const limit = maxChars && maxChars > 0 ? Math.min(maxChars, config.fetchMaxChars) : config.fetchMaxChars;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch {
    return {
      success: false,
      url: rawUrl,
      content: "",
      truncated: false,
      error: "Invalid URL."
    };
  }

  if (!isAllowedFetchUrl(parsedUrl)) {
    return {
      success: false,
      url: parsedUrl.toString(),
      content: "",
      truncated: false,
      error: "URL is not allowed for web fetch."
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
    const response = await fetchImpl(parsedUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": USER_AGENT
      },
      redirect: "follow",
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false,
        url: parsedUrl.toString(),
        content: "",
        truncated: false,
        error: `Fetch failed: HTTP ${response.status}`
      };
    }

    const contentType = response.headers.get("content-type") ?? "text/plain";
    const rawBody = await response.text();
    const title = extractTitle(rawBody);
    const text = contentType.includes("html") ? htmlToText(rawBody) : rawBody;
    const normalized = normalizeWhitespace(text);
    const truncated = normalized.length > limit;
    return {
      success: true,
      url: parsedUrl.toString(),
      title,
      content: truncated ? normalized.slice(0, limit) : normalized,
      truncated
    };
  } catch (error) {
    return {
      success: false,
      url: parsedUrl.toString(),
      content: "",
      truncated: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function isAllowedFetchUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return false;
  }
  if (hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1") {
    return false;
  }
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
    return false;
  }
  return true;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? normalizeWhitespace(stripTags(match[1])) : undefined;
}

function htmlToText(html: string): string {
  return normalizeWhitespace(
    stripTags(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, "\n")
    )
  );
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}
