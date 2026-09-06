import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AuditResult } from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFileStore } from "../capabilities/index.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "webaudit-store-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function auditResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    auditId: "abc123",
    url: "https://example.com/",
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_000_050,
    findings: [],
    ...overrides,
  };
}

describe("the file-backed AuditStore", () => {
  it("round-trips an audit", async () => {
    const store = createFileStore(root);
    const result = auditResult();

    await store.putAudit(result);

    expect(await store.getAudit(result.auditId)).toEqual(result);
  });

  it("returns undefined for an audit that was never written", async () => {
    expect(await createFileStore(root).getAudit("missing")).toBeUndefined();
  });

  it("returns an empty history before anything is stored", async () => {
    expect(await createFileStore(root).listAudits()).toEqual([]);
  });

  it("lists most recent first, without loading every finding", async () => {
    const store = createFileStore(root);
    await store.putAudit(auditResult({ auditId: "older", startedAt: 1 }));
    await store.putAudit(auditResult({ auditId: "newer", startedAt: 2 }));

    const summaries = await store.listAudits();

    expect(summaries.map((summary) => summary.auditId)).toEqual(["newer", "older"]);
    expect(summaries[0]).not.toHaveProperty("findings");
    expect(summaries[0]?.findingCount).toBe(0);
  });

  it("rejects a stored file that no longer matches the schema", async () => {
    const store = createFileStore(root);
    await store.putAudit(auditResult());
    // Something outside this process corrupted the file.
    await writeFile(
      join(root, "audits", "abc123.json"),
      '{"auditId":"abc123"}',
      "utf8",
    );

    await expect(store.getAudit("abc123")).rejects.toThrow();
  });
});
