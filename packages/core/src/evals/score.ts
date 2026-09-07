import type { Clause } from "../tos/schema.js";
import { scoreAgainstLabels, type PolicyLabels } from "../tos/labels.js";
import { quoteAppearsIn } from "../tos/verify.js";
import type { EvalMetrics } from "./schema.js";

/**
 * Score one model's extraction of one policy (docs/05 evals).
 *
 * Everything here is deterministic and pure, so the scoring can be tested
 * without a GPU even though producing the input needs one.
 */

export interface ScoreInput {
  /** Clauses that survived verification and reached the report. */
  extracted: readonly Clause[];
  /** Clauses the model produced that verification dropped. */
  dropped: readonly Clause[];
  labels: PolicyLabels;
  /** The policy text, for checking quotes independently of the pipeline. */
  sourceText: string;
  chunks: number;
  /** Chunks whose response parsed and validated first time. */
  chunksValid: number;
  inputTokens: number;
  outputTokens: number;
  wallMs: number;
}

export function scoreExtraction(input: ScoreInput): {
  metrics: EvalMetrics;
  missed: Array<{ category: string; substring: string }>;
} {
  const labelled = scoreAgainstLabels(input.extracted, input.labels);

  const produced = input.extracted.length + input.dropped.length;
  // Re-checked here rather than trusted from the pipeline: an eval that assumes
  // the thing it is measuring is not measuring it.
  const verifying = input.extracted.filter((clause) =>
    quoteAppearsIn(clause.quote, input.sourceText),
  ).length;

  return {
    metrics: {
      recall: labelled.recall,
      quoteAccuracy: produced === 0 ? 1 : verifying / produced,
      schemaAdherence: input.chunks === 0 ? 1 : input.chunksValid / input.chunks,
      falseAlarms: labelled.falseAlarms.length,
      clausesExtracted: input.extracted.length,
      clausesDropped: input.dropped.length,
      chunks: input.chunks,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      wallMs: input.wallMs,
    },
    missed: labelled.missed.map((label) => ({
      category: label.category,
      substring: label.substring,
    })),
  };
}

/**
 * A single number for ranking models, and a deliberately blunt one.
 *
 * Recall is what the tool is for; quote accuracy is what makes a report
 * trustworthy; false alarms are what makes it ignorable. The weights are a
 * judgement and worth arguing with — which is why the components are all kept
 * in the results rather than collapsed into this.
 */
export function overallScore(metrics: EvalMetrics): number {
  const penalty = Math.min(metrics.falseAlarms * 0.05, 0.3);
  return Math.max(
    0,
    metrics.recall * 0.5 +
      metrics.quoteAccuracy * 0.3 +
      metrics.schemaAdherence * 0.2 -
      penalty,
  );
}
