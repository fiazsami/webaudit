import {
  AuditResultSchema,
  ClauseSchema,
  type AuditResult,
  type AuditStore,
  type AuditSummary,
  type CachedExtraction,
  type PolicyCacheKey,
} from "core";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { z } from "zod";

/**
 * `AuditStore` over IndexedDB (docs/09).
 *
 * One database, shared by every extension context — the side panel writes, the
 * workbench reads. The record keeps the snapshot alongside the result so a past
 * audit can be re-run or diffed without recapturing the page.
 */

const DB_NAME = "webaudit";
const DB_VERSION = 2;
const AUDITS = "audits";
const POLICY_CACHE = "policyCache";

const CachedExtractionSchema = z.object({
  contentHash: z.string(),
  modelId: z.string(),
  url: z.string(),
  clauses: z.array(ClauseSchema),
  createdAt: z.number(),
});

/** IndexedDB has no size guarantee, so history is capped (docs/09). */
export const DEFAULT_HISTORY_CAP = 200;

interface AuditRecord {
  id: string;
  url: string;
  /** Indexed, so history can be listed per site. */
  host: string;
  startedAt: number;
  finishedAt: number;
  result: AuditResult;
}

interface WebAuditDb extends DBSchema {
  [AUDITS]: {
    key: string;
    value: AuditRecord;
    indexes: { "by-host": [string, number]; "by-started": number };
  };
  /** Keyed by content hash and model: the same text read by a different model
   * is a different result (docs/09). */
  [POLICY_CACHE]: {
    key: [string, string];
    value: CachedExtraction;
  };
}

export type WebAuditDatabase = IDBPDatabase<WebAuditDb>;

export function openWebAuditDb(): Promise<WebAuditDatabase> {
  return openDB<WebAuditDb>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const audits = db.createObjectStore(AUDITS, { keyPath: "id" });
        audits.createIndex("by-host", ["host", "startedAt"]);
        audits.createIndex("by-started", "startedAt");
      }
      if (oldVersion < 2) {
        db.createObjectStore(POLICY_CACHE, { keyPath: ["contentHash", "modelId"] });
      }
    },
  });
}

export interface IdbStoreOptions {
  historyCap?: number;
}

export function createIdbStore(
  db: WebAuditDatabase,
  options: IdbStoreOptions = {},
): AuditStore {
  const historyCap = options.historyCap ?? DEFAULT_HISTORY_CAP;

  return {
    async putAudit(result: AuditResult): Promise<void> {
      await db.put(AUDITS, {
        id: result.auditId,
        url: result.url,
        host: hostOf(result.url),
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        result,
      });
      await evictOldest(db, historyCap);
    },

    async getAudit(auditId: string): Promise<AuditResult | undefined> {
      const record = await db.get(AUDITS, auditId);
      if (record === undefined) return undefined;
      // What came out of storage is untrusted until it parses: a past version of
      // this extension may have written a shape this one no longer accepts.
      return AuditResultSchema.parse(record.result);
    },

    async listAudits(): Promise<AuditSummary[]> {
      const records = await db.getAllFromIndex(AUDITS, "by-started");
      return records.reverse().map((record) => ({
        auditId: record.id,
        url: record.url,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        findingCount: record.result.findings.length,
      }));
    },

    async getCachedExtraction(
      key: PolicyCacheKey,
    ): Promise<CachedExtraction | undefined> {
      const record = await db.get(POLICY_CACHE, [key.contentHash, key.modelId]);
      if (record === undefined) return undefined;
      const parsed = CachedExtractionSchema.safeParse(record);
      // An entry written by an older build counts as absent, not as an error.
      return parsed.success ? parsed.data : undefined;
    },

    async putCachedExtraction(entry: CachedExtraction): Promise<void> {
      await db.put(POLICY_CACHE, entry);
    },
  };
}

/** Oldest-first, so the cap bites on stale history rather than the current run. */
async function evictOldest(db: WebAuditDatabase, cap: number): Promise<void> {
  const keys = await db.getAllKeysFromIndex(AUDITS, "by-started");
  const excess = keys.length - cap;
  if (excess <= 0) return;

  const tx = db.transaction(AUDITS, "readwrite");
  await Promise.all([
    ...keys.slice(0, excess).map((key) => tx.store.delete(key)),
    tx.done,
  ]);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
