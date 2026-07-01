import { describe, expect, it } from "vitest";
import { isWebToolsConfiguredFromEnv, loadWebToolsConfig } from "./config.js";

describe("web tools config", () => {
  it("defaults to duckduckgo when no provider credentials are set", () => {
    const config = loadWebToolsConfig({
      WEB_TOOLS_ENABLED: "true"
    });
    expect(config.searchProvider).toBe("duckduckgo");
    expect(isWebToolsConfiguredFromEnv(config)).toBe(true);
  });

  it("prefers brave when an API key is present", () => {
    const config = loadWebToolsConfig({
      BRAVE_SEARCH_API_KEY: "test-key"
    });
    expect(config.searchProvider).toBe("brave");
    expect(isWebToolsConfiguredFromEnv(config)).toBe(true);
  });

  it("prefers bailian when a DashScope API key is present", () => {
    const config = loadWebToolsConfig({
      DASHSCOPE_API_KEY: "sk-test"
    });
    expect(config.searchProvider).toBe("bailian");
    expect(isWebToolsConfiguredFromEnv(config)).toBe(true);
  });

  it("respects searxng provider selection", () => {
    const config = loadWebToolsConfig({
      WEB_SEARCH_PROVIDER: "searxng",
      SEARXNG_URL: "http://localhost:8888"
    });
    expect(config.searchProvider).toBe("searxng");
  });

  it("can disable web tools entirely", () => {
    const config = loadWebToolsConfig({
      WEB_TOOLS_ENABLED: "false"
    });
    expect(isWebToolsConfiguredFromEnv(config)).toBe(false);
  });
});
