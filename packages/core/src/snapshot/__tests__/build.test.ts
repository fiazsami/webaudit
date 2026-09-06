import { describe, expect, it } from "vitest";

import { buildSnapshot } from "../build.js";
import { PageSnapshotSchema, SNAPSHOT_LIMITS } from "../schema.js";
import { fakeDocument } from "./fake-dom.js";

const CAPTURED_AT = "2026-09-06T12:00:00.000Z";
const BASE = "https://example.com/account";

describe("buildSnapshot", () => {
  it("produces output that validates against the schema", async () => {
    const snapshot = await buildSnapshot(fakeDocument({ title: "Example" }), {
      url: BASE,
      capturedAt: CAPTURED_AT,
    });

    expect(() => PageSnapshotSchema.parse(snapshot)).not.toThrow();
    expect(snapshot.protocol).toBe("https:");
  });

  it("records what could not be observed rather than guessing", async () => {
    const snapshot = await buildSnapshot(fakeDocument({}), {
      url: BASE,
      capturedAt: CAPTURED_AT,
    });

    // No cookies and no request log were supplied, so both gaps are declared.
    expect(snapshot.limitations).toContain("no-cookie-flags");
    expect(snapshot.limitations).toContain("no-webrequest-permission");
  });

  it("does not declare gaps the host actually filled", async () => {
    const snapshot = await buildSnapshot(fakeDocument({}), {
      url: BASE,
      capturedAt: CAPTURED_AT,
      cookies: [{ name: "sid", secure: true }],
      thirdPartyRequests: [],
    });

    expect(snapshot.limitations).not.toContain("no-cookie-flags");
    expect(snapshot.limitations).not.toContain("no-webrequest-permission");
  });

  it("resolves relative URLs against the page", async () => {
    const doc = fakeDocument({
      elements: {
        script: [{ attrs: { src: "/static/app.js", defer: "" } }],
        "a[href]": [{ attrs: { href: "../privacy" }, text: "Privacy" }],
      },
    });

    const snapshot = await buildSnapshot(doc, { url: BASE, capturedAt: CAPTURED_AT });

    expect(snapshot.scripts[0]?.src).toBe("https://example.com/static/app.js");
    expect(snapshot.scripts[0]?.attrs).toEqual({ defer: "" });
    expect(snapshot.links[0]?.href).toBe("https://example.com/privacy");
  });

  it("skips links that are not navigable http(s) targets", async () => {
    const doc = fakeDocument({
      elements: {
        "a[href]": [
          { attrs: { href: "mailto:hi@example.com" }, text: "Mail" },
          { attrs: { href: "javascript:void(0)" }, text: "Menu" },
          { attrs: { href: "https://example.com/terms" }, text: "Terms" },
        ],
      },
    });

    const snapshot = await buildSnapshot(doc, { url: BASE, capturedAt: CAPTURED_AT });

    expect(snapshot.links.map((link) => link.href)).toEqual([
      "https://example.com/terms",
    ]);
  });

  it("tags policy links so the ToS pipeline has somewhere to start", async () => {
    const doc = fakeDocument({
      elements: {
        "a[href]": [
          {
            attrs: { href: "https://example.com/legal/tos" },
            text: "Terms of Service",
          },
          { attrs: { href: "https://example.com/p" }, text: "Privacy Policy" },
          { attrs: { href: "https://example.com/c" }, text: "Cookie Settings" },
          { attrs: { href: "https://example.com/blog" }, text: "Blog" },
        ],
      },
    });

    const snapshot = await buildSnapshot(doc, { url: BASE, capturedAt: CAPTURED_AT });

    expect(snapshot.links.map((link) => link.policyHint)).toEqual([
      "terms",
      "privacy",
      "cookies",
      undefined,
    ]);
  });

  it("reads a form's own fields, not the whole document's", async () => {
    const doc = fakeDocument({
      elements: {
        form: [
          {
            attrs: { action: "/login", method: "post", autocomplete: "off" },
            children: {
              input: [
                { attrs: { type: "email" } },
                { attrs: { type: "password" } },
                {}, // no type attribute defaults to text
              ],
            },
          },
        ],
      },
    });

    const snapshot = await buildSnapshot(doc, { url: BASE, capturedAt: CAPTURED_AT });

    expect(snapshot.forms[0]).toEqual({
      action: "https://example.com/login",
      method: "POST",
      fieldTypes: ["email", "password", "text"],
      hasPasswordField: true,
      autocompleteOff: true,
    });
  });

  it("treats a form with no action as submitting to the page", async () => {
    const doc = fakeDocument({ elements: { form: [{}] } });

    const snapshot = await buildSnapshot(doc, { url: BASE, capturedAt: CAPTURED_AT });

    expect(snapshot.forms[0]?.action).toBe(BASE);
    expect(snapshot.forms[0]?.method).toBe("GET");
  });

  it("flags an http subresource on an https page as mixed content", async () => {
    const doc = fakeDocument({
      elements: { script: [{ attrs: { src: "http://cdn.example.net/a.js" } }] },
    });

    const snapshot = await buildSnapshot(doc, { url: BASE, capturedAt: CAPTURED_AT });

    expect(snapshot.hasMixedContent).toBe(true);
  });

  it("does not flag mixed content on an http page", async () => {
    const doc = fakeDocument({
      elements: { script: [{ attrs: { src: "http://cdn.example.net/a.js" } }] },
    });

    const snapshot = await buildSnapshot(doc, {
      url: "http://example.com/",
      capturedAt: CAPTURED_AT,
    });

    expect(snapshot.protocol).toBe("http:");
    expect(snapshot.hasMixedContent).toBe(false);
  });

  it("hashes inline scripts only when the host supplies a hasher", async () => {
    const doc = fakeDocument({ elements: { script: [{ text: "alert(1)" }] } });
    const options = { url: BASE, capturedAt: CAPTURED_AT };

    const without = await buildSnapshot(doc, options);
    expect(without.scripts[0]).toEqual({ inlineLength: 8, attrs: {} });

    const withHash = await buildSnapshot(doc, {
      ...options,
      hashInlineScript: (source) => Promise.resolve(`len-${String(source.length)}`),
    });
    expect(withHash.scripts[0]?.inlineSha256).toBe("len-8");
  });

  it("truncates to the size budget and says so", async () => {
    const overLimit = SNAPSHOT_LIMITS.maxLinks + 10;
    const doc = fakeDocument({
      bodyText: "x".repeat(SNAPSHOT_LIMITS.maxTextExcerpt + 100),
      elements: {
        "a[href]": Array.from({ length: overLimit }, (_, index) => ({
          attrs: { href: `https://example.com/page/${String(index)}` },
        })),
      },
    });

    const snapshot = await buildSnapshot(doc, { url: BASE, capturedAt: CAPTURED_AT });

    expect(snapshot.links).toHaveLength(SNAPSHOT_LIMITS.maxLinks);
    expect(snapshot.textExcerpt).toHaveLength(SNAPSHOT_LIMITS.maxTextExcerpt);
    expect(snapshot.limitations).toContain("links-truncated");
    expect(snapshot.limitations).toContain("text-truncated");
    expect(() => PageSnapshotSchema.parse(snapshot)).not.toThrow();
  });
});
