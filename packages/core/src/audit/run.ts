import { analyzers as defaultAnalyzers } from "../analyzers/index.js";
import { runAnalyzers } from "../analyzers/run.js";
import type { LibraryDatabase } from "../analyzers/libraries/schema.js";
import type { Analyzer, AnalyzerContext, TrackerDatabase } from "../analyzers/types.js";
import type { Capabilities } from "../capabilities.js";
import { explainFindings } from "../explain/index.js";
import { stableHash } from "../hash.js";
import { PageSnapshotSchema, type PageSnapshot } from "../snapshot/schema.js";
import { type AuditResult } from "./schema.js";

/**
 * One audit (docs/01).
 *
 * As of M1 this runs the deterministic analyzers and stops. The agent loop that
 * decides what to investigate next is M6, so `noAgent` is not a flag that turns
 * something off — it is the only mode that exists, and asking for the other one
 * fails loudly rather than silently returning half an audit.
 */
export interface AuditOptions {
  capabilities: Capabilities;
  /** Must be true until M6. */
  noAgent?: boolean;
  /** Defaults to the registry. Tests and the CLI narrow it. */
  analyzers?: readonly Analyzer[];
  /** Response headers, if a host already fetched them (docs/06 `fetchHeaders`). */
  headers?: Record<string, string>;
  trackerDb?: TrackerDatabase;
  /** Built by `pnpm build-library-db` (docs/10). */
  libraryDb?: LibraryDatabase;
  /** Have the model write each finding's explanation (docs/03). */
  explain?: boolean;
  /** Cap how many findings are explained; each costs a model call. */
  explainLimit?: number;
}

export async function audit(
  snapshot: PageSnapshot,
  options: AuditOptions,
): Promise<AuditResult> {
  const { capabilities } = options;

  if (options.noAgent !== true) {
    throw new Error(
      "audit() currently supports noAgent: true only — the agent loop is M6 (docs/11).",
    );
  }

  // Hard rule 2: everything crossing into core is validated, including a
  // snapshot a host claims it built with our own builder.
  const validated = PageSnapshotSchema.parse(snapshot);

  const startedAt = capabilities.clock.now();
  const list = options.analyzers ?? defaultAnalyzers;

  capabilities.progress.emit({
    stage: "analyzers",
    total: list.length,
    message: `Running ${String(list.length)} analyzers`,
  });

  const ctx: AnalyzerContext = {
    logger: capabilities.logger,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.trackerDb === undefined ? {} : { trackerDb: options.trackerDb }),
    ...(options.libraryDb === undefined ? {} : { libraryDb: options.libraryDb }),
  };

  let findings = await runAnalyzers(validated, ctx, list);

  if (options.explain === true && findings.length > 0) {
    capabilities.progress.emit({
      stage: "explain",
      total: findings.length,
      message: `Explaining ${String(findings.length)} findings`,
    });
    findings = await explainFindings(findings, {
      provider: capabilities.provider,
      logger: capabilities.logger,
      ...(options.explainLimit === undefined ? {} : { limit: options.explainLimit }),
      onProgress: (done) => {
        capabilities.progress.emit({
          stage: "explain",
          current: done,
          total: findings.length,
        });
      },
    });
  }

  const finishedAt = capabilities.clock.now();

  capabilities.progress.emit({
    stage: "analyzers",
    current: list.length,
    total: list.length,
    message: `${String(findings.length)} findings`,
  });

  return {
    // Derived rather than random: core has no entropy source it is allowed to
    // reach for, and a derived id keeps a replayed run identical to the original.
    auditId: stableHash(`${validated.url}|${String(startedAt)}`),
    url: validated.url,
    startedAt,
    finishedAt,
    findings,
  };
}
