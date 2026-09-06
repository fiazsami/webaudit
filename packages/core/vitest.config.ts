import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Analyzer tests use fixtures, never the network (CLAUDE.md conventions).
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
