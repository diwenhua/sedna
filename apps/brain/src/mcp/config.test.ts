import { describe, expect, it } from "vitest";
import { syncMcpEnvConfig } from "./config.js";

describe("syncMcpEnvConfig", () => {
  it("is a no-op after Bailian search moved to built-in web provider", async () => {
    await expect(syncMcpEnvConfig({} as never)).resolves.toEqual({ synced: false });
  });
});
