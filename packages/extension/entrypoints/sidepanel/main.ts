import {
  audit,
  explainFindings,
  PageSnapshotSchema,
  type AuditResult,
  type Capabilities,
  type PageSnapshot,
} from "core";

import { createExtensionCapabilities } from "../../lib/capabilities.js";
import { loadAnalyzerDatabases } from "../../lib/databases.js";
import {
  envelope,
  MessageError,
  newMessageId,
  parseReply,
  SnapshotReplySchema,
} from "../../lib/messaging.js";
import { DEFAULT_MODEL_ID, findModel, MODEL_CHOICES } from "../../lib/models.js";
import { createIdbStore, openWebAuditDb } from "../../lib/store-idb.js";
import {
  createWebLlmProvider,
  type WebLlmProvider,
} from "../../lib/webllm-provider.js";
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
const engineLine = requireElement<HTMLParagraphElement>("engine");
const modelSelect = requireElement<HTMLSelectElement>("model");
const modelNote = requireElement<HTMLParagraphElement>("model-note");
const modelProgress = requireElement<HTMLProgressElement>("model-progress");
const modelProgressText = requireElement<HTMLParagraphElement>("model-progress-text");
const explainButton = requireElement<HTMLButtonElement>("explain");

let running = false;
let lastResult: AuditResult | undefined;
let provider: WebLlmProvider | undefined;

populateModels();

modelSelect.addEventListener("change", () => {
  // Switching models discards the engine rather than holding two sets of
  // weights on the GPU.
  void provider?.unload();
  provider = undefined;
  describeSelectedModel();
  setEngineLine("Analyzers only — no model loaded");
});

explainButton.addEventListener("click", () => {
  if (running) return;
  void explainCurrentFindings();
});

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

    lastResult = result;
    explainButton.disabled = result.findings.length === 0;
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

function populateModels(): void {
  for (const model of MODEL_CHOICES) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.recommended
      ? `${model.label} (recommended)`
      : model.label;
    modelSelect.append(option);
  }
  modelSelect.value = DEFAULT_MODEL_ID;
  describeSelectedModel();
}

/** The download is gigabytes; it should never start as a surprise (docs/12 T7). */
function describeSelectedModel(): void {
  const model = findModel(modelSelect.value);
  if (model === undefined) {
    modelNote.textContent = "";
    return;
  }
  const speed =
    model.measured === undefined
      ? ""
      : ` About ${String(Math.round(model.measured.decodeTokensPerSec))} words/sec on an M4.`;
  modelNote.textContent = `First use downloads about ${String(model.downloadMB)} MB. ${model.note}${speed}`;
}

function ensureProvider(): WebLlmProvider {
  provider ??= createWebLlmProvider({
    modelId: modelSelect.value,
    onProgress: (report) => {
      modelProgress.hidden = false;
      modelProgressText.hidden = false;
      modelProgress.value = Math.round((report.progress ?? 0) * 100);
      modelProgressText.textContent = report.text;
    },
  });
  return provider;
}

/**
 * Explanations are a separate action rather than part of the audit.
 *
 * At the throughput spike S2 measured — around 20 tokens a second on the
 * default model — explaining a page's worth of findings takes long enough that
 * it should be something a person asks for, not something that happens while
 * they wait for findings that were already ready.
 */
async function explainCurrentFindings(): Promise<void> {
  if (lastResult === undefined) return;
  running = true;
  explainButton.disabled = true;
  auditButton.disabled = true;

  try {
    const engine = ensureProvider();
    setEngineLine("Loading model…");

    const total = lastResult.findings.length;
    const explained = await explainFindings(lastResult.findings, {
      provider: engine,
      logger: console,
      onProgress: (done) => {
        setEngineLine(`Explaining ${String(done)} of ${String(total)}…`);
      },
    });

    lastResult = { ...lastResult, findings: explained };
    findingsEl.replaceChildren(renderFindings(explained));

    const store = createIdbStore(await openWebAuditDb());
    await store.putAudit(lastResult);

    modelProgress.hidden = true;
    modelProgressText.hidden = true;
    setEngineLine(`Model ready — ${findModel(modelSelect.value)?.label ?? ""}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
    setEngineLine("Model failed to load");
  } finally {
    running = false;
    explainButton.disabled = false;
    auditButton.disabled = false;
  }
}

function setEngineLine(message: string): void {
  engineLine.textContent = message;
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
