import { describe, expect, it } from "vitest";
import { loadWebToolsConfig } from "./config.js";
import { isAllowedFetchUrl, runWebFetch } from "./fetch.js";

describe("web fetch", () => {
  it("blocks localhost URLs", () => {
    expect(isAllowedFetchUrl(new URL("http://localhost/docs"))).toBe(false);
    expect(isAllowedFetchUrl(new URL("http://127.0.0.1/docs"))).toBe(false);
  });

  it("extracts readable text from html responses", async () => {
    const config = loadWebToolsConfig({});
    const result = await runWebFetch(
      "https://example.com/page",
      1000,
      config,
      async () => new Response("<html><head><title>Example</title></head><body><p>Hello world</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" }
      })
    );
    expect(result.success).toBe(true);
    expect(result.title).toBe("Example");
    expect(result.content).toContain("Hello world");
  });
});
