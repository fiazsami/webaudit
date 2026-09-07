import type { z } from "zod";

import type { TrackerDatabase } from "../analyzers/types.js";
import type { LibraryDatabase } from "../analyzers/libraries/schema.js";
import type { Capabilities } from "../capabilities.js";
import type { Finding } from "../findings/schema.js";
import type { PageSnapshot } from "../snapshot/schema.js";
import type { TosReport } from "../tos/schema.js";
import type { BudgetTracker } from "./budget.js";

/**
 * What a tool can reach (docs/06).
 *
 * Mutable state the loop accumulates lives here rather than being threaded
 * through return values, because several tools contribute to the same result:
 * `fetchHeaders` enables analyzers that `runAnalyzers` then runs.
 */
export interface ToolContext {
  snapshot: PageSnapshot;
  budget: BudgetTracker;
  caps: Capabilities;

  /** Filled by `fetchHeaders`, consumed by the header and CSP analyzers. */
  headers?: Record<string, string>;
  trackerDb?: TrackerDatabase;
  libraryDb?: LibraryDatabase;

  /** Everything found so far. Tools add to it; the loop reads it at the end. */
  findings: Finding[];
  tosReport?: TosReport;
  signal?: AbortSignal;
}

/**
 * A tool the model may call.
 *
 * `description` is shown to the model, so it is part of the prompt and worth
 * writing as carefully as one.
 */
export interface Tool<I extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: I;
  /**
   * Returns the summary handed back to the model — never the full result.
   * Findings become `id | severity | title`; the full objects live in the
   * context and the store (docs/06).
   */
  run(input: z.infer<I>, ctx: ToolContext): Promise<string>;
  /** Network tools consume the fetch budget. */
  sideEffects: "none" | "network";
}
