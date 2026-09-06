import {
  createFinding,
  dedupeFindings,
  sortFindings,
  type Finding,
} from "../findings/schema.js";
import type { PageSnapshot } from "../snapshot/schema.js";
import type { Analyzer, AnalyzerContext, AnalyzerNeed } from "./types.js";

const RUNNER_ID = "runner";

/**
 * Run every analyzer whose needs are satisfied, in parallel, and return a
 * deduplicated list sorted most severe first (docs/03).
 *
 * Two things are deliberately reported rather than swallowed:
 *
 * - An analyzer skipped for a missing input emits an `info` finding naming what
 *   was missing. A check that did not run must not look like a check that
 *   passed — that is the same honesty the snapshot's `limitations` array exists
 *   for (docs/02).
 * - An analyzer that throws is caught, logged, and turned into an `info`
 *   finding. One bad analyzer should not lose the results of the other eight.
 */
export async function runAnalyzers(
  snapshot: PageSnapshot,
  ctx: AnalyzerContext,
  analyzers: readonly Analyzer[],
): Promise<Finding[]> {
  const results = await Promise.all(
    analyzers.map(async (analyzer) => {
      const missing = analyzer.needs.filter((need) => !isSatisfied(need, ctx));
      if (missing.length > 0) {
        return [skippedFinding(analyzer.id, missing)];
      }

      try {
        return await analyzer.run(snapshot, ctx);
      } catch (error) {
        ctx.logger.error(`analyzer ${analyzer.id} threw`, error);
        return [failedFinding(analyzer.id, error)];
      }
    }),
  );

  return sortFindings(dedupeFindings(results.flat()));
}

function isSatisfied(need: AnalyzerNeed, ctx: AnalyzerContext): boolean {
  switch (need) {
    case "headers":
      return ctx.headers !== undefined;
    case "trackerDb":
      return ctx.trackerDb !== undefined;
  }
}

function skippedFinding(analyzerId: string, missing: readonly AnalyzerNeed[]): Finding {
  const needs = missing.join(", ");
  return createFinding({
    analyzerId: RUNNER_ID,
    ruleId: "analyzer-skipped",
    severity: "info",
    confidence: "high",
    title: `Checks skipped: ${analyzerId}`,
    summary:
      `The ${analyzerId} analyzer did not run because it needs ${needs}, ` +
      `which this audit did not collect. Its checks are unknown, not passing.`,
    evidence: [{ kind: "other", value: needs, location: analyzerId }],
  });
}

function failedFinding(analyzerId: string, error: unknown): Finding {
  const message = error instanceof Error ? error.message : String(error);
  return createFinding({
    analyzerId: RUNNER_ID,
    ruleId: "analyzer-failed",
    severity: "info",
    confidence: "high",
    title: `Checks failed: ${analyzerId}`,
    summary:
      `The ${analyzerId} analyzer threw and produced no findings. Its checks ` +
      `are unknown, not passing.`,
    evidence: [{ kind: "other", value: message.slice(0, 1000), location: analyzerId }],
  });
}
