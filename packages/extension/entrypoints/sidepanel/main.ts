import { audit, PageSnapshotSchema, type Capabilities, type PageSnapshot } from "core";

import { createExtensionCapabilities } from "../../lib/capabilities.js";
import { loadAnalyzerDatabases } from "../../lib/databases.js";
import {
  envelope,
  MessageError,
  newMessageId,
  parseReply,
  SnapshotReplySchema,
} from "../../lib/messaging.js";
import { createIdbStore, openWebAuditDb } from "../../lib/store-idb.js";
import { renderFindings } from "./render.js";

/**
 * The side panel is the compute host (docs/01, docs/08): it assembles
 * `Capabilities`, runs `core.audit()`, writes the result, and renders it. It
 * holds no privilege of its own — every privileged operation is a message to
 * the background worker.
 *
 * The cost of hosting the run here is honest: close the panel mid-audit and the
 * run dies. That is acceptable while audits are user-initiated. Auto-audit needs
 * an offscreen document, which is M8.
 */

const auditButton = requireElement<HTMLButtonElement>("audit");
const statusLine = requireElement<HTMLParagraphElement>("status");
const siteUrl = requireElement<HTMLParagraphElement>("site-url");
const findingsEl = requireElement<HTMLElement>("findings");
const rawJson = requireElement<HTMLPreElement>("raw-json");

let running = false;

void showActiveTab();

auditButton.addEventListener("click", () => {
  if (running) return;
  void runAudit();
});

async function showActiveTab(): Promise<void> {
  const tab = await activeTab();
  siteUrl.textContent = tab?.url ?? "No auditable page in this tab";
}

async function runAudit(): Promise<void> {
  running = true;
  auditButton.disabled = true;
  findingsEl.replaceChildren();
  setStatus("Capturing the page…");

  try {
    const tab = await activeTab();
    if (tab?.id === undefined) {
      throw new MessageError("no-active-tab", "no auditable page in this tab");
    }
    siteUrl.textContent = tab.url ?? "";

    const auditId = newMessageId();
    const snapshot = await captureSnapshot(tab.id, auditId);
    rawJson.textContent = JSON.stringify(snapshot, null, 2);

    const store = createIdbStore(await openWebAuditDb());
    const capabilities = createExtensionCapabilities({
      auditId,
      store,
      onProgress: (event) => {
        if (event.message !== undefined) setStatus(event.message);
      },
    });

    setStatus("Fetching response headers…");
    const headers = await fetchHeaders(capabilities, snapshot.url);

    setStatus("Running analyzers…");
    const databases = await loadAnalyzerDatabases();
    const result = await audit(snapshot, {
      capabilities,
      noAgent: true,
      ...databases,
      ...(headers === undefined ? {} : { headers }),
    });
    await store.putAudit(result);

    findingsEl.append(renderFindings(result.findings));
    setStatus(
      `${String(result.findings.length)} findings in ${String(
        result.finishedAt - result.startedAt,
      )}ms`,
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    running = false;
    auditButton.disabled = false;
  }
}

/**
 * The worker reads the tab URL itself and derives this audit's fetch allowlist
 * from it, so this is also where the audit becomes authorised (docs/12 T2).
 */
async function captureSnapshot(tabId: number, auditId: string): Promise<PageSnapshot> {
  const raw: unknown = await browser.runtime.sendMessage(
    envelope(newMessageId(), {
      type: "snapshot.capture",
      payload: { tabId, auditId },
    }),
  );

  const { reply } = parseReply(raw);
  if (reply.type === "error") {
    throw new MessageError(reply.payload.code, reply.payload.message);
  }

  const parsed = SnapshotReplySchema.safeParse(reply);
  if (!parsed.success) {
    throw new MessageError("capture-failed", "the worker returned no snapshot");
  }
  // Validated again on arrival: it crossed a boundary (hard rule 2).
  return PageSnapshotSchema.parse(parsed.data.payload);
}

/**
 * Refetch the page for its response headers.
 *
 * A content script cannot see main-document response headers (docs/02), so the
 * background worker fetches the URL again with host permissions, which bypasses
 * CORS and exposes the full set. This is the only reason the `headers` and `csp`
 * analyzers can run in the extension and not in the CLI.
 *
 * A failure here is not a failed audit. The analyzers that need headers are
 * skipped with an explicit finding, which is the honest outcome — better than
 * losing the deterministic findings that do not need them.
 */
async function fetchHeaders(
  capabilities: Capabilities,
  url: string,
): Promise<Record<string, string> | undefined> {
  try {
    const response = await capabilities.http.fetch(url, { method: "GET" });
    return response.headers;
  } catch (error) {
    capabilities.logger.warn("could not refetch the page for headers", error);
    return undefined;
  }
}

async function activeTab(): Promise<
  { id: number | undefined; url: string | undefined } | undefined
> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab === undefined ? undefined : { id: tab.id, url: tab.url };
}

function setStatus(message: string, kind: "info" | "error" = "info"): void {
  statusLine.textContent = message;
  statusLine.dataset["kind"] = kind;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`side panel is missing #${id}`);
  return element as T;
}
