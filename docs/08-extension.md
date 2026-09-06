# 08 — The extension

MV3, built with **WXT**. Chrome first. This is no longer a thin client — it is
the entire product, and it absorbs what the desktop app used to do.

## Entrypoints

```
packages/extension/
  entrypoints/
    content.ts          # builds PageSnapshot on request
    background.ts       # privileged only: cookies, fetch, routing
    sidepanel/          # HOST: core.audit() + WebLLM engine + findings UI
    workbench/          # full-page tab: dashboard, history, trace (docs/09)
    evals/              # in-browser model comparison runner (docs/11 M7)
  lib/
    capabilities.ts     # assembles the Capabilities object for core
    store-idb.ts        # AuditStore over IndexedDB
    engine.ts           # WebLLM engine lifecycle in a Web Worker
    messaging.ts        # zod-validated envelopes (docs/07)
```

## Permissions

Minimum viable: `activeTab`, `sidePanel`, `storage`, `cookies`, `scripting`.
Optional (request at runtime, explain why): `webRequest` for
`thirdPartyRequests`. Host permissions: `<all_urls>`, required for `cookies`,
on-demand injection, and the cross-origin fetches that give us response headers.
Document this clearly in the store listing.

### CSP

WebLLM's WASM runtime requires `wasm-unsafe-eval` in
`content_security_policy.extension_pages`, plus `connect-src` entries for the
weight CDN (`huggingface.co` and the hosts it redirects to). This is a real
loosening of the extension's CSP and is recorded as docs/12 T8.

## Content script

Runs only when asked (message from the background worker), not on every page
load, unless the user enables auto-audit.

Calls `core`'s pure snapshot builder — the same function the CLI's fixtures are
built with, so what ships and what is tested cannot drift.

- `scripts`: iterate `document.scripts`; hash inline contents with
  `crypto.subtle.digest("SHA-256")`; record attributes.
- `forms`: resolve `action` against `document.baseURI`; classify inputs.
- `links`: all anchors; assign `policyHint` via regex on href and text
  (`terms|tos|conditions`, `privacy`, `cookie`).
- `metaTags`: name/property → content.
- `hasMixedContent`: on https pages, any `http:` src/href on script, img,
  iframe, link[rel=stylesheet].
- `textExcerpt`: `document.body.innerText` trimmed to the budget; set the
  `text-truncated` limitation if cut.
- `iframes`: src and sandbox attribute.

If a strict CSP blocks something (rare for content scripts, but hashing very
large inline scripts can time out), record a limitation rather than failing.

## Background worker

Privileged, thin, and short-lived. It holds every capability the rest of the
extension is not allowed to have, and it does no analysis — there is nothing in
it for untrusted content to steer.

- `chrome.cookies.getAll({ url })` for Secure/HttpOnly/SameSite flags.
- Cross-origin `fetch` for response headers and policy pages. **Enforces the
  audit's allowed-domain list itself** rather than trusting the caller.
- `webRequest` entries per tab, if permitted.
- Routes `snapshot.build` to the content script.

It is allowed to be evicted between requests. Nothing long-running lives here.

## Side panel — the runtime host

This is the significant change from the old design, where the panel was a dumb
view and the agent ran in another process.

- Assembles `Capabilities` (docs/01) and calls `core.audit(snapshot, ...)`.
- Owns the WebLLM engine, constructed in a Web Worker so prefill does not block
  the UI.
- Writes results to IndexedDB; the workbench reads the same store.

Why here: it is a normal document, so WebGPU works and it persists while open;
and audits are user-initiated from this panel, so the run happens exactly while
the user is watching it. The compute host should be the context whose lifetime
the user controls.

The cost is honest: close the panel mid-audit and the run dies. Acceptable while
audits are user-initiated. Auto-audit-on-navigation needs an offscreen document,
which is docs/11 M8 and gated on spike S3.

### UI

- Header: site, active model, "re-audit", engine state (not loaded / downloading
  / ready).
- Findings grouped by severity; each expands to evidence and explanation.
- ToS section: top concerns, then by category.
- Progress while the agent runs (stage + step counter), and separately model
  download progress on first use.
- Link to the workbench tab for history and traces.
- A "raw snapshot" toggle for development.

## Testing

- `core`'s snapshot builder is unit-tested against saved HTML fixtures via
  `linkedom` in Node — no browser needed.
- `lib/store-idb.ts` against `fake-indexeddb` in vitest.
- A tiny local test site (`fixtures/site/`) with known issues, served by
  `pnpm --filter extension serve-fixture`, for manual end-to-end checks.
- Live-model behaviour is exercised by the evals page, not by CI.
