import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@sedna/policy": fileURLToPath(new URL("../policy/src/index.ts", import.meta.url)),
      "@sedna/protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node"
  }
});
