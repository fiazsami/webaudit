import type { PageSnapshot } from "../../snapshot/schema.js";

/**
 * A minimal, valid snapshot that analyzers should find nothing wrong with.
 * Tests override only the field under test, so an assertion failure points at
 * the rule rather than at incidental fixture noise.
 */
export function snapshotWith(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: "2026-09-06T12:00:00.000Z",
    url: "https://example.com/",
    title: "Example",
    protocol: "https:",
    scripts: [],
    forms: [],
    iframes: [],
    links: [
      { href: "https://example.com/privacy", text: "Privacy", policyHint: "privacy" },
      { href: "https://example.com/terms", text: "Terms", policyHint: "terms" },
    ],
    metaTags: {},
    hasMixedContent: false,
    textExcerpt: "",
    cookies: [],
    thirdPartyRequests: [],
    limitations: [],
    ...overrides,
  };
}
