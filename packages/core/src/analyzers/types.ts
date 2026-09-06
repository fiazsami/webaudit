import type { Finding } from "../findings/schema.js";
import type { Logger } from "../logger.js";
import type { PageSnapshot } from "../snapshot/schema.js";

/**
 * Analyzers are pure functions from a snapshot to findings (docs/03). They never
 * call a model, and they never see `http`, `store`, or the provider — the caller
 * derives this narrow context from `Capabilities` on their behalf.
 */

export interface TrackerDatabase {
  lookup(
    hostname: string,
  ): { owner: string; categories: string[]; prevalence?: number } | null;
}

/** External inputs an analyzer may declare a need for. */
export type AnalyzerNeed = "headers" | "trackerDb";

export interface AnalyzerContext {
  /** Response headers, lowercased keys. Populated by the fetchHeaders tool. */
  headers?: Record<string, string>;
  trackerDb?: TrackerDatabase;
  logger: Logger;
}

export interface Analyzer {
  id: string;
  /** The orchestrator skips this analyzer unless every need is satisfied. */
  needs: readonly AnalyzerNeed[];
  run(snapshot: PageSnapshot, ctx: AnalyzerContext): Promise<Finding[]>;
}
