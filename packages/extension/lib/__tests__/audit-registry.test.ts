import { describe, expect, it } from "vitest";

import {
  getGrant,
  grantAudit,
  revokeAudit,
  type SessionStore,
} from "../audit-registry.js";

function memoryStore(): SessionStore {
  const items = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(items.has(key) ? { [key]: items.get(key) } : {}),
    set: (entries) => {
      for (const [key, value] of Object.entries(entries)) items.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      items.delete(key);
      return Promise.resolve();
    },
  };
}

describe("the audit grant registry", () => {
  it("derives the allowlist from the page, not from a caller", async () => {
    const store = memoryStore();
    const grant = await grantAudit(store, "a1", "https://shop.example.com/cart", 1);

    expect(grant.allowedDomains).toEqual(["shop.example.com"]);
  });

  it("round-trips a grant", async () => {
    const store = memoryStore();
    await grantAudit(store, "a1", "https://example.com/", 1);

    expect((await getGrant(store, "a1"))?.allowedDomains).toEqual(["example.com"]);
  });

  it("returns nothing for an audit that was never granted", async () => {
    expect(await getGrant(memoryStore(), "never")).toBeUndefined();
  });

  it("returns nothing after the session store is lost, so fetches fail closed", async () => {
    const store = memoryStore();
    await grantAudit(store, "a1", "https://example.com/", 1);
    await revokeAudit(store, "a1");

    expect(await getGrant(store, "a1")).toBeUndefined();
  });

  it("refuses a stored grant that does not match the schema", async () => {
    const store = memoryStore();
    await store.set({ "audit:a1": { auditId: "a1", allowedDomains: "everything" } });

    expect(await getGrant(store, "a1")).toBeUndefined();
  });

  it("refuses to grant on a page URL it cannot parse", async () => {
    const store = memoryStore();
    await expect(grantAudit(store, "a1", "not a url", 1)).rejects.toThrow();
    expect(await getGrant(store, "a1")).toBeUndefined();
  });
});
