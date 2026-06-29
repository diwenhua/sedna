import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@sedna/memory": fileURLToPath(new URL("../../packages/memory/src/index.ts", import.meta.url)),
      "@sedna/policy": fileURLToPath(new URL("../../packages/policy/src/index.ts", import.meta.url)),
      "@sedna/protocol": fileURLToPath(new URL("../../packages/protocol/src/index.ts", import.meta.url)),
      "@sedna/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node"
  }
});
