import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // "server-only" throws outside a React Server Components bundle — stub it
      // so server modules (model pins, prompts) stay unit-testable in Node.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
