import { z } from "zod";

/**
 * The vulnerable-library database, built from retire.js data by
 * `pnpm build-library-db` (docs/10).
 *
 * Validated on the way in like anything else crossing a boundary (hard rule 2):
 * it is a file downloaded from the internet, and the analyzer compiles regular
 * expressions out of it.
 */

export const LibraryVulnerabilitySchema = z.object({
  /** Affected below this version. */
  below: z.string().optional(),
  /** Affected at or above this version. */
  atOrAbove: z.string().optional(),
  severity: z.string(),
  summary: z.string().optional(),
  cve: z.array(z.string()).default([]),
  info: z.array(z.string()).default([]),
});
export type LibraryVulnerability = z.infer<typeof LibraryVulnerabilitySchema>;

export const LibraryEntrySchema = z.object({
  /** retire.js `uri` and `filename` extractors, with a §§version§§ placeholder. */
  patterns: z.array(z.string()),
  vulnerabilities: z.array(LibraryVulnerabilitySchema),
});
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;

export const LibraryDatabaseSchema = z.object({
  libraries: z.record(z.string(), LibraryEntrySchema),
});
export type LibraryDatabase = z.infer<typeof LibraryDatabaseSchema>;
