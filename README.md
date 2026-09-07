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
| `docs/13-packaging.md`             | Building the extension and loading it from source     |
| `docs/research-notes.md`           | What worked, what the numbers said, what was wrong    |

## Status

Milestones 0–4, pending a browser check. `core` has the snapshot schema and
builder, nine deterministic analyzers, `audit()`, and record/replay for model
calls. The CLI runs analyzers over saved snapshots and replays recorded model
sessions. The extension captures a page, refetches its headers through the
background worker, runs the model on WebGPU through WebLLM, and renders findings
with plain-language explanations in the side panel.

The ToS pipeline reads a site's policies: it discovers them, extracts readable
markdown, chunks on headings, extracts clauses into a fixed schema, and
**verifies every quote against the source, dropping any it cannot find** — which
is what catches both a hallucinated clause and one a page tried to inject.

The agent loop ties it together: a hand-written think → act → observe
orchestrator that fetches the headers, re-runs the analyzers now they are
possible, reads the policies, and explains what matters — inside a budget, with
every decision recorded in a replayable trace.

A site being audited cannot steer the audit of itself. Policy text is read
inside a tool and comes back as counts and schema-validated clauses, so injected
instructions never reach the orchestrator's context at all. Four injection
fixtures assert exactly that, and the test was verified to fail when the
mechanism was deliberately broken.

A full-page workbench reads the same store: dashboard, history, and a trace view
that shows what the agent decided, what it was shown, what each step cost, and
where the time went.

**The model comparison is committed** (`evals/results/`). The first run says
something worth knowing: both Qwen2.5-0.5B and 1.5B hold the output schema
perfectly, and the 0.5B model paraphrases or invents 62% of its quotes. Quote
verification caught all of them. The failure mode of a small model here is not
malformed output a parser rejects — it is well-formed output that is not true.

`docs/research-notes.md` is the retrospective: what held up, what the
measurements said, and the five things the design docs got wrong before any code
was written.

Still to come: moving the runtime to an offscreen document so audits survive the
panel closing, and auto-audit on navigation. Both wait on spike S3, which needs
a browser — the workbench has a one-click probe for it.

Milestones are in `docs/11-roadmap.md`; work is tracked in
[beads](https://github.com/gastownhall/beads) — `bd ready`.

```
pnpm install
pnpm -r build && pnpm -r test

# Audit a saved snapshot from the terminal
pnpm scan fixtures/snapshots/http-only_synthetic.json --no-agent

# Optional analyzer data (gitignored; analyzers say so when absent)
pnpm build-tracker-db      # CC BY-NC-SA 4.0 — non-commercial
pnpm build-library-db
pnpm build-hsts-preload

# Or load the extension: build, then load packages/extension/.output/chrome-mv3
# as an unpacked extension in a Chromium browser.
pnpm --filter extension build
pnpm serve-fixture   # a deliberately misconfigured page at localhost:8787
```

## Requirements

A Chromium browser with WebGPU. Firefox support is an open question
(`docs/11` M8). First use of a model downloads several gigabytes: the weights
from HuggingFace and the compiled model library from `raw.githubusercontent.com`.
That is the only substantial network egress in the system.

The config, tokenizer, and model-library WASM are verified against SRI hashes we
compute and commit ourselves (`pnpm build-model-integrity`), because none of
WebLLM's 163 prebuilt models ship any. **The weight shards are not verified** —
WebLLM has no mechanism for it, and the gigabytes are exactly the part that goes
unchecked. `docs/12` T7 says what that does and does not buy.

## Licence

Code: MIT (proposed), with one exception:
`packages/core/src/analyzers/headers/vendor/` is MPL-2.0, copied from
[mdn-http-observatory](https://github.com/mdn/mdn-http-observatory) and kept in
its own directory (MPL is file-level copyleft).

Some data sets we consume have non-commercial licences. **DuckDuckGo Tracker
Radar is CC BY-NC-SA 4.0 — non-commercial.** It is downloaded at build time by
`pnpm build-tracker-db` and never vendored into this repository, so nothing in
the tree carries that restriction. The tracker analyzer is skipped, with an
explicit finding, when the database is absent.

The other build-time downloads are permissive: the Chromium HSTS preload list
(`pnpm build-hsts-preload`, BSD-3-Clause) and the retire.js advisory data
(`pnpm build-library-db`, Apache-2.0). All three land in `data/`, which is
gitignored. See `docs/10-dependencies.md`.
