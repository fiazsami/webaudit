# Vendored: mdn-http-observatory analyzer

Copied from [`@mdn/mdn-http-observatory`](https://github.com/mdn/mdn-http-observatory)
v1.7.1, `src/analyzer/` plus the two files it reaches up for (`src/headers.js`,
`src/types.js`).

**These files are MPL-2.0, not MIT.** MPL is file-level copyleft: they keep
their licence and stay in this directory, and the rest of the repository stays
MIT. `../mapping.ts` and `../index.ts` next door are ours.

Keep them as close to upstream as possible so fixes can be merged. Everything
that was changed is listed below.

## Why vendored rather than depended on

`@mdn/mdn-http-observatory` is a server application, not a library: Fastify,
PostgreSQL, `postgrator`, `@sentry/node`, axios, `engines.node >= 24`. It cannot
run in a browser and violates hard rule 1 in any host. Only its scoring logic is
wanted, and that part turns out to be dependency-light. See docs/03 and the S1
spike result.

## Changes from upstream

1. **`hsts.js`** — the only edit to upstream logic. It read
   `conf/hsts-preload.json` through `node:fs`; the host now injects the map via
   `setHstsPreloadList()`. This was forced regardless: that file is not shipped
   in the npm tarball, being generated at build time.
2. **Import paths** — `../../headers.js` and `../../types.js` became
   `../headers.js` and `../types.js`, since those two files now sit here rather
   than a level up. No logic touched.
3. **`tests/subresource-integrity.js`** — removed. The only file needing
   `htmlparser2`, and the `scripts` analyzer already reports SRI from the
   snapshot.
4. **`tests/redirection.js`** — removed. The only file needing `site.js`, which
   pulls in `node:url` and `tldts`, and it needs a full redirect chain that a
   single fetch does not produce.
5. **`tests/cookies.js`** — kept, but not wired into the analyzer. It reads a
   `tough-cookie` jar off the session rather than `Set-Cookie` headers, and
   returns `cookies-not-found` even when the header is present. Cookie
   attributes come from `chrome.cookies` and the `cookies` analyzer instead.

6. **MPL Exhibit A notice** — added to the top of each file. Upstream ships
   none, and MPL-2.0 requires a redistributor to inform recipients of the
   licence. Notice only; no logic touched.

7. **`tests/cors.js`** — kept, but not wired. Its only interesting verdict,
   `...-universal-access`, requires a probe response whose *request* carried an
   `Origin` header, so the server's reflection of it can be observed. The
   background worker sends a plain fetch. Wired as-is it could only ever return
   verdicts we treat as fine, which would look like a passing check rather than
   an absent one.

## Do not typecheck this directory

`types.js` carries JSDoc references to `import("axios").AxiosResponse` and
`import("tough-cookie").SerializedCookie`. They have no runtime effect, but
typechecking them would drag two type-only dependencies into the build. The
directory is excluded in `packages/core/tsconfig.json`; the types live on
`../mapping.ts`, which is ours to declare.
