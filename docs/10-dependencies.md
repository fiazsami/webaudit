# 10 — Third-party repositories and dependencies

Verify current versions before pinning. Prefer fewer dependencies in `core`, and
remember hard rule 1: anything `core` imports must work in both Node and a
browser.

## Model runtime

| Package / repo                       | Use                                             | Notes                                                                                                                             |
| ------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `@mlc-ai/web-llm` (`mlc-ai/web-llm`) | The model. WebGPU inference in the browser      | Apache-2.0. Grammar-constrained JSON in the WASM runtime. `tools`/`tool_choice` are WIP — we use the JSON action protocol instead |
| `zod`                                | All schemas; JSON Schema for constrained output | **`zod-to-json-schema` is not needed** — zod 4 emits it directly with `z.toJSONSchema()`, verified against WebLLM in spike S2     |
| `gpt-tokenizer`                      | Token estimates for chunking and budgets        | Browser-safe. Reconcile against WebLLM's returned `usage`                                                                         |

A model load fetches from **two** origins, not one — spike S2 corrected this.
The weights come from HuggingFace, now served through its Xet backend on
regional hosts such as `us.aws.cdn.hf.co`, and the compiled model library is a
`.wasm` from `raw.githubusercontent.com`. Both are cached by WebLLM (Cache API
by default; IndexedDB and OPFS are configurable). The extension's `connect-src`
has to cover both, and no enumeration of `cdn-lfs` hostnames covers the first
(docs/08).

`ModelIntegrity` with `onFailure: "error"` exists, but **none of the 163
prebuilt models carry integrity hashes**, so nothing is verified by default. See
docs/12 T7.

### Removed

`ollama`, `@anthropic-ai/sdk`, and `node-llama-cpp` are gone with hosted and
native-process providers. `ai` (Vercel), `mastra`, and `langgraphjs` remain
unadopted — the hand-written loop is the point (docs/06).

## Deterministic analyzers

| Package / repo                           | Use                                         | Licence note                                                                                               |
| ---------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `csp_evaluator` (`google/csp-evaluator`) | CSP strength scoring                        | Apache-2.0, v1.1.8, **zero runtime deps**, pure TS. Note the npm name uses an underscore                   |
| `retire.js` (`RetireJS/retire.js`)       | Vulnerable JS library fingerprints          | Apache-2.0; use its data files, not the scanner                                                            |
| `duckduckgo/tracker-radar`               | Third-party domain classification           | **CC BY-NC-SA 4.0** — non-commercial. Fine for research; flag in README. Build a JSON subset at build time |
| `easylist/easylist` (EasyPrivacy)        | Alternative tracker source                  | GPL-3 / CC BY-SA; via `@ghostery/adblocker` parser                                                         |
| `tldts`                                  | eTLD+1 and first/third-party classification | MIT, browser-safe                                                                                          |

Ship a build script that can generate the tracker DB from either source; default
to Tracker Radar for richer metadata, document the licence.

### Optional build-time data

Both of these are downloaded by a script into `data/`, which is gitignored.
Neither is required: an analyzer without its data says so rather than reporting
a clean result.

| Script                    | Source                                           | Size                                       | Licence             |
| ------------------------- | ------------------------------------------------ | ------------------------------------------ | ------------------- |
| `pnpm build-hsts-preload` | Chromium `transport_security_state_static.json`  | 94,644 entries; 6.2 MB raw, 740 KB gzipped | BSD-3-Clause        |
| `pnpm build-library-db`   | `RetireJS/retire.js` `jsrepository-v4.json`      | 60 libraries; 166 KB raw, 30 KB gzipped    | Apache-2.0          |
| `pnpm build-tracker-db`   | DuckDuckGo Tracker Data Set (from tracker-radar) | 1,028 trackers; 116 KB raw, 18 KB gzipped  | **CC BY-NC-SA 4.0** |

The tracker database is the one with a licence constraint. CC BY-NC-SA 4.0 is
non-commercial, which is fine for research and is exactly why it is downloaded
rather than vendored — nothing in this tree carries the restriction. The
`licence` field is written into the built file so the constraint travels with
the data rather than living only here.

We take DuckDuckGo's compiled Tracker Data Set rather than the tracker-radar
repository directly: the repo's aggregate `domain_map.json` has owners but no
categories, and the per-domain files that do carry them number in the thousands.
The TDS has owner, categories, prevalence, and fingerprinting in one file.

The library database is downloaded rather than committed for a different
reason: retire.js publishes advisories continuously, and a checked-in copy would
go stale while still looking authoritative. Only the `uri` and `filename`
extractors are kept — a snapshot records where scripts came from, not what is in
them, so the `func` and `filecontent` extractors have nothing to match against.
That limitation is reported in every run as an `info` finding, because a clean
result means "no vulnerable version was named in a script URL", which is much
weaker than "no vulnerable library is loaded".

The HSTS list is not bundled by default, and the reason is worth recording. It
changes the outcome in exactly one case: a site on the browser preload list that
sends a short, malformed, or missing HSTS header is protected regardless, and
would otherwise be reported as a problem. Without the list those findings carry a
caveat and medium confidence; with it they are stated plainly. Trading 740 KB for
one sentence is a judgement, so it is opt-in — the CLI picks it up from
`data/hsts-preload.json` automatically, and the extension does not bundle it.

### Header analysis — vendored, not depended on

`@mdn/mdn-http-observatory` **is not a library**. It is a server application:
Fastify, PostgreSQL, `postgrator` migrations, `@sentry/node`, `axios`, and
`engines.node >= 24`. It cannot run in a browser and has no business in `core`
in any host.

Instead we vendor its scoring sources:

```
packages/core/src/analyzers/headers/
  vendor/              # MPL-2.0 — copied from mdn-http-observatory src/analyzer
    LICENSE.MPL-2.0
    hsts.js, cspParser.js, utils.js, tests/
  mapping.ts           # MIT — adapts vendor output to Finding
```

MPL-2.0 is **file-level** copyleft: those files stay MPL with their headers
intact, and the rest of the repository stays MIT. Keep them in their own
directory, unmodified where possible, so upstream fixes can be merged.

Their transitive needs — `structured-headers`, `tldts`, `dayjs`, `change-case` —
are all browser-safe. Confirming the prune is spike S1 (docs/11). If the sources
turn out to drag in the server stack, the fallback is ~10 header rules written
from Observatory's published scoring table, fully MIT.

## Content extraction (ToS pipeline)

| Package / repo         | Use                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `@mozilla/readability` | Main-content extraction from policy pages                                            |
| `turndown`             | HTML → markdown                                                                      |
| `linkedom`             | DOM for Readability **in the CLI host only** — the extension uses native `DOMParser` |

`linkedom` is injected via `Capabilities.dom`, so it never enters the extension
bundle.

## Extension

| Package               | Use                                         |
| --------------------- | ------------------------------------------- |
| `wxt` (`wxt-dev/wxt`) | MV3 framework, HMR, cross-browser builds    |
| `idb`                 | Thin typed wrapper over IndexedDB (docs/09) |
| React                 | Side panel, workbench, evals UI             |

### Removed

`electron`, `electron-vite`, `electron-builder`, `electron-store`, `ws`, and
`better-sqlite3` are all gone with the desktop app.

## Testing and evals

| Package          | Use                                      |
| ---------------- | ---------------------------------------- |
| `vitest`         | Unit tests across packages               |
| `linkedom`       | HTML fixtures for snapshot builder tests |
| `fake-indexeddb` | Store tests without a browser            |

`promptfoo` is removed: it is a Node harness and cannot drive WebGPU. Model
comparison runs in the browser (docs/04, docs/11 M7).

## Optional, later

| Package                     | Use                                            |
| --------------------------- | ---------------------------------------------- |
| `@modelcontextprotocol/sdk` | Expose analyzers as MCP tools for other agents |

## Licensing summary for the README

Code is MIT, with one exception: `packages/core/src/analyzers/headers/vendor/`
is MPL-2.0, copied from mdn-http-observatory and kept in its own directory.
WebLLM is Apache-2.0, as is csp_evaluator and Retire.js data. Tracker Radar data
is CC BY-NC-SA and must not be redistributed for commercial use; the build
script downloads it rather than vendoring it.
