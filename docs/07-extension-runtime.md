# 07 — Extension runtime and messaging

Replaces the old localhost WebSocket bridge. With no desktop app there is no
cross-process channel to secure: everything is one extension, and the only
question is which context owns what.

The bridge is gone entirely — with it the pairing token, the `Origin` check, the
close-code table, the exponential-backoff reconnect, and the MV3 wake-on-demand
dance. That was ~85 lines of protocol serving a process that no longer exists.

## Contexts and ownership

| Context                   | Owns                                                                                                              | Does not have                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| content script            | DOM reading; builds `PageSnapshot` via core's pure builder                                                        | any `chrome.*` beyond `runtime.sendMessage`; no network |
| background service worker | `chrome.cookies`, cross-origin `fetch` with host permissions, `webRequest` (optional), allowed-domain enforcement | any analysis logic; any long-running work               |
| side panel                | the audit run: `core.audit()`, the WebLLM engine, `Capabilities` assembly, per-page findings UI                   | host permissions of its own                             |
| workbench tab             | dashboard, history, trace view, model manager                                                                     | anything the side panel needs to run an audit           |
| IndexedDB                 | audits, policy cache, ToS reports — shared across all extension contexts                                          | —                                                       |

Two rules follow, and they are the whole design:

1. **Privilege stays in the background worker and nowhere else.** It is the only
   context with host permissions and cookie access. It performs no analysis, so
   there is nothing in it for untrusted content to steer.
2. **The background worker stays short-lived.** It wakes, does one privileged
   thing, replies, and is allowed to die. Nothing that takes minutes runs there.
   This is what MV3 service workers are actually good at.

## Messages

All messages are JSON, validated with zod at both ends — the same discipline the
bridge had, minus the transport. Envelope:

```ts
{ id: string, type: string, payload: unknown }
```

`id` is a UUID chosen by the sender; replies echo it in `replyTo`. Transport is
`chrome.runtime.sendMessage` for request/reply and `chrome.runtime.connect` for
streams (progress, model download).

### Side panel → background

| type               | payload                    | reply                                          |
| ------------------ | -------------------------- | ---------------------------------------------- |
| `snapshot.capture` | `{ tabId, auditId }`       | `snapshot.ready { PageSnapshot }`              |
| `http.fetch`       | `{ url, method, auditId }` | `http.response { url, status, headers, body }` |
| `cookies.get`      | `{ url }`                  | `cookies.list { CookieRef[] }`                 |

`http.fetch` is the only network path in the system, and its payload has no
`allowedDomains` field. That absence is the design.

The worker reads the tab URL itself during `snapshot.capture`, derives the
audit's allowlist from it, and stores it under `auditId` (`lib/audit-registry.ts`).
A later `http.fetch` names its audit but does not describe its permissions — the
worker looks up the allowlist it recorded. A caller able to state its own
allowlist would be authorising itself, which is the exact failure docs/12 T2 is
about. Enforcement lives with the capability, not with the requester.

Three consequences worth stating:

- **No grant, no fetch.** An audit the worker has no record of authorising is
  refused with `domain-not-allowed`. The grant lives in `chrome.storage.session`,
  so it survives the worker being evicted mid-audit — but if it is ever gone, the
  answer is no and the side panel must re-capture. Failing closed is the only
  safe direction.
- **Redirects are re-checked.** The allowlist is applied to the URL the response
  actually came from, not only the one requested, so a redirect cannot walk off
  the list.
- **Only extension pages may ask.** The worker ignores messages carrying a
  `sender.tab`, so a content script — which runs inside a page the audited site
  controls — cannot drive the privileged fetch.

### Background → content script

| type             | payload   | reply                                          |
| ---------------- | --------- | ---------------------------------------------- |
| `snapshot.build` | `{ url }` | `snapshot.ready { PageSnapshot }` (pre-cookie) |

The content script is **not** in the manifest. The worker injects it with
`scripting.executeScript` when an audit of that tab begins, so nothing of ours
runs in a page until the user asks for an audit of it. Holding `<all_urls>` and
exercising it on every page load are different things (docs/08).

The snapshot that comes back carries the `no-cookie-flags` limitation, because a
content script cannot see cookie attributes. The worker clears it when it adds
the flags — the one place in the system allowed to.

### Side panel → workbench (via storage)

None. The workbench reads IndexedDB directly; there is no message path between
UI contexts. Fewer channels, fewer schemas, less to get wrong.

### Streams (via `chrome.runtime.connect`)

| channel          | events                                                             |
| ---------------- | ------------------------------------------------------------------ |
| `audit.progress` | `{ auditId, stage, message, step?, maxSteps? }`                    |
| `model.progress` | `{ modelId, loaded, total, text }` — WebLLM `initProgressCallback` |

`model.progress` is new and has no analogue in the old design: a first run
downloads multiple gigabytes of weights, and that has to be visible.

## Errors

There is no close-code table because there is no connection to close. A failed
request replies with `{ type: "error", replyTo, payload: { code, message } }`
where `code` is one of `invalid-message`, `domain-not-allowed`,
`fetch-failed`, `no-active-tab`, `capture-failed`.

## What this design gives up

The old bridge was a genuine privilege boundary: a compromised extension could
only submit snapshots and read results, because tool execution lived in another
process (old docs/12 T3). That boundary is gone — the analyzers and the agent
loop now run inside the extension.

This is a smaller loss than it looks. The extension already held `<all_urls>`
and `cookies`; it was always the most privileged component. What changed is that
domain enforcement now sits in the same context as the fetch it guards, which is
where it belongs. The revised T3 in docs/12 states the residual risk honestly.
