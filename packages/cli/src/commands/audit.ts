import { readFile } from "node:fs/promises";

import { audit, PageSnapshotSchema, type AuditResult } from "core";

import { createNodeCapabilities } from "../capabilities/index.js";
import { loadHstsPreloadList } from "../hsts-preload.js";
import { loadLibraryDb } from "../library-db.js";
import { loadTrackerDb } from "../tracker-db.js";
import { formatReport } from "../report.js";

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
  if (!options.noAgent) {
    throw new Error(
      "--no-agent is required: this host cannot run a model (Node has no WebGPU). " +
        "The agent loop arrives in M6; see docs/11.",
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

  const capabilities = createNodeCapabilities({
    verbose: options.verbose,
    ...(options.outDir === undefined ? {} : { outDir: options.outDir }),
  });

  const libraryDb = await loadLibraryDb(
    options.libraryDbPath ?? "data/library-db.json",
  );

  const trackerDb = await loadTrackerDb(
    options.trackerDbPath ?? "data/tracker-db.json",
  );

  const result = await audit(snapshot, {
    capabilities,
    noAgent: true,
    ...(libraryDb === undefined ? {} : { libraryDb }),
    ...(trackerDb === undefined ? {} : { trackerDb }),
  });

  if (!options.noStore) {
    await capabilities.store.putAudit(result);
  }

  process.stdout.write(
    options.json ? `${JSON.stringify(result, null, 2)}\n` : formatReport(result),
  );

  return result;
}
