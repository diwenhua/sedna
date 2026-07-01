import { describe, expect, it } from "vitest";
import { loadWebToolsConfig } from "./config.js";
import { runWebSearch } from "./providers.js";

describe("web search providers", () => {
  it("parses brave search responses", async () => {
    const config = loadWebToolsConfig({
      WEB_SEARCH_PROVIDER: "brave",
      BRAVE_SEARCH_API_KEY: "test-key"
    });
    const result = await runWebSearch(
      "sedna agent",
      3,
      config,
      async () => new Response(JSON.stringify({
        web: {
          results: [
            { title: "Sedna docs", url: "https://example.com/sedna", description: "Agent framework" }
          ]
        }
      }), { status: 200 })
    );
    expect(result.success).toBe(true);
    expect(result.results).toEqual([
      {
        title: "Sedna docs",
        url: "https://example.com/sedna",
        snippet: "Agent framework"
      }
    ]);
  });

  it("parses searxng search responses", async () => {
    const config = loadWebToolsConfig({
      WEB_SEARCH_PROVIDER: "searxng",
      SEARXNG_URL: "http://localhost:8888"
    });
    const result = await runWebSearch(
      "privacy search",
      2,
      config,
      async () => new Response(JSON.stringify({
        results: [
          { title: "SearXNG", url: "https://searxng.org", content: "Privacy-respecting metasearch" }
        ]
      }), { status: 200 })
    );
    expect(result.success).toBe(true);
    expect(result.results[0]?.title).toBe("SearXNG");
  });

  it("parses duckduckgo html responses", async () => {
    const config = loadWebToolsConfig({
      WEB_SEARCH_PROVIDER: "duckduckgo"
    });
    const html = `
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com">Example Result</a>
      <a class="result__snippet">A helpful snippet.</a>
    `;
    const result = await runWebSearch(
      "example",
      5,
      config,
      async () => new Response(html, { status: 200 })
    );
    expect(result.success).toBe(true);
    expect(result.results[0]).toMatchObject({
      title: "Example Result",
      url: "https://example.com",
      snippet: "A helpful snippet."
    });
  });
});
