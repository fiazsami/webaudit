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
| `transport`       | snapshot                               | http protocol, mixed content, forms posting to http                                                              |
| `headers`         | vendored Observatory sources (MPL-2.0) | HSTS, CSP presence, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, CORS, cookie flags from Set-Cookie |
| `csp`             | `csp_evaluator`                        | CSP strength: unsafe-inline, unsafe-eval, wildcard sources, missing base-uri/object-src                          |
| `cookies`         | snapshot cookies                       | Missing Secure/HttpOnly/SameSite, long-lived session cookies                                                     |
| `forms`           | snapshot forms                         | Password fields without autocomplete guidance, login forms on http, cross-origin form actions                    |
| `scripts`         | snapshot scripts                       | External scripts without SRI, scripts from unexpected TLDs, excessive inline scripts                             |
| `trackers`        | tracker DB                             | Third-party domains classified by category (advertising, analytics, fingerprinting)                              |
| `libraries`       | retire.js data                         | Known-vulnerable JS library versions from script URLs                                                            |
| `policy-presence` | snapshot links                         | No detectable privacy policy or terms link                                                                       |

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
fixes can be merged. Confirming the import prune is spike S1 (docs/11); the
fallback is ~10 header rules written from Observatory's published scoring table.

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

`packages/core/src/analyzers/__tests__/` — one file per analyzer, each running
against fixtures and asserting on `ruleId` and `severity`, not on prose.
