import { z } from "zod";

import { ClauseCategorySchema, ConcernSchema, type Clause } from "./schema.js";

/**
 * Labelled expectations for a policy fixture (docs/05 evals).
 *
 * A label records a **substring**, not a full quote: the question is whether a
 * model found the right clause, not whether it chose the same sentence
 * boundaries. Two models can both be right and quote different amounts.
 */
export const PolicyLabelSchema = z.object({
  category: ClauseCategorySchema,
  /** Distinctive enough to identify the clause, short enough to survive wrapping. */
  substring: z.string(),
  /** The least concern a correct extraction should assign. */
  minConcern: ConcernSchema,
});
export type PolicyLabel = z.infer<typeof PolicyLabelSchema>;

export const PolicyLabelsSchema = z.object({
  site: z.string(),
  note: z.string().optional(),
  expected: z.array(PolicyLabelSchema),
  /**
   * Text that must *not* be reported as concerning. A model that flags
   * everything is as useless as one that flags nothing, and recall alone would
   * reward it.
   */
  shouldNotConcern: z.array(z.string()).default([]),
});
export type PolicyLabels = z.infer<typeof PolicyLabelsSchema>;

const CONCERN_RANK = { none: 0, low: 1, medium: 2, high: 3 } as const;

export interface LabelScore {
  /** Labels matched by at least one extracted clause. */
  found: PolicyLabel[];
  missed: PolicyLabel[];
  /** Extracted clauses matching nothing labelled — not necessarily wrong. */
  unlabelled: Clause[];
  /** Clauses flagged as concerning that the fixture says should not be. */
  falseAlarms: Clause[];
  recall: number;
}

/** Score an extraction against a fixture's labels. */
export function scoreAgainstLabels(
  clauses: readonly Clause[],
  labels: PolicyLabels,
): LabelScore {
  const normalize = (text: string): string =>
    text.replace(/\s+/g, " ").trim().toLowerCase();

  const found: PolicyLabel[] = [];
  const missed: PolicyLabel[] = [];
  const matched = new Set<Clause>();

  for (const label of labels.expected) {
    const needle = normalize(label.substring);
    const hit = clauses.find(
      (clause) =>
        clause.category === label.category &&
        normalize(clause.quote).includes(needle) &&
        CONCERN_RANK[clause.concern] >= CONCERN_RANK[label.minConcern],
    );

    if (hit === undefined) missed.push(label);
    else {
      found.push(label);
      matched.add(hit);
    }
  }

  const falseAlarms = clauses.filter(
    (clause) =>
      CONCERN_RANK[clause.concern] >= CONCERN_RANK.medium &&
      labels.shouldNotConcern.some((text) =>
        normalize(clause.quote).includes(normalize(text)),
      ),
  );

  return {
    found,
    missed,
    unlabelled: clauses.filter((clause) => !matched.has(clause)),
    falseAlarms,
    recall: labels.expected.length === 0 ? 1 : found.length / labels.expected.length,
  };
}
