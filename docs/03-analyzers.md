# 03 — Deterministic analyzers and the Finding type

Analyzers are pure functions from a snapshot (plus optional fetched context) to
findings. They never call a model. They are the fast, testable half of the
system and should catch the majority of security issues on their own.

## Finding schema

```ts
export const Severity = z.enum(["info", "low", "medium", "high", "critical"]);

export const Finding = z.object({
  id: z.string(), // stable: `${analyzerId}:${ruleId}:${hash(evidence)}`
  analyzerId: z.string(),
  ruleId: z.string(), // e.g. "hsts-missing"
  severity: Severity,
  confidence: z.enum(["low", "medium", "high"]),
  title: z.string().max(120),
  summary: z.string().max(500), // deterministic, written by the analyzer
  evidence: z.array(
    z.object({
      // what we actually saw
      kind: z.enum([
        "header",
        "cookie",
        "script",
        "form",
        "request",
        "policy-text",
        "other",
      ]),
      value: z.string().max(1000),
      location: z.string().optional(), // URL, selector, line ref
    }),
  ),
  references: z.array(z.string().url()).default([]),
  // Filled later by the model, never by the analyzer:
  explanation: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
```

`explanation` is the only field a model writes. Everything else is
deterministic so tests can assert exact output.

## Analyzer interface

```ts
export interface AnalyzerContext {
  headers?: Record<string, string>; // from fetchHeaders tool, if run
  trackerDb?: TrackerDatabase; // loaded once, injected
  logger: Logger;
}

export interface Analyzer {
  id: string;
  needs: Array<"headers" | "trackerDb">; // orchestrator ensures these exist
  run(snapshot: PageSnapshot, ctx: AnalyzerContext): Promise<Finding[]>;
}
```

`AnalyzerContext` is derived from `Capabilities` (docs/01) by the caller —
analyzers never see `http`, `store`, or the provider. `headers` is populated
by the `fetchHeaders` tool, which goes through `capabilities.http`.

`runAnalyzers(snapshot, ctx)` runs all registered analyzers in parallel, skips
any whose `needs` aren't satisfied (emitting an `info` finding that says so),
and returns a de-duplicated, severity-sorted list.

## Initial analyzer set

| id                | Source                                 | Rules                                                                                                            |
| ----------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `transport`       | snapshot                               | http protocol, mixed content                                                                                     |
| `headers`         | vendored Observatory sources (MPL-2.0) | HSTS, CSP presence, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, CORS, cookie flags from Set-Cookie |
| `csp`             | `csp_evaluator`                        | Directive-level structure: missing base-uri/object-src, wildcards, allowlist bypasses, nonce quality, syntax     |
| `cookies`         | snapshot cookies                       | Missing Secure/HttpOnly/SameSite, long-lived session cookies                                                     |
| `forms`           | snapshot forms                         | Insecure form actions, login forms on http, cross-origin form actions, autocomplete on password forms            |
| `scripts`         | snapshot scripts                       | Third-party scripts without SRI, excessive inline scripts                                                        |
| `trackers`        | tracker DB                             | Third-party domains classified by category (advertising, analytics, fingerprinting)                              |
| `libraries`       | retire.js data                         | Known-vulnerable JS library versions from script URLs                                                            |
| `policy-presence` | snapshot links                         | No detectable privacy policy or terms link                                                                       |

### Two corrections to the table above

**Form rules live in `forms`, not split with `transport`.** The first draft gave
"forms posting to http" to `transport` and "login forms on http" to `forms`,
which meant one insecure login form produced two findings saying nearly the same
thing. One rule, one owner: `transport` covers the page's own transport —
protocol and mixed content — and `forms` covers everything about where a form
sends what the user typed.

**CSP is analysed twice, on purpose, without saying anything twice.** The
vendored Observatory sources score a policy as a whole and report the headline
verdict — missing, report-only, unsafe-inline, unsafe-eval, insecure scheme.
`csp_evaluator` reports directive-level structure that a single verdict cannot
express: `object-src` and `base-uri` missing where they do not fall back,
wildcards, known allowlist bypasses, nonce quality, syntax errors. The `csp`
analyzer's mapping table deliberately omits every type the `headers` analyzer
already covers, so one problem never produces two findings.

`csp_evaluator` also distinguishes certainty, and we keep that distinction. It
reports `'self'` in `script-src` as a _possible_ allowlist bypass, since the
origin might host JSONP or user uploads — which it cannot know. Its `_MAYBE`
severities cost one severity step and drop confidence to medium. Reported at
face value, that one check alone would flag most of the web.

**"Scripts from unexpected TLDs" is not implemented.** To mean anything it needs
a reputation source, and a hand-written TLD blocklist would produce confident
false positives about ordinary sites — the opposite of what a deterministic
analyzer is for. Classifying third-party script origins is the `trackers`
analyzer's job in M3, which has actual data behind it.

## Header analysis: vendored, not depended on

`@mdn/mdn-http-observatory` is a server application, not a library — Fastify,
PostgreSQL, `postgrator`, `@sentry/node`, `axios`, `engines.node >= 24`. It
cannot run in a browser and violates hard rule 1 in any host.

We vendor its scoring sources instead:

```
analyzers/headers/
  vendor/            MPL-2.0, copied from mdn-http-observatory src/analyzer
    LICENSE.MPL-2.0
    hsts.js, cspParser.js, utils.js, tests/
  mapping.ts         MIT — adapts vendor output to Finding
  index.ts           MIT — the Analyzer
```

MPL-2.0 is file-level copyleft, so those files stay MPL with headers intact and
the rest of the repo stays MIT. Keep them unmodified where possible so upstream
fixes can be merged.

### S1 result: viable, with three prunes

Spike S1 (docs/11) ran the experiment against `@mdn/mdn-http-observatory@1.7.1`.
The vendored analyzer bundles for a browser in **24 modules, 60 kB (13 kB
gzipped), with one runtime dependency — `structured-headers`**. No Fastify, no
`pg`, no Sentry, no axios, no Node built-in is reachable. Nine tests run and
return correct Observatory verdicts from a fixed headers object; feeding them
deliberately bad headers changes every verdict, so they are evaluating rather
than defaulting.

Three files are dropped or edited, and only one is an edit to upstream logic:

1. **`hsts.js` — edited.** Upstream reads `conf/hsts-preload.json` through
   `node:fs`. The host injects the map instead (`setHstsPreloadList`). This is
   forced regardless of the browser question: that JSON is not in the npm
   tarball at all, being generated at build time by `retrieve-hsts.js`. So the
   HSTS preload list becomes a build-time download, like the tracker database
   (docs/10).
2. **`subresource-integrity.js` — dropped.** The only file needing
   `htmlparser2`, and our own `scripts` analyzer already reports SRI from the
   snapshot.
3. **`redirection.js` — dropped.** The only file needing `site.js`, which pulls
   in `node:url` and `tldts`. It also needs a full redirect chain, which a
   single worker fetch does not produce. Not in the rule list above either.

A fourth, `cookies.js`, is kept out of the wired set: it reads a `tough-cookie`
jar off the session rather than `Set-Cookie` headers, and returns
`cookies-not-found` even when the header is present. We get cookie attributes
from `chrome.cookies` and already have a `cookies` analyzer.

That leaves nine usable tests: HSTS, CSP, X-Content-Type-Options,
X-Frame-Options, Referrer-Policy, CORS, COEP, COOP, CORP.

**The adapter's job.** The tests read `requests.responses.auto` and
`.https`, `requests.session.url`, and `requests.site.hostname` — an axios-shaped
object our background worker does not produce. `mapping.ts` builds one from a
single fetch. One assumption in that mapping is worth stating: `verified: true`,
which HSTS requires, is set for any successful HTTPS fetch, on the grounds that
the browser would have refused a bad certificate chain before we saw a response.

**Do not typecheck the vendor directory.** `types.js` carries JSDoc references
to `import("axios").AxiosResponse` and `import("tough-cookie").SerializedCookie`.
They have no runtime effect, but they would drag two type-only dependencies into
the build. Keep the vendored JS out of `tsconfig` and put the types on
`mapping.ts`, which is ours.

The fallback — ~10 header rules written from Observatory's published scoring
table — is not needed.

## Wrapping third-party scanners

`csp_evaluator` (and the vendored Observatory sources) have their own output
shapes. Each wrapper:

1. Calls the library with already-fetched headers. Nothing here makes its own
   network request — the background worker did that.
2. Maps each of its tests to a `ruleId`, severity, and evidence.
3. Preserves the library's own reference links in `references`.
4. Never throws on a single failed test — returns what it got and logs.

Keep the mapping tables in `analyzers/<id>/mapping.ts` so they're easy to review
and update when the upstream library changes.

## Tracker database

Loaded once at app start from a bundled JSON built at build time from
Tracker Radar or EasyPrivacy (see docs/10 for licensing). Interface:

```ts
interface TrackerDatabase {
  lookup(
    hostname: string,
  ): { owner: string; categories: string[]; prevalence?: number } | null;
}
```

Use `tldts` to reduce hostnames to eTLD+1 before lookup, and to decide whether
a request is first- or third-party relative to the page URL.

## Tests

Split across two packages, because core cannot read a file.

`packages/core/src/analyzers/__tests__/` holds the unit tests. They build
snapshots from a factory that returns a clean page and override only the field
under test, so a failure points at the rule rather than at incidental fixture
noise. They assert on `ruleId` and `severity`, never on prose.

`packages/cli/src/__tests__/` holds the corpus tests, since the CLI is the host
with a filesystem. Those walk `fixtures/snapshots/`, validate every fixture
against `PageSnapshotSchema`, and run a full audit over each — including the
assertion that the well-configured baseline still produces zero findings. A
baseline that reports findings has stopped being one.
