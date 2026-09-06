// Installs indexedDB, IDBRequest, IDBKeyRange and friends as globals. `idb`
// needs the whole family, not just the factory.
import "fake-indexeddb/auto";

import type { AuditResult } from "core";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createIdbStore, openWebAuditDb, type WebAuditDatabase } from "../store-idb.js";

let db: WebAuditDatabase;

beforeEach(async () => {
  // A fresh factory per test, so eviction and history caps are not shared.
  globalThis.indexedDB = new IDBFactory();
  db = await openWebAuditDb();
});

afterEach(() => {
  db.close();
});

function auditResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    auditId: "a1",
    url: "https://example.com/page",
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_000_050,
    findings: [],
    ...overrides,
  };
}

describe("the IndexedDB AuditStore", () => {
  it("round-trips an audit", async () => {
    const store = createIdbStore(db);
    const result = auditResult();

    await store.putAudit(result);

    expect(await store.getAudit("a1")).toEqual(result);
  });

  it("returns undefined for an audit that was never written", async () => {
    expect(await createIdbStore(db).getAudit("missing")).toBeUndefined();
  });

  it("lists history most recent first", async () => {
    const store = createIdbStore(db);
    await store.putAudit(auditResult({ auditId: "older", startedAt: 1 }));
    await store.putAudit(auditResult({ auditId: "newer", startedAt: 2 }));

    expect((await store.listAudits()).map((s) => s.auditId)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("summarises without carrying every finding", async () => {
    const store = createIdbStore(db);
    await store.putAudit(
      auditResult({
        findings: [
          {
            id: "transport:insecure-protocol:0000000000000000",
            analyzerId: "transport",
            ruleId: "insecure-protocol",
            severity: "high",
            confidence: "high",
            title: "Page served over HTTP",
            summary: "s",
            evidence: [{ kind: "other", value: "http://example.com/" }],
            references: [],
            tags: [],
          },
        ],
      }),
    );

    const [summary] = await store.listAudits();
    expect(summary?.findingCount).toBe(1);
    expect(summary).not.toHaveProperty("findings");
  });

  it("evicts the oldest audits once the cap is exceeded", async () => {
    const store = createIdbStore(db, { historyCap: 3 });
    for (let index = 0; index < 5; index += 1) {
      await store.putAudit(
        auditResult({ auditId: `a${String(index)}`, startedAt: index }),
      );
    }

    const kept = (await store.listAudits()).map((summary) => summary.auditId);
    expect(kept).toEqual(["a4", "a3", "a2"]);
    expect(await store.getAudit("a0")).toBeUndefined();
  });

  it("rejects a stored record that no longer matches the schema", async () => {
    const store = createIdbStore(db);
    await store.putAudit(auditResult());
    // Simulate a record written by an older version of the extension.
    await db.put("audits", {
      id: "a1",
      url: "https://example.com/page",
      host: "example.com",
      startedAt: 1,
      finishedAt: 2,
      result: { auditId: "a1" } as unknown as AuditResult,
    });

    await expect(store.getAudit("a1")).rejects.toThrow();
  });
});
