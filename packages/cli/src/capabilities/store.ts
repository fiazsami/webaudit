import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  AuditResultSchema,
  type AuditResult,
  type AuditStore,
  type AuditSummary,
} from "core";

/**
 * The Node host's storage capability (docs/01): one JSON file per audit under
 * `./out/audits/`, where the extension uses IndexedDB. Both satisfy the same
 * interface, which is the point.
 */
export function createFileStore(root: string): AuditStore {
  const dir = join(root, "audits");

  return {
    async putAudit(result: AuditResult): Promise<void> {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, `${result.auditId}.json`),
        `${JSON.stringify(result, null, 2)}\n`,
        "utf8",
      );
    },

    async getAudit(auditId: string): Promise<AuditResult | undefined> {
      try {
        const raw = await readFile(join(dir, `${auditId}.json`), "utf8");
        // Hard rule 2: what came off disk is untrusted until it parses.
        return AuditResultSchema.parse(JSON.parse(raw));
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        throw error;
      }
    },

    async listAudits(): Promise<AuditSummary[]> {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        if (isMissingFile(error)) return [];
        throw error;
      }

      const summaries: AuditSummary[] = [];
      for (const name of names.filter((file) => file.endsWith(".json"))) {
        const raw = await readFile(join(dir, name), "utf8");
        const { findings, ...rest } = AuditResultSchema.parse(JSON.parse(raw));
        summaries.push({ ...rest, findingCount: findings.length });
      }

      return summaries.sort((a, b) => b.startedAt - a.startedAt);
    },
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
