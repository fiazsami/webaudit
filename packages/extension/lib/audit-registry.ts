import { z } from "zod";

import { allowlistForPage } from "./domain-policy.js";

/**
 * What the background worker believes about an audit in progress.
 *
 * This lives in the worker's own storage, derived from the tab URL the worker
 * itself read — never from a claim in a later message. That is the whole point
 * of docs/12 T2: the side panel asking "may I fetch this?" must not be the same
 * thing as the side panel deciding it may.
 *
 * `chrome.storage.session` rather than a module-level Map, because an MV3
 * service worker is allowed to die between two messages of the same audit
 * (docs/07). Session storage is in-memory and never reaches disk.
 */

const KEY_PREFIX = "audit:";

export const AuditGrantSchema = z.object({
  auditId: z.string(),
  pageUrl: z.url(),
  allowedDomains: z.array(z.string()),
  grantedAt: z.number(),
});
export type AuditGrant = z.infer<typeof AuditGrantSchema>;

export interface SessionStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Record what this audit may reach, derived from the page the worker actually
 * captured. Returns the grant so a caller can see the allowlist it was given
 * rather than the one it asked for.
 */
export async function grantAudit(
  store: SessionStore,
  auditId: string,
  pageUrl: string,
  now: number,
): Promise<AuditGrant> {
  // Validated at grant time rather than left to fail on read-back: an
  // unparseable page URL would store a grant that can never be parsed again,
  // which fails closed but silently, and a silent failure is a bad way to learn
  // the worker read the wrong tab.
  const grant = AuditGrantSchema.parse({
    auditId,
    pageUrl,
    allowedDomains: allowlistForPage(pageUrl),
    grantedAt: now,
  });
  await store.set({ [KEY_PREFIX + auditId]: grant });
  return grant;
}

/**
 * Look up a grant. A missing grant means the worker has no record that this
 * audit was ever authorised — because it was never captured, or because the
 * worker was evicted and session storage went with it. Either way the answer is
 * no. Failing closed is the only safe direction here.
 */
export async function getGrant(
  store: SessionStore,
  auditId: string,
): Promise<AuditGrant | undefined> {
  const key = KEY_PREFIX + auditId;
  const items = await store.get(key);
  const parsed = AuditGrantSchema.safeParse(items[key]);
  return parsed.success ? parsed.data : undefined;
}

export async function revokeAudit(store: SessionStore, auditId: string): Promise<void> {
  await store.remove(KEY_PREFIX + auditId);
}
