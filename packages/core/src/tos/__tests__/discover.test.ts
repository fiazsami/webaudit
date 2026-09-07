import { describe, expect, it } from "vitest";

import { snapshotWith } from "../../analyzers/__tests__/snapshot-factory.js";
import { discoverPolicies } from "../discover.js";

describe("discoverPolicies", () => {
  it("prefers links the page actually carries over guessed paths", () => {
    const snapshot = snapshotWith({
      url: "https://example.com/",
      links: [
        {
          href: "https://example.com/legal/privacy-notice",
          text: "Privacy",
          policyHint: "privacy",
        },
      ],
    });

    const [first] = discoverPolicies(snapshot);
    expect(first?.url).toBe("https://example.com/legal/privacy-notice");
    expect(first?.source).toBe("link");
  });

  it("orders privacy before terms before the rest", () => {
    const snapshot = snapshotWith({
      url: "https://example.com/",
      links: [
        { href: "https://example.com/legal", text: "Legal", policyHint: "other" },
        { href: "https://example.com/terms", text: "Terms", policyHint: "terms" },
        { href: "https://example.com/privacy", text: "Privacy", policyHint: "privacy" },
      ],
    });

    expect(discoverPolicies(snapshot, { limit: 3 }).map((c) => c.hint)).toEqual([
      "privacy",
      "terms",
      "other",
    ]);
  });

  it("falls back to common paths when the page links nothing", () => {
    const snapshot = snapshotWith({ url: "https://example.com/", links: [] });
    const candidates = discoverPolicies(snapshot, { limit: 2 });

    expect(candidates[0]?.source).toBe("common-path");
    expect(candidates[0]?.url).toBe("https://example.com/privacy");
  });

  it("never leaves the page's own host without an explicit allowlist", () => {
    const snapshot = snapshotWith({
      url: "https://example.com/",
      links: [
        {
          href: "https://policies.other.example/privacy",
          text: "Privacy",
          policyHint: "privacy",
        },
      ],
    });

    // A guess that wanders to another domain is a request somewhere nobody
    // asked us to go.
    expect(
      discoverPolicies(snapshot).every((c) => c.url.startsWith("https://example.com/")),
    ).toBe(true);
  });

  it("honours an explicit allowlist, including subdomains", () => {
    const snapshot = snapshotWith({
      url: "https://www.example.com/",
      links: [
        {
          href: "https://policies.example.com/privacy",
          text: "Privacy",
          policyHint: "privacy",
        },
      ],
    });

    const candidates = discoverPolicies(snapshot, { allowedDomains: ["example.com"] });
    expect(candidates[0]?.url).toBe("https://policies.example.com/privacy");
  });

  it("deduplicates the same document reached two ways", () => {
    const snapshot = snapshotWith({
      url: "https://example.com/",
      links: [
        { href: "https://example.com/privacy", text: "Privacy", policyHint: "privacy" },
        {
          href: "https://example.com/privacy#section-3",
          text: "Data",
          policyHint: "privacy",
        },
      ],
    });

    const urls = discoverPolicies(snapshot).map((c) => c.url);
    expect(urls.filter((url) => url === "https://example.com/privacy")).toHaveLength(1);
  });

  it("respects the limit, since each candidate costs minutes of model time", () => {
    const snapshot = snapshotWith({ url: "https://example.com/", links: [] });
    expect(discoverPolicies(snapshot, { limit: 1 })).toHaveLength(1);
  });

  it("returns nothing for a page URL it cannot parse", () => {
    expect(discoverPolicies(snapshotWith({ url: "not a url" }))).toEqual([]);
  });
});
