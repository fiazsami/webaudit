import { buildSnapshot, type Limitation, type PageSnapshot } from "core/snapshot";

import { BuildSnapshotRequestSchema, replyEnvelope } from "../lib/messaging.js";
import { sha256Base64 } from "../lib/sha256.js";

/**
 * Builds a `PageSnapshot` on request, using core's pure builder — the same
 * function the CLI's fixtures come from, so what ships and what is tested
 * cannot drift (docs/08).
 *
 * It runs only when asked. There is no capture on page load.
 *
 * Cookie flags are not added here: `document.cookie` cannot see them, and the
 * content script has no `chrome.cookies`. The background worker fills them in,
 * and until it does the snapshot honestly carries `no-cookie-flags`.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  // Injected by the background worker when an audit starts, not declared in the
  // manifest (docs/08). The extension holds <all_urls>, but holding a permission
  // and exercising it on every page load are different things: nothing runs in a
  // page until the user asks for an audit of it.
  registration: "runtime",

  main() {
    // executeScript can land more than once on a long-lived tab.
    const marker = "__webauditContentScriptReady";
    const flags = globalThis as unknown as Record<string, boolean | undefined>;
    if (flags[marker] === true) return;
    flags[marker] = true;

    browser.runtime.onMessage.addListener(
      (raw: unknown, _sender, sendResponse: (response: unknown) => void) => {
        const parsed = BuildSnapshotRequestSchema.safeParse(raw);
        if (!parsed.success) return false;

        void capture()
          .then((snapshot) => {
            sendResponse(
              replyEnvelope("snapshot.build", {
                type: "snapshot.ready",
                payload: snapshot,
              }),
            );
          })
          .catch((error: unknown) => {
            sendResponse(
              replyEnvelope("snapshot.build", {
                type: "error",
                payload: {
                  code: "capture-failed",
                  message: error instanceof Error ? error.message : String(error),
                },
              }),
            );
          });

        // Keeps the message channel open for the async reply.
        return true;
      },
    );
  },
});

async function capture(): Promise<PageSnapshot> {
  const limitations: Limitation[] = [];

  // Hashing is best-effort: a page with enormous inline scripts should produce a
  // snapshot with a recorded gap, not no snapshot at all (docs/08).
  let hashInlineScript: ((source: string) => Promise<string>) | undefined =
    sha256Base64;
  try {
    await sha256Base64("");
  } catch {
    hashInlineScript = undefined;
    limitations.push("csp-blocked-inline-collection");
  }

  return buildSnapshot(document, {
    url: location.href,
    capturedAt: new Date().toISOString(),
    limitations,
    ...(hashInlineScript === undefined ? {} : { hashInlineScript }),
  });
}
