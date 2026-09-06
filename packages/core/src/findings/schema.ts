import { z } from "zod";

import { stableHash } from "../hash.js";

/**
 * What an analyzer produces (docs/03).
 *
 * Every field except `explanation` is deterministic, which is what lets tests
 * assert exact output. `explanation` is the only field a model ever writes.
 */

export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

/** Most severe first. Used to sort findings for display. */
export const SEVERITY_ORDER: readonly Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export const ConfidenceSchema = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const EvidenceSchema = z.object({
  kind: z.enum([
    "header",
    "cookie",
    "script",
    "form",
    "request",
    "policy-text",
    "other",
  ]),
  value: z.string().max(1000),
  location: z.string().optional(), // URL, selector, line ref
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FindingSchema = z.object({
  id: z.string(), // `${analyzerId}:${ruleId}:${hash(evidence)}` — see createFinding
  analyzerId: z.string(),
  ruleId: z.string(), // e.g. "hsts-missing"
  severity: SeveritySchema,
  confidence: ConfidenceSchema,
  title: z.string().max(120),
  summary: z.string().max(500), // deterministic, written by the analyzer
  evidence: z.array(EvidenceSchema),
  references: z.array(z.url()).default([]),

  // Filled later by the model, never by the analyzer:
  explanation: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
export type Finding = z.infer<typeof FindingSchema>;

/** Everything `createFinding` cannot derive on its own. */
export type FindingInput = Omit<Finding, "id" | "references" | "tags"> &
  Partial<Pick<Finding, "references" | "tags">>;

/**
 * Build a finding with a stable id.
 *
 * Analyzers should always go through this rather than assembling the id by
 * hand: the id has to be identical across runs and across hosts for dedup and
 * diffing to work, and that only holds if the evidence is serialised the same
 * way every time. Field order is fixed here, not taken from the caller's object
 * literal, because `JSON.stringify` preserves insertion order and two analyzers
 * writing the same evidence in a different order would otherwise disagree.
 */
export function createFinding(input: FindingInput): Finding {
  const canonicalEvidence = JSON.stringify(
    input.evidence.map((item) => [item.kind, item.value, item.location ?? null]),
  );

  return {
    ...input,
    id: `${input.analyzerId}:${input.ruleId}:${stableHash(canonicalEvidence)}`,
    references: input.references ?? [],
    tags: input.tags ?? [],
  };
}

/** Sort most severe first; ties keep a stable order by id. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity =
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    return bySeverity !== 0 ? bySeverity : a.id.localeCompare(b.id);
  });
}

/** Drop findings that share an id — the same observation seen twice. */
export function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const byId = new Map<string, Finding>();
  for (const finding of findings) {
    if (!byId.has(finding.id)) byId.set(finding.id, finding);
  }
  return [...byId.values()];
}
