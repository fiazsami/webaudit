# WebAudit

An open source **browser extension** that runs a local agent to audit the website
you are looking at. A content script captures what the page is doing; an agent
runtime inside the extension analyzes it and explains security risks and what the
site's terms of service actually say.

Everything runs on your machine, in your browser. The model runs on your GPU via
[WebLLM](https://github.com/mlc-ai/web-llm) — no desktop app, no server, no API
key.

## Why

Primarily a research project: how do you build a local, tool-using agent for a
system with several moving parts (browser, deterministic scanners, an in-browser
LLM), and keep it safe when the input it reads is controlled by the site being
audited?

The secondary question, forced by running small local models: **which models are
actually good enough** for schema-constrained extraction on real documents? That
comparison is the main measured output (`evals/results/`).

## What it does

- **Security findings**: missing or weak security headers, insecure cookies,
  mixed content, forms posting over HTTP, known trackers, vulnerable JS
  library versions, weak CSP.
- **Terms of service interpretation**: finds the site's policies, extracts
  clauses into a fixed schema (data sharing, arbitration, licence grants,
  auto-renewal, retention, etc.), and ranks what matters.
- **Explanations**: findings are explained in plain language by the model, with
  evidence linked back to the page.

## Architecture in one paragraph

One MV3 extension. The **content script** snapshots page state using a pure
builder from **core**. The **background worker** — the only privileged context —
adds cookie flags and refetches the page for response headers, and is the sole
network path. The **side panel** hosts the run: it assembles a `Capabilities`
object, hands it to **core**, and owns the WebLLM engine. Core runs deterministic
**analyzers** first, then an **agent loop** that calls tools (refetch headers,
fetch policy pages, run the ToS pipeline) through a **ModelProvider**
abstraction. Results go to IndexedDB and render in the side panel; history and
traces live in a full-page **workbench** tab.

`core` is pure TypeScript with no host APIs at all, so the same runtime works in
the extension and in a Node CLI used for fixtures, analyzer tests, and
replay-mode agent runs.

See `docs/01-architecture.md`.

## Documents

| File                               | Contents                                              |
| ---------------------------------- | ----------------------------------------------------- |
| `CLAUDE.md`                        | Rules and conventions for AI-assisted development     |
| `docs/01-architecture.md`          | Packages, `Capabilities`, data flow, key decisions    |
| `docs/02-page-snapshot.md`         | The `PageSnapshot` schema the content script produces |
| `docs/03-analyzers.md`             | Deterministic checks and the `Finding` type           |
| `docs/04-model-provider.md`        | `ModelProvider` interface; the WebLLM adapter         |
| `docs/05-tos-pipeline.md`          | Chunk → extract → merge pipeline for policies         |
| `docs/06-agent-loop.md`            | Orchestrator, tools, budgets, trace                   |
| `docs/07-extension-runtime.md`     | Extension contexts, ownership, and messaging          |
| `docs/08-extension.md`             | Extension design                                      |
| `docs/09-storage-and-workbench.md` | IndexedDB stores and the workbench tab                |
| `docs/10-dependencies.md`          | Third-party repositories and licensing notes          |
| `docs/11-roadmap.md`               | Milestones in build order, and spikes                 |
| `docs/12-threat-model.md`          | What we are defending against                         |

## Status

Milestones 0–2. `core` has the snapshot schema and builder, five deterministic
analyzers, and `audit()`. The CLI runs them over saved snapshots. The extension
captures a page, stores results in IndexedDB, and renders findings in the side
panel. No model yet — the WebLLM provider and explanations are M4, the ToS
pipeline M5, and the agent loop M6.

Milestones are in `docs/11-roadmap.md`; work is tracked in
[beads](https://github.com/gastownhall/beads) — `bd ready`.

```
pnpm install
pnpm -r build && pnpm -r test

# Audit a saved snapshot from the terminal
pnpm scan fixtures/snapshots/http-only_synthetic.json --no-agent

# Or load the extension: build, then load packages/extension/.output/chrome-mv3
# as an unpacked extension in a Chromium browser.
pnpm --filter extension build
pnpm serve-fixture   # a deliberately misconfigured page at localhost:8787
```

## Requirements

A Chromium browser with WebGPU. Firefox support is an open question
(`docs/11` M8). First use of a model downloads several gigabytes of weights from
the HuggingFace CDN — this is the only substantial network egress in the system,
and it is verified with SRI hashes (`docs/12` T7).

## Licence

Code: MIT (proposed), with one exception:
`packages/core/src/analyzers/headers/vendor/` is MPL-2.0, copied from
[mdn-http-observatory](https://github.com/mdn/mdn-http-observatory) and kept in
its own directory (MPL is file-level copyleft).

Some data sets we consume have non-commercial licences — DuckDuckGo Tracker
Radar is CC BY-NC-SA 4.0 and is downloaded at build time rather than vendored.
See `docs/10-dependencies.md`.
