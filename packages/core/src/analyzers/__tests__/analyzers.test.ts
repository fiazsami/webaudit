import { describe, expect, it } from "vitest";

import type { Finding } from "../../findings/schema.js";
import { silentLogger } from "../../logger.js";
import { cookiesAnalyzer } from "../cookies/index.js";
import { formsAnalyzer } from "../forms/index.js";
import { policyPresenceAnalyzer } from "../policy-presence/index.js";
import { scriptsAnalyzer } from "../scripts/index.js";
import { transportAnalyzer } from "../transport/index.js";
import type { Analyzer } from "../types.js";
import { snapshotWith } from "./snapshot-factory.js";

/** Assert on ruleId and severity, never on prose (docs/03). */
async function rules(
  analyzer: Analyzer,
  snapshot: Parameters<Analyzer["run"]>[0],
): Promise<Array<[string, Finding["severity"]]>> {
  const findings = await analyzer.run(snapshot, { logger: silentLogger });
  return findings.map((finding) => [finding.ruleId, finding.severity]);
}

describe("transport analyzer", () => {
  it("finds nothing on a well-configured page", async () => {
    expect(await rules(transportAnalyzer, snapshotWith())).toEqual([]);
  });

  it("flags an unencrypted page", async () => {
    const snapshot = snapshotWith({ protocol: "http:", url: "http://example.com/" });
    expect(await rules(transportAnalyzer, snapshot)).toEqual([
      ["insecure-protocol", "high"],
    ]);
  });

  it("flags insecure subresources on an https page", async () => {
    const snapshot = snapshotWith({
      hasMixedContent: true,
      scripts: [{ src: "http://cdn.example.net/a.js", attrs: {} }],
    });
    expect(await rules(transportAnalyzer, snapshot)).toEqual([
      ["mixed-content", "medium"],
    ]);
  });

  it("leaves form rules to the forms analyzer", async () => {
    const snapshot = snapshotWith({
      forms: [
        {
          action: "http://example.com/login",
          method: "POST",
          fieldTypes: ["password"],
          hasPasswordField: true,
          autocompleteOff: false,
        },
      ],
    });
    expect(await rules(transportAnalyzer, snapshot)).toEqual([]);
  });
});

describe("cookies analyzer", () => {
  it("finds nothing on well-configured cookies", async () => {
    const snapshot = snapshotWith({
      cookies: [
        { name: "sid", secure: true, httpOnly: true, sameSite: "lax", session: true },
      ],
    });
    expect(await rules(cookiesAnalyzer, snapshot)).toEqual([]);
  });

  it("reports unknown rather than missing when flags could not be read", async () => {
    const snapshot = snapshotWith({
      limitations: ["no-cookie-flags"],
      cookies: [{ name: "sid" }],
    });

    // Exactly one info finding, and none of the missing-flag rules.
    expect(await rules(cookiesAnalyzer, snapshot)).toEqual([
      ["cookie-flags-unknown", "info"],
    ]);
  });

  it("flags missing Secure and HttpOnly", async () => {
    const snapshot = snapshotWith({
      cookies: [{ name: "sid", secure: false, httpOnly: false, sameSite: "lax" }],
    });
    expect(await rules(cookiesAnalyzer, snapshot)).toEqual([
      ["cookie-missing-secure", "medium"],
      ["cookie-missing-httponly", "medium"],
    ]);
  });

  it("flags SameSite=None without Secure", async () => {
    const snapshot = snapshotWith({
      cookies: [{ name: "ads", secure: false, httpOnly: true, sameSite: "none" }],
    });
    expect(await rules(cookiesAnalyzer, snapshot)).toContainEqual([
      "cookie-samesite-none-insecure",
      "medium",
    ]);
  });

  it("measures cookie lifetime against the capture, not the wall clock", async () => {
    // Two years past capturedAt.
    const snapshot = snapshotWith({
      cookies: [
        {
          name: "track",
          secure: true,
          httpOnly: true,
          sameSite: "lax",
          expires: Date.parse("2028-09-06T12:00:00.000Z") / 1000,
        },
      ],
    });
    expect(await rules(cookiesAnalyzer, snapshot)).toEqual([
      ["cookie-long-lived", "low"],
    ]);
  });

  it("does not call a short-lived cookie long-lived", async () => {
    const snapshot = snapshotWith({
      cookies: [
        {
          name: "prefs",
          secure: true,
          httpOnly: true,
          sameSite: "lax",
          expires: Date.parse("2026-10-06T12:00:00.000Z") / 1000,
        },
      ],
    });
    expect(await rules(cookiesAnalyzer, snapshot)).toEqual([]);
  });
});

describe("forms analyzer", () => {
  const passwordForm = {
    action: "https://example.com/session",
    method: "POST" as const,
    fieldTypes: ["email", "password"],
    hasPasswordField: true,
    autocompleteOff: false,
  };

  it("finds nothing on a same-origin https login form", async () => {
    expect(await rules(formsAnalyzer, snapshotWith({ forms: [passwordForm] }))).toEqual(
      [],
    );
  });

  it("treats a password posted over http as critical", async () => {
    const snapshot = snapshotWith({
      forms: [{ ...passwordForm, action: "http://example.com/session" }],
    });
    expect(await rules(formsAnalyzer, snapshot)).toContainEqual([
      "login-form-insecure-action",
      "critical",
    ]);
  });

  it("separates a non-password insecure form from a login one", async () => {
    const snapshot = snapshotWith({
      forms: [
        {
          action: "http://example.com/search",
          method: "GET",
          fieldTypes: ["search"],
          hasPasswordField: false,
          autocompleteOff: false,
        },
      ],
    });
    const found = await rules(formsAnalyzer, snapshot);
    expect(found).toContainEqual(["form-insecure-action", "medium"]);
    expect(found.map(([rule]) => rule)).not.toContain("login-form-insecure-action");
  });

  it("flags a login form delivered over http even when it posts to https", async () => {
    const snapshot = snapshotWith({
      protocol: "http:",
      url: "http://example.com/login",
      forms: [passwordForm],
    });
    expect(await rules(formsAnalyzer, snapshot)).toContainEqual([
      "login-form-on-insecure-page",
      "high",
    ]);
  });

  it("raises severity when a cross-origin form carries a password", async () => {
    const withPassword = snapshotWith({
      forms: [{ ...passwordForm, action: "https://auth.other.example/session" }],
    });
    const withoutPassword = snapshotWith({
      forms: [
        {
          action: "https://newsletter.other.example/subscribe",
          method: "POST",
          fieldTypes: ["email"],
          hasPasswordField: false,
          autocompleteOff: false,
        },
      ],
    });

    expect(await rules(formsAnalyzer, withPassword)).toContainEqual([
      "cross-origin-form-action",
      "medium",
    ]);
    expect(await rules(formsAnalyzer, withoutPassword)).toContainEqual([
      "cross-origin-form-action",
      "low",
    ]);
  });

  it("flags autocomplete=off on a password form", async () => {
    const snapshot = snapshotWith({
      forms: [{ ...passwordForm, autocompleteOff: true }],
    });
    expect(await rules(formsAnalyzer, snapshot)).toContainEqual([
      "password-form-autocomplete-off",
      "low",
    ]);
  });
});

describe("scripts analyzer", () => {
  it("finds nothing when third-party scripts carry an integrity hash", async () => {
    const snapshot = snapshotWith({
      scripts: [
        { src: "https://cdn.other.example/lib.js", attrs: { integrity: "sha384-x" } },
        { src: "https://example.com/app.js", attrs: {} },
      ],
    });
    expect(await rules(scriptsAnalyzer, snapshot)).toEqual([]);
  });

  it("flags a third-party script with no integrity hash", async () => {
    const snapshot = snapshotWith({
      scripts: [{ src: "https://cdn.other.example/lib.js", attrs: {} }],
    });
    expect(await rules(scriptsAnalyzer, snapshot)).toEqual([
      ["third-party-script-without-sri", "medium"],
    ]);
  });

  it("does not ask a same-origin script for an integrity hash", async () => {
    const snapshot = snapshotWith({
      scripts: [{ src: "https://example.com/app.js", attrs: {} }],
    });
    expect(await rules(scriptsAnalyzer, snapshot)).toEqual([]);
  });

  it("flags a page built out of inline scripts", async () => {
    const snapshot = snapshotWith({
      scripts: Array.from({ length: 16 }, () => ({ inlineLength: 100, attrs: {} })),
    });
    expect(await rules(scriptsAnalyzer, snapshot)).toEqual([
      ["excessive-inline-scripts", "low"],
    ]);
  });

  it("leaves a handful of inline scripts alone", async () => {
    const snapshot = snapshotWith({
      scripts: Array.from({ length: 15 }, () => ({ inlineLength: 100, attrs: {} })),
    });
    expect(await rules(scriptsAnalyzer, snapshot)).toEqual([]);
  });
});

describe("policy-presence analyzer", () => {
  it("finds nothing when both policies are linked", async () => {
    expect(await rules(policyPresenceAnalyzer, snapshotWith())).toEqual([]);
  });

  it("flags a page with no policy links at all", async () => {
    expect(await rules(policyPresenceAnalyzer, snapshotWith({ links: [] }))).toEqual([
      ["no-privacy-policy-link", "medium"],
      ["no-terms-link", "low"],
    ]);
  });

  it("lowers confidence when the link list was truncated", async () => {
    const findings = await policyPresenceAnalyzer.run(
      snapshotWith({ links: [], limitations: ["links-truncated"] }),
      { logger: silentLogger },
    );
    expect(findings.every((finding) => finding.confidence === "low")).toBe(true);
  });
});
