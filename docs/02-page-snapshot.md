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

Names follow the CLAUDE.md convention — `FooSchema` for the schema, `Foo` for
the inferred type — rather than reusing one name for both. The syntax is zod 4:
`z.url()` and `z.iso.datetime()` replace the chained `z.string().url()`, and
`z.record` takes an explicit key schema.

```ts
import { z } from "zod";

export const ScriptRefSchema = z.object({
  src: z.url().optional(), // external
  inlineSha256: z.string().optional(), // inline (hash only, not content)
  inlineLength: z.number().int().nonnegative().optional(),
  attrs: z.record(z.string(), z.string()).default({}), // async, defer, type, nonce, integrity
});

export const FormRefSchema = z.object({
  action: z.string(), // resolved absolute URL
  method: z.enum(["GET", "POST", "other"]),
  fieldTypes: z.array(z.string()), // input types: password, email, ...
  hasPasswordField: z.boolean(),
  autocompleteOff: z.boolean(),
});

export const CookieRefSchema = z.object({
  name: z.string(),
  domain: z.string().optional(),
  // Flags are only visible via chrome.cookies API, not document.cookie
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  sameSite: z.enum(["strict", "lax", "none", "unspecified"]).optional(),
  session: z.boolean().optional(),
  expires: z.number().optional(),
});

export const LinkRefSchema = z.object({
  href: z.url(),
  text: z.string().max(200),
  rel: z.string().optional(),
  // heuristic tag assigned during capture, e.g. "terms", "privacy", "cookies"
  policyHint: z.enum(["terms", "privacy", "cookies", "other"]).optional(),
});

export const PageSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.iso.datetime(),
  url: z.url(),
  title: z.string().max(500),
  protocol: z.enum(["http:", "https:"]),

  // What the content script can see
  scripts: z.array(ScriptRefSchema),
  forms: z.array(FormRefSchema),
  iframes: z.array(
    z.object({ src: z.string().optional(), sandbox: z.string().optional() }),
  ),
  links: z.array(LinkRefSchema),
  metaTags: z.record(z.string(), z.string()), // name/property/http-equiv → content
  hasMixedContent: z.boolean().optional(), // http subresources on https page
  textExcerpt: z.string().max(20000), // readable text, truncated

  // From extension APIs (background worker)
  cookies: z.array(CookieRefSchema),
  thirdPartyRequests: z
    .array(
      z.object({
        // via webRequest if permitted
        url: z.url(),
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
        "links-truncated",
        "third-party-requests-truncated",
        "csp-blocked-inline-collection",
      ]),
    )
    .default([]),
});

export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;
```

`links-truncated` and `third-party-requests-truncated` are not in the original
sketch; the size budget below caps both lists, and a cap that is not recorded is
exactly the silent gap this schema exists to prevent.

## The builder and its DOM port

`buildSnapshot(doc, options)` lives in `snapshot/build.ts`. It cannot name
`Document` or `Element`: core omits the DOM lib entirely, which is how hard rule
1 is enforced by the compiler rather than by discipline. So `snapshot/dom.ts`
declares the slice of a document the builder actually reads:

```ts
export interface DomElementLike {
  getAttribute(name: string): string | null;
  readonly textContent: string | null;
  querySelectorAll(selectors: string): Iterable<DomElementLike>;
}

export interface DomDocumentLike {
  readonly title: string;
  readonly body: DomElementLike | null;
  querySelectorAll(selectors: string): Iterable<DomElementLike>;
}
```

A browser `Document` and a linkedom document both satisfy these structurally,
with no adapter. That claim is a claim about types, so it is asserted at compile
time — `packages/extension` checks the browser half, `packages/cli` the linkedom
half — and `pnpm -r typecheck` fails if either stops holding. Keep the port
minimal: every member added is a new obligation on every host.

Two things the builder takes as options rather than reaching for:

- `capturedAt`, because core has no clock (docs/01).
- `hashInlineScript`, because SHA-256 needs SubtleCrypto, which is a host API.
  Without it a snapshot records `inlineLength` and no hash.

Whether `cookies` and `thirdPartyRequests` were supplied at all is the signal
for the `no-cookie-flags` and `no-webrequest-permission` limitations. Passing an
empty array means "looked, found none"; omitting the option means "could not
look". The distinction matters to every analyzer downstream.

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

Target < 200 KB per snapshot. `links` truncates to the first 500,
`thirdPartyRequests` to 1000, and `textExcerpt` to 20000 characters. Each cap
that actually bites adds its limitation flag — `links-truncated`,
`third-party-requests-truncated`, `text-truncated` — so a short list is never
mistaken for a complete one.

## Fixtures

`fixtures/snapshots/*.json` — one per test site. Include at least:

- a well-configured site (baseline, few findings)
- a site with many third-party scripts
- an http-only site
- a site with a login form
  Snapshots may be hand-edited to create specific conditions; mark those files
  with a `_synthetic` suffix.
