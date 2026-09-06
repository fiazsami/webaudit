import { z } from "zod";

/**
 * The tracker database, built by `pnpm build-tracker-db` from DuckDuckGo's
 * Tracker Data Set (docs/10).
 *
 * **CC BY-NC-SA 4.0 — non-commercial.** Downloaded at build time, never
 * vendored. The `licence` field is carried in the file so the constraint
 * travels with the data rather than living only in a document.
 */

export const TrackerEntrySchema = z.object({
  owner: z.string(),
  categories: z.array(z.string()).default([]),
  /** Share of sites in DuckDuckGo's crawl where this domain appears, 0–1. */
  prevalence: z.number().optional(),
  /** DuckDuckGo's fingerprinting score, 0–3. */
  fingerprinting: z.number().optional(),
});
export type TrackerEntry = z.infer<typeof TrackerEntrySchema>;

export const TrackerDatabaseFileSchema = z.object({
  licence: z.string(),
  source: z.string(),
  trackers: z.record(z.string(), TrackerEntrySchema),
});
export type TrackerDatabaseFile = z.infer<typeof TrackerDatabaseFileSchema>;
