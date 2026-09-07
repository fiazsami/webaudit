# 11 — Roadmap

Milestones in build order, each with a definition of done. Two ordering
principles:

1. The agent loop comes last. By then every tool it calls exists and is tested.
2. The extension arrives only once there is something worth running in it. Core
   and the CLI come first, because they are testable without a browser or a GPU.

Tracked in beads (`bd ready`). Spikes are listed at the end and gate the
milestones that name them.

## M0 — Scaffold

- pnpm workspace with `core`, `extension`, `cli`.
- TypeScript strict, shared `tsconfig.base.json`, ESLint, Prettier, vitest.
- `core` builds to ESM and is imported by both hosts.
- CI: install, build, test.

Done when: `pnpm -r build && pnpm -r test` passes on an empty project.

## M1 — core + CLI (no model, no browser)

- `PageSnapshot` schema (docs/02) and the pure snapshot builder.
- `Finding` schema and `Analyzer` interface (docs/03).
- `Capabilities` interface (docs/01) and the Node implementations.
- Analyzers with no external needs: `transport`, `cookies`, `forms`, `scripts`,
  `policy-presence`.
- Three hand-written snapshot fixtures in `fixtures/snapshots/`.

Done when: `pnpm scan fixtures/snapshots/baseline_synthetic.json --no-agent`
prints findings, and tests assert on `ruleId` and `severity` rather than prose.

(The command is `pnpm scan`, not `pnpm audit` as first drafted: `audit` is a
pnpm builtin and shadows a script of that name.)

## M2 — Extension: capture, store, UI shell

- Content script builds a snapshot with core's builder.
- Background worker: cookie flags, privileged `http`, domain enforcement,
  message routing (docs/07).
- `AuditStore` over IndexedDB (docs/09).
- Side panel assembles `Capabilities`, calls `core.audit(..., { noAgent: true })`,
  renders findings by severity.

Done when: open a page, click audit, and see real deterministic findings from a
live site in the side panel.

## M3 — Headers, CSP, trackers, libraries

_Spike S1 is done and cleared this: see docs/03 for what to vendor and what to
drop._

- Vendored Observatory sources under `analyzers/headers/vendor/` (MPL-2.0), with
  our own `mapping.ts` to `Finding`.
- `csp` analyzer via `csp_evaluator`.
- Tracker DB build script + `trackers` analyzer.
- `libraries` analyzer from retire.js data.
- All of them fed by the background worker's refetch of the page URL.

Done when: header, CSP, and tracker findings appear on fixtures and on a live
page, and fixture tests assert expected `ruleId`s.

Status: the analyzers, the mapping tables, and the three build scripts are done
and covered by tests, and the side panel now refetches headers through the
worker and loads the staged databases so all four run in the extension. The
"on a live page" half is the browser check that M2 also needs (web-rhp.7).

## M4 — WebLLM provider and explanations

_Gated on spike S2._

- `providers/webllm` as a browser-only entry point (docs/04).
- Engine lifecycle in a Web Worker; model manager UI with download progress.
- `RecordingProvider` and replay mode.
- `explainFinding`: the model writes `explanation` for each finding.

Done when: explanations render in the side panel, and a recorded trace replays
green in Node tests on a machine with no GPU.

Status: the replay half is done and is a test — `packages/cli/src/__tests__/replay.test.ts`
runs against `fixtures/recordings/` with no model present. The adapter, the
model manager, the curated model set, and SRI pinning are done. Explanations
rendering in the panel is part of the browser check (web-rhp.7).

## M5 — ToS pipeline

- Discover, fetch, extract, chunk, extract-clauses, merge, rank, report
  (docs/05).
- Policy cache in IndexedDB by content hash + model.
- Two labelled policy fixtures.
- ToS section in the side panel.

Done when: a real site's policy produces a `TosReport` whose quotes all verify
against the source text.

Status: done and verified against three real policies — Mozilla's terms,
Mozilla's Firefox privacy notice, and the Wikimedia Foundation's privacy policy.
Each produced clauses with zero verification failures, and a deliberately
fabricated clause was dropped every time. A fourth page with no readable article
correctly reported `fetch-failed` rather than an empty policy. The ToS section
renders in the side panel; seeing it against a live model is part of the browser
check (web-rhp.7).

## M6 — Agent loop

- Tool interface, budgets, orchestrator, trace (docs/06).
- Convert `fetchHeaders`, `runAnalyzers`, `discoverPolicies`, `analyzePolicies`,
  `explainFinding`, `lookupDomain` into tools.
- JSON action protocol over `response_format` — the only tool-calling path.
- Prompt-injection fixtures: policy pages containing instructions; assert the
  recorded tool-call sequence is unchanged versus a clean run.

Done when: an end-to-end audit completes within budget on a real site, and the
injection fixtures provably do not alter tool choices.

## M7 — Workbench and evals

- Full-page workbench tab: dashboard, history, **trace view** (docs/09). The
  trace view is the main research payoff; it gets the space it needs.
- In-browser evals runner comparing models on the labelled policy fixtures:
  recall, precision, schema adherence, tokens, wall time.

Done when: model comparison results land in `evals/results/` and are committed,
so comparisons are part of the repo's history.

## M8 — Offscreen, auto-audit, polish

_Gated on spike S3._

- Move the runtime from the side panel to an offscreen document so audits
  survive the panel closing.
- Auto-audit on navigation (opt-in).
- Firefox assessment — WebGPU support differs and may rule it out.
- Packaging and load-unpacked instructions.
- `docs/research-notes.md`: what worked, which models are usable, injection
  findings, where the architecture was wrong.

## Spikes

Timeboxed. Each writes its result back into the doc it affects.

- **S1 — Observatory vendor viability** (before M3). **Done: viable.** The
  vendored analyzer bundles for a browser in 24 modules / 60 kB with one runtime
  dependency (`structured-headers`); nine tests return correct verdicts and no
  server dependency is reachable. Three prunes are needed — `hsts.js` takes an
  injected preload map instead of reading it with `node:fs`, and
  `subresource-integrity.js` and `redirection.js` are dropped. The fallback is
  not needed. Full result in docs/03.
- **S2 — WebLLM in a side panel** (run during M0/M1). **Done.** Harness kept at
  `packages/extension/entrypoints/spike-s2/`, driver at
  `scripts/run-spike-s2.mjs`. Five results, three of them corrections to what
  this repo already claimed:

  1. **WebGPU works** in an extension-CSP page (Apple M4, Metal 3, 4 GB max
     buffer). Throughput is in docs/05 §4.
  2. **`response_format` honours a real zod schema** — verified against the
     clause-extraction schema on every model tried, valid first time. zod 4's
     `z.toJSONSchema()` replaces the `zod-to-json-schema` dependency.
  3. **Cancellation is worse than feared.** There is no `AbortSignal` in
     WebLLM's API at all, and `interruptGenerate()` leaves the engine returning
     empty `finish_reason: "abort"` responses forever after. Only building a new
     engine recovers, at 5 s (0.5B) to 36 s (8B). docs/06 rewritten accordingly.
  4. **The `connect-src` in docs/08 was wrong** and no model could have
     downloaded under it. HuggingFace serves weights from its Xet backend, and
     the model library is a `.wasm` from `raw.githubusercontent.com`.
  5. **docs/12 T7 was not true.** None of WebLLM's 163 prebuilt models carry SRI
     integrity hashes, so weights are unverified until we pin our own.

- **S3 — Offscreen document lifetime** (before M8). WebGPU in an offscreen
  document, which `chrome.offscreen` reason applies (`WORKERS` is the closest;
  there is no WebGPU reason), and whether Chrome closes it on idle. Fallback:
  background service worker with MLC's heartbeat keep-alive.

## Explicitly deferred

- Active scanning of any kind.
- Hosted model providers.
- Multi-page crawl beyond policy pages.
- MCP server exposure of tools.
