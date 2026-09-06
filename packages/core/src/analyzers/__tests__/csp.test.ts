import { describe, expect, it } from "vitest";

import type { Finding } from "../../findings/schema.js";
import { silentLogger } from "../../logger.js";
import { cspAnalyzer } from "../csp/index.js";
import { snapshotWith } from "./snapshot-factory.js";

async function rules(
  policy: string,
  snapshot = snapshotWith(),
): Promise<Array<[string, Finding["severity"]]>> {
  const findings = await cspAnalyzer.run(snapshot, {
    headers: { "content-security-policy": policy },
    logger: silentLogger,
  });
  return findings.map((finding) => [finding.ruleId, finding.severity]);
}

describe("csp analyzer", () => {
  it("finds nothing in a strict, complete policy", async () => {
    const found = await rules(
      "default-src 'none'; script-src 'nonce-r4nd0mUnpredictable123'; " +
        "object-src 'none'; base-uri 'none'",
    );
    expect(found).toEqual([]);
  });

  it("flags the directives that have no safe fallback", async () => {
    const found = await rules("script-src 'nonce-r4nd0mUnpredictable123'");
    expect(found).toContainEqual(["csp-missing-directive", "medium"]);
  });

  it("softens a finding the library is only speculating about", async () => {
    // `'self'` is a bypass only if the origin also hosts JSONP or user uploads,
    // which csp_evaluator cannot know. At full severity this would flag most of
    // the web.
    const findings = await cspAnalyzer.run(snapshotWith(), {
      headers: {
        "content-security-policy":
          "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'",
      },
      logger: silentLogger,
    });
    const bypass = findings.find((f) => f.ruleId === "csp-script-allowlist-bypass");

    expect(bypass?.severity).toBe("medium"); // one step down from high
    expect(bypass?.confidence).toBe("medium");
  });

  it("flags a bare wildcard", async () => {
    const found = await rules("script-src *; object-src 'none'; base-uri 'none'");
    expect(found.map(([rule]) => rule)).toContain("csp-wildcard-source");
  });

  it("flags a scheme allowed as a source", async () => {
    const found = await rules(
      "script-src 'self' data:; object-src 'none'; base-uri 'none'",
    );
    expect(found.map(([rule]) => rule)).toContain("csp-permissive-scheme");
  });

  it("flags an origin that can be used to bypass the allowlist", async () => {
    // Google's own hosts are the canonical JSONP-bypass example.
    const found = await rules(
      "script-src 'self' https://www.google.com; object-src 'none'; base-uri 'none'",
    );
    expect(found.map(([rule]) => rule)).toContain("csp-script-allowlist-bypass");
  });

  it("flags a nonce too short to be unguessable", async () => {
    const found = await rules(
      "script-src 'nonce-abc'; object-src 'none'; base-uri 'none'",
    );
    expect(found.map(([rule]) => rule)).toContain("csp-nonce-too-short");
  });

  it("leaves unsafe-inline to the headers analyzer", async () => {
    // Reporting it here too would give one problem two findings.
    const found = await rules(
      "script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'",
    );
    expect(found.map(([rule]) => rule)).not.toContain("csp-unsafe-inline");
  });

  it("reads a policy from a meta tag as well as a header", async () => {
    const snapshot = snapshotWith({
      metaTags: { "content-security-policy": "script-src *" },
    });
    const findings = await cspAnalyzer.run(snapshot, {
      headers: {},
      logger: silentLogger,
    });

    expect(findings.map((finding) => finding.ruleId)).toContain("csp-wildcard-source");
    expect(findings[0]?.evidence[0]?.location).toBe("meta http-equiv");
  });

  it("does not report the same problem twice when both sources carry it", async () => {
    const snapshot = snapshotWith({
      metaTags: { "content-security-policy": "script-src *" },
    });
    const findings = await cspAnalyzer.run(snapshot, {
      headers: { "content-security-policy": "script-src *" },
      logger: silentLogger,
    });

    const wildcards = findings.filter(
      (finding) => finding.ruleId === "csp-wildcard-source",
    );
    expect(wildcards).toHaveLength(1);
  });

  it("reports nothing when there is no policy at all", async () => {
    // "No CSP" is the headers analyzer's finding, not this one's.
    const findings = await cspAnalyzer.run(snapshotWith(), {
      headers: {},
      logger: silentLogger,
    });
    expect(findings).toEqual([]);
  });

  it("keeps the library's own wording as evidence", async () => {
    const findings = await cspAnalyzer.run(snapshotWith(), {
      headers: { "content-security-policy": "script-src *" },
      logger: silentLogger,
    });
    const wildcard = findings.find((f) => f.ruleId === "csp-wildcard-source");

    expect(wildcard?.evidence[0]?.value).toMatch(/script-src/);
    expect(wildcard?.evidence[0]?.location).toBe("content-security-policy");
  });
});
