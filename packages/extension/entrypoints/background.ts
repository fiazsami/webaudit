import { type CookieRef, type PageSnapshot, PageSnapshotSchema } from "core/snapshot";

import { getGrant, grantAudit, type SessionStore } from "../lib/audit-registry.js";
import { checkUrlAllowed } from "../lib/domain-policy.js";
import {
  envelope,
  errorReply,
  MessageError,
  newMessageId,
  parseRequest,
  replyEnvelope,
  type Reply,
  type Request,
} from "../lib/messaging.js";

/**
 * The only privileged context (docs/07).
 *
 * It holds `chrome.cookies`, the host permissions, and the cross-origin fetch —
 * and it holds nothing else. There is no analysis logic here, so there is
 * nothing for untrusted page content to steer. It wakes, does one privileged
 * thing, replies, and is allowed to die.
 */
export default defineBackground(() => {
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error("webaudit: could not set side panel behaviour", error);
    });

  browser.runtime.onMessage.addListener(
    (raw: unknown, sender, sendResponse: (response: unknown) => void) => {
      // Only extension pages of this extension may ask for privilege. A content
      // script — which runs in a page the audited site controls — must not be
      // able to drive the worker's fetch.
      if (sender.id !== browser.runtime.id || sender.tab !== undefined) {
        return false;
      }

      let id: string;
      let request: Request;
      try {
        ({ id, request } = parseRequest(raw));
      } catch (error) {
        sendResponse(errorReply(newMessageId(), error));
        return true;
      }

      void handle(request)
        .then((reply) => {
          sendResponse(replyEnvelope(id, reply));
        })
        .catch((error: unknown) => {
          sendResponse(errorReply(id, error));
        });

      // Keeps the channel open for the async reply.
      return true;
    },
  );
});

const sessionStore: SessionStore = {
  get: (key) => browser.storage.session.get(key),
  set: (items) => browser.storage.session.set(items),
  remove: (key) => browser.storage.session.remove(key),
};

async function handle(request: Request): Promise<Reply> {
  switch (request.type) {
    case "snapshot.capture":
      return captureSnapshot(request.payload.tabId, request.payload.auditId);
    case "http.fetch":
      return fetchForAudit(
        request.payload.url,
        request.payload.method,
        request.payload.auditId,
      );
    case "cookies.get":
      return { type: "cookies.list", payload: await readCookies(request.payload.url) };
    case "snapshot.build":
      // Background → content script only; the worker never receives it.
      throw new MessageError("invalid-message", "snapshot.build is not for the worker");
  }
}

/**
 * Ask the content script for a snapshot, then add what only this context can
 * see. The tab URL is read here rather than taken from the caller, because it
 * is also what the audit's fetch allowlist is derived from.
 */
async function captureSnapshot(tabId: number, auditId: string): Promise<Reply> {
  const tab = await browser.tabs.get(tabId);
  const pageUrl = tab.url;
  if (pageUrl === undefined || !/^https?:/.test(pageUrl)) {
    throw new MessageError("no-active-tab", "the active tab is not an auditable page");
  }

  await grantAudit(sessionStore, auditId, pageUrl, Date.now());
  await injectContentScript(tabId);

  const raw: unknown = await browser.tabs.sendMessage(
    tabId,
    envelope(newMessageId(), {
      type: "snapshot.build",
      payload: { url: pageUrl },
    }),
  );

  const built = extractSnapshot(raw);
  const cookies = await readCookies(pageUrl);

  return {
    type: "snapshot.ready",
    payload: withCookies(built, cookies),
  };
}

/**
 * The content script is not in the manifest (docs/08), so nothing of ours runs
 * in a page until an audit of that page is asked for. It is injected here, at
 * that moment. Injecting twice on a long-lived tab is harmless — the script
 * guards against registering its listener again.
 */
async function injectContentScript(tabId: number): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["/content-scripts/content.js"],
    });
  } catch (error) {
    throw new MessageError(
      "capture-failed",
      `could not run in this page: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function extractSnapshot(raw: unknown): PageSnapshot {
  const parsed = PageSnapshotSchema.safeParse(
    (raw as { payload?: unknown } | undefined)?.payload,
  );
  if (!parsed.success) {
    throw new MessageError("capture-failed", "the content script returned no snapshot");
  }
  return parsed.data;
}

/** Cookie flags are only visible here, so the limitation is cleared here too. */
function withCookies(
  snapshot: PageSnapshot,
  cookies: readonly CookieRef[],
): PageSnapshot {
  return {
    ...snapshot,
    cookies: [...cookies],
    limitations: snapshot.limitations.filter(
      (limitation) => limitation !== "no-cookie-flags",
    ),
  };
}

/**
 * The only network path in the system.
 *
 * The allowlist comes from this worker's own record of the audit, keyed by
 * `auditId` — never from the request. No grant means no fetch: an audit the
 * worker has no record of authorising is refused, including when the worker was
 * evicted and its session storage went with it. Failing closed is the only safe
 * direction (docs/12 T2).
 */
async function fetchForAudit(
  url: string,
  method: "GET" | "HEAD" | "POST",
  auditId: string,
): Promise<Reply> {
  const grant = await getGrant(sessionStore, auditId);
  if (grant === undefined) {
    throw new MessageError(
      "domain-not-allowed",
      "no active grant for this audit; re-capture the page",
    );
  }

  const verdict = checkUrlAllowed(url, grant.allowedDomains);
  if (!verdict.allowed) {
    throw new MessageError("domain-not-allowed", verdict.reason);
  }

  let response: Response;
  try {
    response = await fetch(url, { method, redirect: "follow", credentials: "omit" });
  } catch (error) {
    throw new MessageError(
      "fetch-failed",
      error instanceof Error ? error.message : String(error),
    );
  }

  // A redirect can leave the allowlist. Check where we actually landed.
  const landed = checkUrlAllowed(response.url, grant.allowedDomains);
  if (!landed.allowed) {
    throw new MessageError(
      "domain-not-allowed",
      `redirected off the allowlist: ${landed.reason}`,
    );
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });

  return {
    type: "http.response",
    payload: {
      url: response.url,
      status: response.status,
      headers,
      body: await response.text(),
    },
  };
}

async function readCookies(url: string): Promise<CookieRef[]> {
  const cookies = await browser.cookies.getAll({ url });
  return cookies.map((cookie) => ({
    name: cookie.name,
    domain: cookie.domain,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: mapSameSite(cookie.sameSite),
    session: cookie.session,
    ...(cookie.expirationDate === undefined ? {} : { expires: cookie.expirationDate }),
  }));
}

function mapSameSite(value: string | undefined): CookieRef["sameSite"] {
  switch (value) {
    case "strict":
      return "strict";
    case "lax":
      return "lax";
    case "no_restriction":
      return "none";
    default:
      return "unspecified";
  }
}
