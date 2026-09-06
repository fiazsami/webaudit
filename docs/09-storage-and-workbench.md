# 09 — Storage and the workbench

Replaces the Electron desktop app. Storage moves from SQLite to IndexedDB; the
dashboard, history, and trace view move to a full-page extension tab.

## Storage (IndexedDB)

One database, `webaudit`, shared by every extension context. Accessed through
`idb`. The three logical tables from the old SQLite schema survive unchanged in
shape — two of them were always pure key-value.

```ts
// db.audits — keyPath "id"
{
  id: string,
  url: string,
  host: string,                    // index: [host, startedAt] for history
  startedAt: string,
  finishedAt?: string,
  status: "queued" | "running" | "done" | "error" | "cancelled",
  modelId?: string,
  snapshot: PageSnapshot,
  result?: AuditResult,            // minus trace
  trace?: AuditTrace,
  error?: string,
}

// db.policyCache — keyPath "url"
{ url: string, contentHash: string, markdown: string, fetchedAt: string }

// db.tosReports — keyPath ["contentHash", "modelId"]
{ contentHash: string, modelId: string, report: TosReport, createdAt: string }
```

Indexes: `audits.by-host` on `[host, startedAt]`, `audits.by-started` on
`startedAt`.

Policy analysis is cached by content hash + model, so revisiting a site with an
unchanged policy is free. Under WebLLM this is **load-bearing, not an
optimisation** — re-running the ToS pipeline on a small local model costs
minutes, not cents. See docs/05.

`AuditStore` in `core` is the interface over this. The CLI implements the same
interface against the filesystem.

### Eviction

IndexedDB has no size guarantee. Request persistence with
`navigator.storage.persist()` on first run, and cap history at a configurable
number of audits (default 200), evicting oldest-first. Model weights live in
WebLLM's own cache (Cache API by default, OPFS configurable) and are managed
separately by the model manager, not by this store.

## Settings

`chrome.storage.local`, plain JSON:

- model: `{ modelId }` — the selected WebLLM model
- budgets (docs/06 defaults, user-adjustable)
- auto-audit on navigation (off by default, docs/11 M8)
- allowed extra domains for policy fetching
- history cap

There are no secrets. With hosted providers cut there is no API key, which
removes the whole `safeStorage` problem the desktop app existed partly to solve.
See docs/12 T5.

## The workbench tab

A full extension page at `chrome-extension://<id>/workbench.html`, opened from
the side panel or the extension action. It is a normal document in a normal tab:
full width, full height, same IndexedDB origin as everything else.

Views:

1. **Dashboard** — recent audits by site, severity counts.
2. **History** — all audits for a host, with diffing between two runs of the
   same site.
3. **Trace** — step-by-step view of model calls and tool calls with token usage
   and timings. *This is the main research payoff — make it good.* It gets a
   full tab precisely because a side panel could not do it justice.
4. **Models** — list available WebLLM models with size and context window,
   download with progress, show what is cached, evict.
5. **Settings** — budgets, allowed domains, history cap.

The workbench does not run audits and does not load an inference engine. It
reads the store. The one exception is the evals runner (docs/11 M7), which is a
separate page that creates its own engine.

## Packaging

WXT produces the Chrome build. Unsigned/unpacked is fine for the research phase;
document how to load unpacked from source. Firefox is an open question — WebGPU
support differs and may rule it out (docs/11 M8).
