import { z } from "zod";

/**
 * Eval results (docs/05, docs/11 M7).
 *
 * The project's central research output. With only local models available,
 * choosing the model is the only lever left, so these numbers are what the
 * choice rests on — and they are committed so a comparison is part of the
 * repository's history rather than something someone once saw on a laptop.
 */

export const EvalMetricsSchema = z.object({
  /** Labelled clauses the model found, as a fraction. */
  recall: z.number().min(0).max(1),
  /**
   * Extracted quotes that verify against the source, as a fraction.
   *
   * Not precision against the labels: an unlabelled clause may be a real find
   * the fixture's author missed. What is unambiguously wrong is a quote that is
   * not in the document, so that is what this measures.
   */
  quoteAccuracy: z.number().min(0).max(1),
  /** Model responses that parsed and validated first time, as a fraction. */
  schemaAdherence: z.number().min(0).max(1),
  /** Clauses flagged concerning that the fixture says should not be. */
  falseAlarms: z.number().int().nonnegative(),
  clausesExtracted: z.number().int().nonnegative(),
  clausesDropped: z.number().int().nonnegative(),
  chunks: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  wallMs: z.number().nonnegative(),
});
export type EvalMetrics = z.infer<typeof EvalMetricsSchema>;

export const EvalFixtureResultSchema = z.object({
  fixture: z.string(),
  metrics: EvalMetricsSchema,
  /** Labels the model missed, so a bad score is diagnosable rather than a number. */
  missed: z.array(z.object({ category: z.string(), substring: z.string() })),
  error: z.string().optional(),
});
export type EvalFixtureResult = z.infer<typeof EvalFixtureResultSchema>;

export const EvalModelResultSchema = z.object({
  modelId: z.string(),
  loadMs: z.number().nonnegative(),
  fixtures: z.array(EvalFixtureResultSchema),
});
export type EvalModelResult = z.infer<typeof EvalModelResultSchema>;

export const EvalRunSchema = z.object({
  /** Hardware and browser, because none of these numbers travel without it. */
  environment: z.string(),
  startedAt: z.string(),
  models: z.array(EvalModelResultSchema),
});
export type EvalRun = z.infer<typeof EvalRunSchema>;
