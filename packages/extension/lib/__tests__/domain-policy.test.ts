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
    expect(normalizeAllowedDomains(["com", "co.uk"])).toEqual([]);
  });

  it("keeps hosts that are not dotted, because they are still real hosts", () => {
    // Refusing these meant refusing to fetch the page under audit — which is
    // exactly what happened to the localhost fixture site.
    expect(normalizeAllowedDomains(["localhost", "intranet"])).toEqual([
      "localhost",
      "intranet",
    ]);
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

describe("subdomain matching", () => {
  it("does not extend a single-label host to its subdomains", () => {
    // "localhost" must not open "evil.localhost".
    expect(checkUrlAllowed("http://localhost:8787/", ["localhost"]).allowed).toBe(true);
    expect(checkUrlAllowed("http://evil.localhost/", ["localhost"]).allowed).toBe(
      false,
    );
  });

  it("does not extend an IP address to anything", () => {
    expect(checkUrlAllowed("http://127.0.0.1:8080/", ["127.0.0.1"]).allowed).toBe(true);
    expect(checkUrlAllowed("http://x.127.0.0.1/", ["127.0.0.1"]).allowed).toBe(false);
  });

  it("still extends a dotted name to its subdomains", () => {
    expect(checkUrlAllowed("https://legal.example.com/", ["example.com"]).allowed).toBe(
      true,
    );
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

  it("can audit a page served on localhost", () => {
    // The fixture site is served on localhost, and the first version of this
    // refused it — so the header and CSP analyzers reported themselves skipped
    // on the one page built to exercise them.
    expect(allowlistForPage("http://localhost:8787/")).toEqual(["localhost"]);
    expect(
      checkUrlAllowed(
        "http://localhost:8787/",
        allowlistForPage("http://localhost:8787/"),
      ).allowed,
    ).toBe(true);
  });
});
