/**
 * `core` — the host-agnostic audit runtime.
 *
 * Nothing in this package may touch Node built-ins, DOM globals, or `chrome.*`
 * (CLAUDE.md hard rule 1). The compiler enforces it: `tsconfig.json` here omits
 * the DOM and Node type libraries entirely, so those globals do not exist.
 *
 * The public surface described in docs/01 — `audit()`, `runAnalyzers()`, the
 * `Capabilities` and `ModelProvider` interfaces, the snapshot builder — arrives
 * in M1. This module is deliberately empty until then; the scaffold's job is to
 * prove the package builds to ESM and imports cleanly from both hosts.
 */

export const VERSION = "0.0.0";
