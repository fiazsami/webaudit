import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  // Gives tests WXT's auto-imports, the `browser` global backed by
  // fake-browser, and the same aliases the build uses.
  plugins: [WxtVitest()],
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".wxt/**", ".output/**"],
  },
});
