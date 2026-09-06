import { describe, expect, it } from "vitest";

import {
  createFinding,
  dedupeFindings,
  FindingSchema,
  sortFindings,
  type FindingInput,
} from "../schema.js";

const base: FindingInput = {
  analyzerId: "transport",
  ruleId: "insecure-protocol",
  severity: "high",
  confidence: "high",
  title: "Page served over HTTP",
  summary: "The page was loaded over an unencrypted connection.",
  evidence: [{ kind: "other", value: "http://example.com/" }],
};

describe("createFinding", () => {
  it("produces a finding that validates against the schema", () => {
    expect(() => FindingSchema.parse(createFinding(base))).not.toThrow();
  });

  it("gives the same observation the same id on every run", () => {
    expect(createFinding(base).id).toBe(createFinding(base).id);
  });

  it("ignores the order the caller happened to write the fields in", () => {
    const reordered = createFinding({
      evidence: base.evidence,
      summary: base.summary,
      title: base.title,
      confidence: base.confidence,
      severity: base.severity,
      ruleId: base.ruleId,
      analyzerId: base.analyzerId,
    });

    expect(reordered.id).toBe(createFinding(base).id);
  });

  it("distinguishes findings that differ only in evidence", () => {
    const other = createFinding({
      ...base,
      evidence: [{ kind: "other", value: "http://elsewhere.example/" }],
    });

    expect(other.id).not.toBe(createFinding(base).id);
  });

  it("keeps the analyzer and rule readable in the id", () => {
    expect(createFinding(base).id).toMatch(
      /^transport:insecure-protocol:[0-9a-f]{16}$/,
    );
  });
});

describe("sortFindings", () => {
  it("puts the most severe first", () => {
    const findings = (["low", "critical", "info", "high", "medium"] as const).map(
      (severity, index) =>
        createFinding({
          ...base,
          severity,
          evidence: [{ kind: "other", value: String(index) }],
        }),
    );

    expect(sortFindings(findings).map((f) => f.severity)).toEqual([
      "critical",
      "high",
      "medium",
      "low",
      "info",
    ]);
  });
});

describe("dedupeFindings", () => {
  it("collapses the same observation seen twice", () => {
    expect(dedupeFindings([createFinding(base), createFinding(base)])).toHaveLength(1);
  });
});
