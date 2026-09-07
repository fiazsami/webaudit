import { z } from "zod";

/**
 * The ToS pipeline's types (docs/05).
 *
 * A fixed clause schema is the whole design: it is what makes results
 * comparable across models, evaluable against labelled fixtures, and bounded in
 * what a page can smuggle into the UI. A free-text summary would be none of
 * those things.
 */

export const ClauseCategorySchema = z.enum([
  "data-collection", // what is collected
  "data-sharing", // third parties, affiliates, sale
  "data-retention",
  "user-content-licence", // rights the site takes over your content
  "arbitration", // mandatory arbitration, class-action waiver
  "termination", // account termination rights
  "auto-renewal", // subscriptions, cancellation friction
  "unilateral-changes", // "we may change these terms at any time"
  "liability", // limitation of liability, indemnification
  "jurisdiction",
  "age-restriction",
  "other-notable",
]);
export type ClauseCategory = z.infer<typeof ClauseCategorySchema>;

export const ConcernSchema = z.enum(["none", "low", "medium", "high"]);
export type Concern = z.infer<typeof ConcernSchema>;

export const ClauseSchema = z.object({
  category: ClauseCategorySchema,
  /** Verbatim from the source. Verified in the merge stage; unverified quotes are dropped. */
  quote: z.string().max(600),
  headingPath: z.string(),
  summary: z.string().max(300),
  concern: ConcernSchema,
  concernReason: z.string().max(300).optional(),
});
export type Clause = z.infer<typeof ClauseSchema>;

/** What one map call returns for one chunk. */
export const ClauseExtractionSchema = z.object({ clauses: z.array(ClauseSchema) });
export type ClauseExtraction = z.infer<typeof ClauseExtractionSchema>;

export const PolicySourceSchema = z.object({
  url: z.url(),
  fetchedAt: z.string(),
  contentHash: z.string(),
  /** Which policy this looked like, from the discovery heuristic. */
  hint: z.enum(["terms", "privacy", "cookies", "other"]).optional(),
});
export type PolicySource = z.infer<typeof PolicySourceSchema>;

/**
 * Why a report is less complete than it looks.
 *
 * Same discipline as `PageSnapshot.limitations` (docs/02): a pipeline that ran
 * out of budget halfway must not read like one that found nothing more.
 */
export const TosLimitationSchema = z.enum([
  "policy-truncated",
  "chunk-budget-exhausted",
  "no-policy-found",
  "fetch-failed",
  "extraction-failed",
  "no-model",
]);
export type TosLimitation = z.infer<typeof TosLimitationSchema>;

export const TosReportSchema = z.object({
  sources: z.array(PolicySourceSchema),
  clauses: z.array(ClauseSchema),
  topConcerns: z.array(ClauseSchema).max(5),
  overallSummary: z.string().max(1200),
  modelId: z.string(),
  limitations: z.array(TosLimitationSchema).default([]),
});
export type TosReport = z.infer<typeof TosReportSchema>;

/** A policy after extraction, before chunking. */
export const PolicyDocumentSchema = z.object({
  url: z.url(),
  title: z.string(),
  markdown: z.string(),
  contentHash: z.string(),
  fetchedAt: z.string(),
});
export type PolicyDocument = z.infer<typeof PolicyDocumentSchema>;

export const PolicyChunkSchema = z.object({
  index: z.number().int().nonnegative(),
  /** e.g. "3. Your Content > 3.2 Licence" — the model's only sense of place. */
  headingPath: z.string(),
  text: z.string(),
  approxTokens: z.number().int().nonnegative(),
});
export type PolicyChunk = z.infer<typeof PolicyChunkSchema>;
