import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Node built-ins that `core` may not import (CLAUDE.md hard rule 1). The
 * compiler already removes the *types* — core's tsconfig has no `node` types —
 * but a bare `import "node:fs"` still resolves at runtime, so lint closes it.
 */
const NODE_BUILTINS = [
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dns",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "querystring",
  "readline",
  "stream",
  "timers",
  "tls",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.output/**",
      "**/.wxt/**",
      "**/coverage/**",
      "**/node_modules/**",
      ".beads/**",
      "fixtures/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Root-level config files sit outside every package tsconfig.
          allowDefaultProject: ["eslint.config.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Hard rule 2: no `any` at boundaries. Treat it as no `any` at all and
      // make each exception argue for itself.
      "@typescript-eslint/no-explicit-any": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
  },

  // ---------------------------------------------------------------------
  // CLAUDE.md hard rule 1: packages/core runs unmodified in Node and in a
  // browser. It reaches the world only through the Capabilities object.
  // ---------------------------------------------------------------------
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: NODE_BUILTINS.map((name) => ({
            name,
            message:
              "core must run in the browser too. Take this through Capabilities (docs/01).",
          })),
          patterns: [
            {
              group: ["node:*"],
              message:
                "core must run in the browser too. Take this through Capabilities (docs/01).",
            },
            {
              group: ["extension", "extension/*", "cli", "cli/*"],
              message: "core must not import from a host package (docs/01).",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...[
          "window",
          "document",
          "navigator",
          "location",
          "localStorage",
          "sessionStorage",
          "chrome",
          "browser",
          "fetch",
          "XMLHttpRequest",
          "indexedDB",
          "caches",
          "WebSocket",
        ].map((name) => ({
          name,
          message: "core has no host APIs. Take this through Capabilities (docs/01).",
        })),
        ...["process", "global", "__dirname", "__filename", "require", "Buffer"].map(
          (name) => ({
            name,
            message: "core must run in the browser too (docs/01).",
          }),
        ),
      ],
      // The clock arrives through Capabilities so traces are reproducible
      // (CLAUDE.md hard rule 6).
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: "Use capabilities.clock.now() so runs stay reproducible (docs/01).",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Use capabilities.clock.now() so runs stay reproducible (docs/01).",
        },
      ],
    },
  },

  {
    files: ["packages/cli/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["packages/extension/**/*.ts"],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
    rules: {
      // WXT auto-imports defineBackground, defineContentScript, browser, etc.
      "no-undef": "off",
    },
  },

  // Config files and tests are host code, not core.
  {
    files: ["**/*.config.ts", "**/*.config.js", "eslint.config.js"],
    languageOptions: { globals: globals.node },
    rules: { "no-restricted-imports": "off", "no-restricted-globals": "off" },
  },
  {
    // This file is not part of any package tsconfig, so type-aware rules have
    // no types to work from.
    files: ["eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["**/*.test.ts"],
    rules: { "no-restricted-globals": "off", "no-restricted-syntax": "off" },
  },
);
