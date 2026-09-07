import { z } from "zod";

import { AuditTraceSchema } from "../agent/trace.js";
import { FindingSchema } from "../findings/schema.js";
import { TosReportSchema } from "../tos/schema.js";

/**
 * The result of one audit (docs/01).
 *
 * `tosReport` and `trace` are optional because a run may legitimately not
 * produce them: an analyzers-only audit has no trace, and a page with no policy
 * has no report. They are schemas rather than `unknown`, so nothing crosses this
 * boundary unvalidated (hard rule 2).
 */
export const AuditResultSchema = z.object({
  auditId: z.string(),
  url: z.url(),
  /** Milliseconds since the epoch, from `capabilities.clock`. */
  startedAt: z.number(),
  finishedAt: z.number(),
  findings: z.array(FindingSchema),
  /** From the ToS pipeline (docs/05). */
  tosReport: TosReportSchema.optional(),
  /** From the agent loop (docs/06). The main research payoff (docs/09). */
  trace: AuditTraceSchema.optional(),
  /** The model's closing summary, when the loop ran. */
  summary: z.string().optional(),
});
export type AuditResult = z.infer<typeof AuditResultSchema>;

/** Enough to render a history list without loading every finding (docs/09). */
export const AuditSummarySchema = AuditResultSchema.omit({
  findings: true,
  tosReport: true,
  trace: true,
}).extend({
  findingCount: z.number().int().nonnegative(),
});
export type AuditSummary = z.infer<typeof AuditSummarySchema>;
