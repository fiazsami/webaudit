import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  AuditResultSchema,
  ClauseSchema,
  type AuditResult,
  type AuditStore,
  type AuditSummary,
  type CachedExtraction,
  type PolicyCacheKey,
} from "core";
import { z } from "zod";

const CachedExtractionSchema = z.object({
  contentHash: z.string(),
  modelId: z.string(),
  url: z.string(),
  clauses: z.array(ClauseSchema),
  createdAt: z.number(),
});

/**
 * The Node host's storage capability (docs/01): one JSON file per audit under
 * `./out/audits/`, where the extension uses IndexedDB. Both satisfy the same
 * interface, which is the point.
 */
export function createFileStore(root: string): AuditStore {
  const dir = join(root, "audits");
  const policyDir = join(root, "policies");

  /** Content hash and model together: the same text read by a different model
   * is a different result (docs/09). */
  const cacheFile = (key: PolicyCacheKey): string =>
    join(policyDir, `${key.contentHash}-${key.modelId.replace(/[^\w.-]/g, "_")}.json`);

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

    async getCachedExtraction(
      key: PolicyCacheKey,
    ): Promise<CachedExtraction | undefined> {
      try {
        const raw = await readFile(cacheFile(key), "utf8");
        return CachedExtractionSchema.parse(JSON.parse(raw));
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        // A cache entry we cannot parse is one from an older build. Treat it as
        // absent rather than failing the run.
        return undefined;
      }
    },

    async putCachedExtraction(entry: CachedExtraction): Promise<void> {
      await mkdir(policyDir, { recursive: true });
      await writeFile(cacheFile(entry), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
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
