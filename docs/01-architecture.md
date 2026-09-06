# 01 — Architecture

Everything runs inside one MV3 browser extension. There is no desktop app, no
server, and no localhost bridge. The model runs in the browser over WebGPU.

## Components

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser extension (WXT, MV3) — the whole product                 │
│                                                                  │
│  content script                                                  │
│    builds PageSnapshot from the DOM (core's pure builder)        │
│                          │                                       │
│                          ▼                                       │
│  background service worker          ── the only privileged part  │
│    chrome.cookies (flags)              short-lived, wake-on-demand│
│    fetch with host permissions         no analysis logic         │
│    (response headers, policy pages)                              │
│                          │                                       │
│                          ▼                                       │
│  side panel  ── HOST: owns the audit run                         │
│    supplies Capabilities to core                                 │
│    WebLLM engine (WebGPU) in a worker                            │
│    renders findings for the current tab                          │
│                          │                                       │
│  workbench tab (chrome-extension://<id>/workbench.html)          │
│    dashboard · history · trace view · model manager              │
│                          │                                       │
│  IndexedDB  audits · policy cache · tos reports                  │
└──────────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────▼───────────────────┐
        │ packages/core — pure TypeScript      │
        │  no Node built-ins, no DOM, no chrome│
        │  snapshot/   schemas + builder       │
        │  analyzers/  deterministic checks    │
        │  providers/  ModelProvider impls     │
        │  tools/      agent tools             │
        │  agent/      orchestrator + trace    │
        │  tos/        policy pipeline         │
        └──────────────────────────────────────┘
                           ▲
        ┌──────────────────┴───────────────────┐
        │ packages/cli — Node host             │
        │  analyzers, non-model ToS stages,    │
        │  replay-mode agent runs, fixtures    │
        │  (no live inference: Node has no     │
        │   WebGPU)                            │
        └──────────────────────────────────────┘
```

## Capabilities — the load-bearing seam

`core` never reaches for the world. The world is handed to it. This is what
lets identical code run in the extension and in Node.

```ts
export interface Capabilities {
  http: Http; // the only way out to the network
  store: AuditStore; // audit history; policy cache joins it in M5
  provider: ModelProvider; // docs/04
  dom: DomParser; // parse(html, url) -> DomDocumentLike
  progress: ProgressSink; // stage/step events for the UI
  clock: Clock; // now() — traces and deterministic tests
  logger: Logger;
}

core.audit(snapshot, { capabilities, budget });
```

The members, in `packages/core/src/capabilities.ts`:

```ts
export interface Http {
  fetch(url: string, init?: HttpRequestInit): Promise<HttpResponse>;
}

export interface HttpResponse {
  url: string; // final URL, after any redirects the host followed
  status: number;
  headers: Record<string, string>; // names lowercased
  body: string;
}

export interface DomParser {
  parse(html: string, url: string): DomDocumentLike; // the port from docs/02
}

export interface AuditStore {
  putAudit(result: AuditResult): Promise<void>;
  getAudit(auditId: string): Promise<AuditResult | undefined>;
  listAudits(): Promise<AuditSummary[]>; // most recent first
}

export interface ProgressSink {
  emit(event: {
    stage: string; // "analyzers", "tos", "agent"
    step?: string; // finer step, e.g. an analyzer id
    current?: number;
    total?: number;
    message?: string;
  }): void;
}

export interface Clock {
  now(): number; // milliseconds since the epoch
}

export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}
```

`DomParser` returns core's structural DOM port rather than a `Document`, because
core has no DOM types to name one with (docs/02).

`AuditStore` covers audit history only. The policy cache and ToS report stores
in docs/09 join it in M5, when there is something to put in them.

`Http` returns a plain object rather than a `Response`: core would have to await
the body anyway, the header map is easier to read than `Headers`, and a snapshot
of a response serialises into a trace where a live stream does not. Note that
the allowed-domain check lives behind this interface, in the host — a tool that
checks the budget before calling is doing so as well, not instead (docs/12 T2).

| Capability | Extension host                                              | CLI host                                |
| ---------- | ----------------------------------------------------------- | --------------------------------------- |
| `http`     | background worker (host permissions: no CORS, full headers) | `fetch`                                 |
| `store`    | IndexedDB                                                   | filesystem under `./out/`               |
| `provider` | WebLLM over WebGPU                                          | `RecordingProvider` in replay mode only |
| `dom`      | native `DOMParser`                                          | `linkedom`                              |
| `clock`    | `Date.now`                                                  | injectable fake in tests                |

The CLI cannot run a live model. That is a real limitation, accepted
deliberately: it keeps `core` honest about its dependencies, and replay mode
covers the agent loop in CI on machines with no GPU.

## Data flow for one audit

1. User opens the side panel on a page and clicks audit.
2. Side panel asks the background worker for a snapshot; the worker injects /
   messages the content script, which builds a `PageSnapshot` (docs/02).
3. Worker enriches it with cookie flags (`chrome.cookies`) and, if permitted,
   recent `webRequest` entries, then returns it.
4. Side panel validates the snapshot and calls `core.audit(snapshot, ...)`,
   supplying `Capabilities`.
5. Core runs all deterministic analyzers → initial `Finding[]`.
6. Core runs the agent loop (docs/06). Tools may refetch the URL for headers,
   fetch policy pages, run the ToS pipeline, or request explanations. Every
   network call goes back out through `capabilities.http` — i.e. through the
   background worker, which enforces the allowed-domain list.
7. Core returns `AuditResult { findings, tosReport, trace }`.
8. Side panel writes it to IndexedDB and renders it. The workbench tab reads the
   same store.

## Where the runtime lives

The side panel document hosts `core.audit()` and the WebLLM engine. It is a
normal document, so WebGPU is available, and it persists while open. Audits are
user-initiated from that panel, so the loop runs exactly while the user is
watching it.

This is a deliberate inversion of the older design, in which the panel was a
dumb view: the compute host should be the context whose lifetime the user
controls. Once auto-audit-on-navigation needs runs with no panel open, the
runtime moves to an offscreen document (docs/11 M8). The `Capabilities` seam
makes that a change of host, not a change of code.

## Key decisions

| Decision             | Choice                              | Why                                                                                                                            |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Shell                | Browser extension only              | The extension is the only component that _must_ exist — it alone sees response headers, cookie flags, and third-party requests |
| Model runtime        | WebLLM (WebGPU, in-browser)         | Removes the native process that was the sole reason for a desktop app                                                          |
| Host abstraction     | `Capabilities` injected into `core` | One runtime, two hosts; makes replay-mode CI possible                                                                          |
| Header collection    | Background worker refetches the URL | Host permissions bypass CORS and expose full response headers                                                                  |
| Deterministic vs LLM | Rules first, model second           | Testable, fast, free; model adds judgment not detection                                                                        |
| Agent framework      | Hand-written loop                   | Learning goal; the loop is the research artifact                                                                               |
| Tool calling         | JSON action protocol                | WebLLM's `tools`/`tool_choice` are upstream WIP — this is the only path, not a fallback                                        |
| Storage              | IndexedDB                           | Available in every extension context, no native dependency                                                                     |
| Trace view           | Full-page workbench tab             | It is the main research payoff and deserves more than a side panel                                                             |
| Schemas              | zod everywhere                      | Validation at every boundary                                                                                                   |

## Package boundaries

- `core` exports `audit()`, `runAnalyzers()`, `runTosPipeline()`, the snapshot
  builder, schemas, the `ModelProvider` and `Capabilities` interfaces, and
  adapters. It imports nothing from `extension` or `cli`.
- `core/snapshot` is a second entry point carrying the builder and its schemas
  alone. It exists for a bundling reason worth recording: `csp_evaluator` is
  CommonJS, so a bundler cannot tree-shake it out of the package root, and a
  content script importing `core` for the builder ended up shipping the entire
  analyzer suite — 300 KB injected into every audited page instead of 96 KB.
  The content script and the background worker import from here.
- `extension` depends on `core` and implements `Capabilities` against browser
  and `chrome.*` APIs.
- `cli` depends on `core` and implements `Capabilities` against Node.

If `core` ever needs something it cannot get, the answer is a new capability on
the interface — never a direct import.

## Non-goals (for now)

- Active scanning (sending payloads to the site). Passive observation only.
- Hosted providers. Nothing leaves the machine but weight downloads and
  permitted policy fetches.
- Multi-user or cloud sync.
- Blocking or modifying page requests. We observe and report.
