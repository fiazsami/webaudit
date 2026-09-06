import { readFile } from "node:fs/promises";

import { audit, PageSnapshotSchema, type AuditResult } from "core";

import { createNodeCapabilities } from "../capabilities/index.js";
import { formatReport } from "../report.js";

export interface AuditCommandOptions {
  snapshotPath: string;
  /** Required until the agent loop exists (M6). */
  noAgent: boolean;
  json: boolean;
  verbose: boolean;
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

  const capabilities = createNodeCapabilities({
    verbose: options.verbose,
    ...(options.outDir === undefined ? {} : { outDir: options.outDir }),
  });

  const result = await audit(snapshot, { capabilities, noAgent: true });

  if (!options.noStore) {
    await capabilities.store.putAudit(result);
  }

  process.stdout.write(
    options.json ? `${JSON.stringify(result, null, 2)}\n` : formatReport(result),
  );

  return result;
}
