import { z } from "zod";

import { FindingSchema } from "../findings/schema.js";

/**
 * The result of one audit (docs/01).
 *
 * `tosReport` (docs/05, M5) and `trace` (docs/06, M6) join this schema when the
 * pipelines that produce them exist. Adding them as `unknown` now would let
 * unvalidated data cross a boundary, which hard rule 2 forbids.
 */
export const AuditResultSchema = z.object({
  auditId: z.string(),
  url: z.url(),
  /** Milliseconds since the epoch, from `capabilities.clock`. */
  startedAt: z.number(),
  finishedAt: z.number(),
  findings: z.array(FindingSchema),
});
export type AuditResult = z.infer<typeof AuditResultSchema>;

/** Enough to render a history list without loading every finding (docs/09). */
export const AuditSummarySchema = AuditResultSchema.omit({
  findings: true,
}).extend({
  findingCount: z.number().int().nonnegative(),
});
export type AuditSummary = z.infer<typeof AuditSummarySchema>;
