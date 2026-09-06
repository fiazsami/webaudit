import { describe, expect, it } from "vitest";

import {
  allowlistForPage,
  checkUrlAllowed,
  normalizeAllowedDomains,
} from "../domain-policy.js";

const allowed = ["example.com"];

describe("checkUrlAllowed", () => {
  it("allows the exact host", () => {
    expect(checkUrlAllowed("https://example.com/terms", allowed).allowed).toBe(true);
  });

  it("allows a subdomain of an allowed host", () => {
    expect(checkUrlAllowed("https://legal.example.com/tos", allowed).allowed).toBe(
      true,
    );
  });

  it("refuses a different host", () => {
    expect(checkUrlAllowed("https://attacker.example/collect", allowed).allowed).toBe(
      false,
    );
  });

  it("refuses a host that merely ends with the allowed string", () => {
    // notexample.com must not match example.com.
    expect(checkUrlAllowed("https://notexample.com/", allowed).allowed).toBe(false);
  });

  it("refuses a host that has the allowed domain as a prefix", () => {
    expect(checkUrlAllowed("https://example.com.attacker.test/", allowed).allowed).toBe(
      false,
    );
  });

  it("refuses schemes that are never fetchable", () => {
    for (const url of [
      "file:///etc/passwd",
      "data:text/html,<script>alert(1)</script>",
      "javascript:alert(1)",
      "chrome-extension://abc/page.html",
    ]) {
      expect(checkUrlAllowed(url, ["example.com"]).allowed).toBe(false);
    }
  });

  it("refuses a URL carrying credentials", () => {
    expect(checkUrlAllowed("https://user:pw@example.com/", allowed).allowed).toBe(
      false,
    );
  });

  it("refuses everything when the allowlist is empty", () => {
    expect(checkUrlAllowed("https://example.com/", []).allowed).toBe(false);
  });

  it("is case-insensitive about the host", () => {
    expect(checkUrlAllowed("https://EXAMPLE.com/x", allowed).allowed).toBe(true);
  });
});

describe("normalizeAllowedDomains", () => {
  it("refuses a bare public suffix, which would open the whole suffix", () => {
    expect(normalizeAllowedDomains(["com", "co.uk", "localhost"])).toEqual([]);
  });

  it("refuses a single label with no dot", () => {
    expect(normalizeAllowedDomains(["intranet"])).toEqual([]);
  });

  it("strips leading dots and lowercases", () => {
    expect(normalizeAllowedDomains([".Example.COM"])).toEqual(["example.com"]);
  });

  it("removes duplicates", () => {
    expect(normalizeAllowedDomains(["example.com", "example.com"])).toEqual([
      "example.com",
    ]);
  });
});

describe("allowlistForPage", () => {
  it("starts from the audited page's own host", () => {
    expect(allowlistForPage("https://shop.example.com/cart")).toEqual([
      "shop.example.com",
    ]);
  });

  it("yields an empty list for an unparseable page URL, refusing everything", () => {
    expect(allowlistForPage("not a url")).toEqual([]);
  });
});
