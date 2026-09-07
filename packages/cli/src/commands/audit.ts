import { readFile } from "node:fs/promises";

import {
  audit,
  PageSnapshotSchema,
  runTosPipeline,
  type AuditResult,
  type TosReport,
} from "core";

import { createNodeCapabilities } from "../capabilities/index.js";
import { loadHstsPreloadList } from "../hsts-preload.js";
import { loadLibraryDb } from "../library-db.js";
import { loadTrackerDb } from "../tracker-db.js";
import { loadReplayProvider } from "../replay.js";
import { formatReport, formatTosReport, formatTrace } from "../report.js";

export interface AuditCommandOptions {
  snapshotPath: string;
  /** Required until the agent loop exists (M6). */
  noAgent: boolean;
  json: boolean;
  verbose: boolean;
  /** Built by `pnpm build-hsts-preload`; absent is fine (docs/03). */
  hstsPreloadPath?: string;
  /** Built by `pnpm build-library-db`; absent skips the analyzer (docs/03). */
  libraryDbPath?: string;
  /** Built by `pnpm build-tracker-db`; absent skips the analyzer (docs/03). */
  trackerDbPath?: string;
  /** A recorded model session. The only way this host gets a model (docs/04). */
  replayPath?: string;
  /** Explain findings, which needs --replay in this host. */
  explain?: boolean;
  /** Run the ToS pipeline. Fetches the site's policy pages (docs/05). */
  terms?: boolean;
  outDir?: string;
  /** Skip writing the result to the store. */
  noStore: boolean;
}

/**
 * Run analyzers over a saved snapshot (docs/11 M1).
 *
 * Live inference is not available in this host — Node has no WebGPU — so
 * `--no-agent` is required rather than assumed. Making the caller say it keeps
 * the limitation visible instead of letting a partial audit look complete.
 */
export async function runAuditCommand(
  options: AuditCommandOptions,
): Promise<AuditResult> {
  if (!options.noAgent && options.replayPath === undefined) {
    throw new Error(
      "Running the agent loop needs --replay <recording.json>: this host has no " +
        "model (Node has no WebGPU). Use --no-agent for analyzers only.",
    );
  }

  const raw = await readFile(options.snapshotPath, "utf8");
  // A file on disk is untrusted input like any other (hard rule 2).
  const snapshot = PageSnapshotSchema.parse(JSON.parse(raw));

  const preloaded = await loadHstsPreloadList(
    options.hstsPreloadPath ?? "data/hsts-preload.json",
  );
  if (options.verbose) {
    process.stderr.write(
      preloaded === 0
        ? "no HSTS preload list; HSTS findings will carry a caveat\n"
        : `loaded ${String(preloaded)} preloaded hosts\n`,
    );
  }

  const provider =
    options.replayPath === undefined
      ? undefined
      : await loadReplayProvider(options.replayPath);

  if (options.explain === true && provider === undefined) {
    throw new Error(
      "--explain needs --replay <recording.json>: this host has no model (docs/01).",
    );
  }
  if (options.terms === true && provider === undefined) {
    throw new Error(
      "--terms needs --replay <recording.json>: this host has no model (docs/01).",
    );
  }

  const capabilities = createNodeCapabilities({
    verbose: options.verbose,
    ...(options.outDir === undefined ? {} : { outDir: options.outDir }),
    ...(provider === undefined ? {} : { provider }),
  });

  const libraryDb = await loadLibraryDb(
    options.libraryDbPath ?? "data/library-db.json",
  );

  const trackerDb = await loadTrackerDb(
    options.trackerDbPath ?? "data/tracker-db.json",
  );

  const result = await audit(snapshot, {
    capabilities,
    noAgent: options.noAgent,
    explain: options.explain === true,
    ...(libraryDb === undefined ? {} : { libraryDb }),
    ...(trackerDb === undefined ? {} : { trackerDb }),
  });

  if (!options.noStore) {
    await capabilities.store.putAudit(result);
  }

  let tosReport: TosReport | undefined;
  if (options.terms === true) {
    tosReport = await runTosPipeline(snapshot, { capabilities });
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(tosReport === undefined ? result : { ...result, tosReport }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(formatReport(result));
    const report = tosReport ?? result.tosReport;
    if (report !== undefined) process.stdout.write(formatTosReport(report));
    if (result.trace !== undefined) process.stdout.write(formatTrace(result.trace));
  }

  return result;
}
