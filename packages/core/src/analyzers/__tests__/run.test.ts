import { describe, expect, it } from "vitest";

import { createFinding, type Finding } from "../../findings/schema.js";
import { silentLogger } from "../../logger.js";
import type { PageSnapshot } from "../../snapshot/schema.js";
import { runAnalyzers } from "../run.js";
import type { Analyzer, AnalyzerContext } from "../types.js";

const snapshot = {
  schemaVersion: 1,
  capturedAt: "2026-09-06T12:00:00.000Z",
  url: "https://example.com/",
  title: "Example",
  protocol: "https:",
  scripts: [],
  forms: [],
  iframes: [],
  links: [],
  metaTags: {},
  textExcerpt: "",
  cookies: [],
  thirdPartyRequests: [],
  limitations: [],
} satisfies PageSnapshot;

const ctx: AnalyzerContext = { logger: silentLogger };

function stubAnalyzer(
  id: string,
  findings: Finding[],
  needs: Analyzer["needs"] = [],
): Analyzer {
  return { id, needs, run: () => Promise.resolve(findings) };
}

function finding(analyzerId: string, severity: Finding["severity"]): Finding {
  return createFinding({
    analyzerId,
    ruleId: "example",
    severity,
    confidence: "high",
    title: "Example",
    summary: "Example",
    evidence: [{ kind: "other", value: analyzerId }],
  });
}

describe("runAnalyzers", () => {
  it("collects findings from every analyzer, most severe first", async () => {
    const findings = await runAnalyzers(snapshot, ctx, [
      stubAnalyzer("a", [finding("a", "low")]),
      stubAnalyzer("b", [finding("b", "critical")]),
    ]);

    expect(findings.map((f) => f.severity)).toEqual(["critical", "low"]);
  });

  it("says so when an analyzer is skipped for a missing input", async () => {
    const findings = await runAnalyzers(snapshot, ctx, [
      stubAnalyzer("headers", [finding("headers", "high")], ["headers"]),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe("analyzer-skipped");
    expect(findings[0]?.summary).toContain("headers");
    // Unknown, not passing — the distinction the finding exists to preserve.
    expect(findings[0]?.summary).toContain("not passing");
  });

  it("runs an analyzer once its need is satisfied", async () => {
    const findings = await runAnalyzers(
      snapshot,
      { ...ctx, headers: { "strict-transport-security": "max-age=63072000" } },
      [stubAnalyzer("headers", [finding("headers", "high")], ["headers"])],
    );

    expect(findings.map((f) => f.ruleId)).toEqual(["example"]);
  });

  it("does not let one throwing analyzer lose the others' results", async () => {
    const thrower: Analyzer = {
      id: "broken",
      needs: [],
      run: () => Promise.reject(new Error("boom")),
    };

    const findings = await runAnalyzers(snapshot, ctx, [
      thrower,
      stubAnalyzer("ok", [finding("ok", "medium")]),
    ]);

    expect(findings.map((f) => f.ruleId).sort()).toEqual([
      "analyzer-failed",
      "example",
    ]);
    expect(
      findings.find((f) => f.ruleId === "analyzer-failed")?.evidence[0]?.value,
    ).toBe("boom");
  });

  it("collapses the same observation reported by two analyzers", async () => {
    const shared = finding("shared", "medium");
    const findings = await runAnalyzers(snapshot, ctx, [
      stubAnalyzer("a", [shared]),
      stubAnalyzer("b", [shared]),
    ]);

    expect(findings).toHaveLength(1);
  });
});
