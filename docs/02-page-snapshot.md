# 02 — PageSnapshot

The single input to core. Built by the content script using a pure builder that
lives in `core`, validated at the host boundary, consumed by analyzers and the
agent. Define this before writing any extension code.

The builder is shared: the CLI's fixtures and the extension's live captures come
from the same function, so what ships and what is tested cannot drift.

Principles:

- Record what was **observed**, not conclusions. Analyzers draw conclusions.
- Record what **could not** be observed (`limitations`) so analyzers can say
  "unknown" instead of "missing".
- Keep it serialisable JSON. Fixtures are just saved snapshots.

## Schema (zod, in `packages/core/src/snapshot/schema.ts`)

```ts
import { z } from "zod";

export const ScriptRef = z.object({
  src: z.string().url().optional(), // external
  inlineSha256: z.string().optional(), // inline (hash only, not content)
  inlineLength: z.number().int().optional(),
  attrs: z.record(z.string()).default({}), // async, defer, type, nonce, integrity
});

export const FormRef = z.object({
  action: z.string(), // resolved absolute URL
  method: z.enum(["GET", "POST", "other"]),
  fieldTypes: z.array(z.string()), // input types: password, email, ...
  hasPasswordField: z.boolean(),
  autocompleteOff: z.boolean(),
});

export const CookieRef = z.object({
  name: z.string(),
  domain: z.string().optional(),
  // Flags are only visible via chrome.cookies API, not document.cookie
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  sameSite: z.enum(["strict", "lax", "none", "unspecified"]).optional(),
  session: z.boolean().optional(),
  expires: z.number().optional(),
});

export const LinkRef = z.object({
  href: z.string().url(),
  text: z.string().max(200),
  rel: z.string().optional(),
  // heuristic tag assigned by the content script, e.g. "terms", "privacy", "cookies"
  policyHint: z.enum(["terms", "privacy", "cookies", "other"]).optional(),
});

export const PageSnapshot = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.string().datetime(),
  url: z.string().url(),
  title: z.string().max(500),
  protocol: z.enum(["http:", "https:"]),

  // What the content script can see
  scripts: z.array(ScriptRef),
  forms: z.array(FormRef),
  iframes: z.array(
    z.object({ src: z.string().optional(), sandbox: z.string().optional() }),
  ),
  links: z.array(LinkRef),
  metaTags: z.record(z.string()), // name/property → content
  hasMixedContent: z.boolean().optional(), // http subresources on https page
  textExcerpt: z.string().max(20000), // readable text, truncated

  // From extension APIs (background worker)
  cookies: z.array(CookieRef),
  thirdPartyRequests: z
    .array(
      z.object({
        // via webRequest if permitted
        url: z.string().url(),
        type: z.string(), // script, image, xhr, ...
        initiator: z.string().optional(),
      }),
    )
    .default([]),

  // Honesty about gaps
  limitations: z
    .array(
      z.enum([
        "no-webrequest-permission",
        "no-cookie-flags",
        "text-truncated",
        "csp-blocked-inline-collection",
      ]),
    )
    .default([]),
});

export type PageSnapshot = z.infer<typeof PageSnapshot>;
```

## What is NOT in the snapshot

- Response headers. The background worker refetches `url` via the
  `fetchHeaders` tool (docs/06), because a content script can't observe
  main-document response headers. Host permissions mean that refetch sees the
  full header set with no CORS filtering.
- Inline script contents. Only hashes and lengths; avoids shipping arbitrary
  code around and keeps snapshots small.
- Full page HTML. `textExcerpt` is enough for analyzers; the ToS pipeline
  fetches policy pages itself.

## Size budget

Target < 200 KB per snapshot. Truncate `links` to the first 500 and
`thirdPartyRequests` to 1000, adding `text-truncated` style limitation flags
where relevant.

## Fixtures

`fixtures/snapshots/*.json` — one per test site. Include at least:

- a well-configured site (baseline, few findings)
- a site with many third-party scripts
- an http-only site
- a site with a login form
  Snapshots may be hand-edited to create specific conditions; mark those files
  with a `_synthetic` suffix.
