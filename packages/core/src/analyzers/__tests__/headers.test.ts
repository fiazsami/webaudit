import { describe, expect, it, vi } from "vitest";

import type { Finding } from "../../findings/schema.js";
import { silentLogger } from "../../logger.js";
import { headersAnalyzer, setHstsPreloadList } from "../headers/index.js";
import { HEADER_RULES } from "../headers/mapping.js";
import { snapshotWith } from "./snapshot-factory.js";

/** Headers a well-configured site sends. The baseline for these tests. */
const GOOD: Record<string, string> = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'self'; object-src 'none'",
  "cross-origin-opener-policy": "same-origin",
  "content-type": "text/html; charset=utf-8",
};

const MODE_FORCE = { mode: "force-https", includeSubDomains: true };

async function rules(
  headers: Record<string, string>,
  snapshot = snapshotWith(),
): Promise<Array<[string, Finding["severity"]]>> {
  const findings = await headersAnalyzer.run(snapshot, {
    headers,
    logger: silentLogger,
  });
  return findings.map((finding) => [finding.ruleId, finding.severity]);
}

describe("headers analyzer", () => {
  it("declares that it needs headers, so it is skipped rather than wrong", () => {
    expect(headersAnalyzer.needs).toEqual(["headers"]);
  });

  it("finds nothing on a well-configured response", async () => {
    expect(await rules(GOOD)).toEqual([]);
  });

  it("reports every missing header on a bare response", async () => {
    const found = (await rules({ "content-type": "text/html" })).map(([rule]) => rule);

    expect(found).toContain("hsts-missing");
    expect(found).toContain("csp-missing");
    expect(found).toContain("framing-not-restricted");
    expect(found).toContain("x-content-type-options-missing");
    expect(found).toContain("referrer-policy-missing");
    expect(found).toContain("coop-missing");
  });

  it("treats unsafe-inline in a CSP as a real weakness", async () => {
    const found = await rules({
      ...GOOD,
      "content-security-policy": "default-src 'self' 'unsafe-inline'",
    });
    expect(found).toContainEqual(["csp-unsafe-inline", "medium"]);
  });

  it("separates unsafe-eval from unsafe-inline", async () => {
    const found = await rules({
      ...GOOD,
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-eval'",
    });
    expect(found.map(([rule]) => rule)).toContain("csp-unsafe-eval");
  });

  it("flags a short HSTS max-age without calling it missing", async () => {
    const found = await rules({ ...GOOD, "strict-transport-security": "max-age=100" });
    expect(found).toContainEqual(["hsts-max-age-short", "low"]);
    expect(found.map(([rule]) => rule)).not.toContain("hsts-missing");
  });

  it("does not claim HSTS is missing on an http page", async () => {
    const snapshot = snapshotWith({ protocol: "http:", url: "http://example.com/" });
    const found = await rules({ "content-type": "text/html" }, snapshot);

    // HSTS does not apply over http; saying "missing" would be misleading.
    expect(found.map(([rule]) => rule)).not.toContain("hsts-missing");
    expect(found).toContainEqual(["hsts-no-https", "info"]);
  });

  it("does not pretend to have checked CORS", async () => {
    // The CORS test is not wired: its only interesting verdict needs a probe
    // request carrying an Origin header, which the worker does not send. It must
    // report nothing rather than something reassuring.
    const found = await rules({
      ...GOOD,
      "access-control-allow-origin": "*",
      "access-control-allow-credentials": "true",
    });
    expect(found.map(([rule]) => rule)).not.toContain("cors-universal-access");
  });

  it("carries the observed header value as evidence", async () => {
    const findings = await headersAnalyzer.run(snapshotWith(), {
      headers: { ...GOOD, "strict-transport-security": "max-age=100" },
      logger: silentLogger,
    });
    const hsts = findings.find((finding) => finding.ruleId === "hsts-max-age-short");

    expect(hsts?.evidence[0]).toEqual({
      kind: "header",
      value: "max-age=100",
      location: "strict-transport-security",
    });
  });

  it("warns rather than dropping a verdict mapping.ts does not know", async () => {
    const warn = vi.fn();
    // Temporarily hide a mapping to simulate upstream adding a new verdict.
    const saved = HEADER_RULES["csp-not-implemented"];
    delete HEADER_RULES["csp-not-implemented"];
    try {
      await headersAnalyzer.run(snapshotWith(), {
        headers: { "content-type": "text/html" },
        logger: { ...silentLogger, warn },
      });
    } finally {
      HEADER_RULES["csp-not-implemented"] = saved ?? null;
    }

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no mapping for verdict"),
    );
  });

  it("admits it has not loaded the preload list", async () => {
    const findings = await headersAnalyzer.run(snapshotWith(), {
      headers: { ...GOOD, "strict-transport-security": "max-age=100" },
      logger: silentLogger,
    });
    const hsts = findings.find((finding) => finding.ruleId === "hsts-max-age-short");

    // A preloaded site with a short max-age is protected anyway, so without the
    // list this finding is a maybe, and says so.
    expect(hsts?.summary).toContain("preload list");
    expect(hsts?.confidence).toBe("medium");
  });

  it("drops the caveat once the preload list is supplied", async () => {
    setHstsPreloadList(new Map([["other.example", MODE_FORCE]]));
    try {
      const findings = await headersAnalyzer.run(snapshotWith(), {
        headers: { ...GOOD, "strict-transport-security": "max-age=100" },
        logger: silentLogger,
      });
      const hsts = findings.find((f) => f.ruleId === "hsts-max-age-short");

      expect(hsts?.summary).not.toContain("preload list");
      expect(hsts?.confidence).toBe("high");
    } finally {
      setHstsPreloadList(new Map());
    }
  });

  it("reports nothing for a site that is on the preload list", async () => {
    setHstsPreloadList(new Map([["example.com", MODE_FORCE]]));
    try {
      const findings = await headersAnalyzer.run(snapshotWith(), {
        headers: { ...GOOD, "strict-transport-security": "max-age=100" },
        logger: silentLogger,
      });

      // hsts-preloaded overrides the short max-age, and is not a problem.
      expect(findings.map((f) => f.ruleId)).not.toContain("hsts-max-age-short");
    } finally {
      setHstsPreloadList(new Map());
    }
  });

  it("maps every verdict the wired tests can return", async () => {
    // A missing entry is a silent gap, so the table is checked against the
    // vendor's own possibleResults rather than trusted.
    const { possibleVerdicts } = await import("./vendor-verdicts.js");
    const unmapped = possibleVerdicts.filter(
      (verdict) => !Object.hasOwn(HEADER_RULES, verdict),
    );
    expect(unmapped).toEqual([]);
  });
});
