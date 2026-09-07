import {
  SEVERITY_ORDER,
  type AuditResult,
  type AuditSummary,
  type Severity,
} from "core";

import { createIdbStore, openWebAuditDb } from "../../lib/store-idb.js";
import { MODEL_CHOICES } from "../../lib/models.js";
import { loadSettings, saveSettings, type Settings } from "../../lib/settings.js";
import { formatMs, renderTrace } from "./render-trace.js";

/**
 * The workbench (docs/09).
 *
 * A normal tab reading the same IndexedDB the side panel writes. It runs no
 * audits and loads no engine — that separation is why it can be a plain
 * document with no permissions of its own.
 */

const views = new Map<string, HTMLElement>(
  ["dashboard", "history", "trace", "models", "settings"].map((name) => [
    name,
    requireElement(name),
  ]),
);

const store = createIdbStore(await openWebAuditDb());
let selectedAuditId: string | undefined;

for (const button of document.querySelectorAll("nav button")) {
  button.addEventListener("click", () => {
    const name = (button as HTMLElement).dataset["view"];
    if (name !== undefined) void show(name);
  });
}

await show("dashboard");

async function show(name: string): Promise<void> {
  for (const [key, element] of views) element.hidden = key !== name;
  for (const button of document.querySelectorAll("nav button")) {
    button.classList.toggle("active", (button as HTMLElement).dataset["view"] === name);
  }

  switch (name) {
    case "dashboard":
      await renderDashboard();
      break;
    case "history":
      await renderHistory();
      break;
    case "trace":
      await renderTraceView();
      break;
    case "models":
      renderModels();
      break;
    case "settings":
      await renderSettings();
      break;
  }
}

async function renderDashboard(): Promise<void> {
  const view = views.get("dashboard");
  if (view === undefined) return;

  const audits = await store.listAudits();
  view.replaceChildren(heading("Recent audits"));

  if (audits.length === 0) {
    view.append(
      note(
        "No audits stored yet. Run one from the side panel and it will appear here.",
      ),
    );
    return;
  }

  // Grouped by site, because the question is usually "how is this site doing",
  // not "what did I run at 14:32".
  const byHost = new Map<string, AuditSummary[]>();
  for (const audit of audits) {
    const host = hostOf(audit.url);
    byHost.set(host, [...(byHost.get(host) ?? []), audit]);
  }

  // Severity counts need the findings, which the summaries deliberately omit
  // (docs/09). Only the latest audit per site is loaded, which is what the
  // dashboard is actually asking about.
  const rows: Row[] = [];
  for (const [host, list] of byHost) {
    const latest = list[0];
    const audit =
      latest === undefined ? undefined : await store.getAudit(latest.auditId);
    rows.push({
      cells: [
        host,
        String(list.length),
        new Date(latest?.startedAt ?? 0).toLocaleString(),
        audit === undefined ? "—" : severityCounts(audit.findings),
      ],
      onClick: () => void openHistoryFor(host),
    });
  }

  view.append(table(["Site", "Audits", "Latest", "Findings"], rows));
}

async function openHistoryFor(host: string): Promise<void> {
  await show("history");
  await renderHistory(host);
}

async function renderHistory(host?: string): Promise<void> {
  const view = views.get("history");
  if (view === undefined) return;

  const all = await store.listAudits();
  const audits = host === undefined ? all : all.filter((a) => hostOf(a.url) === host);

  view.replaceChildren(
    heading(host === undefined ? "All audits" : `Audits of ${host}`),
  );

  if (audits.length === 0) {
    view.append(note("Nothing stored for this site."));
    return;
  }

  view.append(
    table(
      ["When", "URL", "Findings", "Duration"],
      audits.map((audit) => ({
        cells: [
          new Date(audit.startedAt).toLocaleString(),
          audit.url,
          String(audit.findingCount),
          formatMs(audit.finishedAt - audit.startedAt),
        ],
        onClick: () => {
          selectedAuditId = audit.auditId;
          void show("trace");
        },
      })),
    ),
  );
}

async function renderTraceView(): Promise<void> {
  const view = views.get("trace");
  if (view === undefined) return;

  view.replaceChildren(heading("Trace"));

  const audit = await pickAuditForTrace();
  if (audit === undefined) {
    view.append(
      note(
        "No audit with a trace is stored. Run a full audit from the side panel — an analyzers-only run has no trace to show.",
      ),
    );
    return;
  }

  const where = document.createElement("p");
  where.className = "empty";
  where.textContent = `${audit.url} · ${new Date(audit.startedAt).toLocaleString()}`;
  view.append(where);

  if (audit.summary !== undefined) {
    const summary = document.createElement("p");
    summary.textContent = audit.summary;
    view.append(summary);
  }

  if (audit.trace === undefined) return;
  view.append(renderTrace(audit.trace));
}

/** The one selected from history, or the most recent that has a trace at all. */
async function pickAuditForTrace(): Promise<AuditResult | undefined> {
  if (selectedAuditId !== undefined) {
    const chosen = await store.getAudit(selectedAuditId);
    if (chosen?.trace !== undefined) return chosen;
  }

  for (const summary of await store.listAudits()) {
    const audit = await store.getAudit(summary.auditId);
    if (audit?.trace !== undefined) return audit;
  }
  return undefined;
}

/**
 * Spike S3 (docs/11): does WebGPU work in an offscreen document, and does
 * Chrome reclaim it when idle?
 *
 * A button rather than a script because neither question can be answered from a
 * terminal — `chrome.offscreen` exists only in the background worker, and
 * Chrome 152 refuses both `--load-extension` and CDP access to an extension's
 * service worker. Someone has to click it, so the least that can be done is
 * make it one click.
 */
function renderS3(view: HTMLElement): void {
  const heading = document.createElement("h2");
  heading.textContent = "Spike S3 — offscreen document";
  const explain = note(
    "Creates an offscreen document and has it report WebGPU availability every 5 seconds. Leave this tab open: the question is whether Chrome reclaims the document when it goes idle.",
  );

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Start the probe";

  const output = document.createElement("pre");
  output.className = "empty";

  let poll: ReturnType<typeof setInterval> | undefined;

  button.addEventListener("click", () => {
    button.disabled = true;
    output.textContent = "starting…";

    void browser.runtime
      .sendMessage({ id: "s3", type: "s3.start", payload: {} })
      .then(async () => {
        if (poll !== undefined) clearInterval(poll);
        poll = setInterval(() => void refresh(), 2000);
        await refresh();
      })
      .catch((error: unknown) => {
        output.textContent = `failed: ${String(error)}`;
        button.disabled = false;
      });
  });

  async function refresh(): Promise<void> {
    const stored = await browser.storage.session.get(["s3:reports", "s3:createdAt"]);
    const reports = Array.isArray(stored["s3:reports"]) ? stored["s3:reports"] : [];
    const createdAt =
      typeof stored["s3:createdAt"] === "number" ? stored["s3:createdAt"] : 0;
    const last = reports.at(-1) as
      { at?: number; gpu?: { available?: boolean } } | undefined;

    const sinceLast = last?.at === undefined ? 0 : Date.now() - last.at;
    output.textContent = [
      `reports: ${String(reports.length)}`,
      `alive for: ${formatMs(Date.now() - createdAt)}`,
      `WebGPU in offscreen: ${last?.gpu?.available === true ? "yes" : last === undefined ? "(no report yet)" : "NO"}`,
      last?.gpu?.available === true ? `adapter: ${JSON.stringify(last.gpu)}` : "",
      // Heartbeats are every 5s; a longer gap means Chrome reclaimed it.
      sinceLast > 15_000
        ? `LAST HEARTBEAT ${formatMs(sinceLast)} AGO — the document appears to have been closed.`
        : "heartbeat is current",
    ]
      .filter((line) => line !== "")
      .join("\n");
  }

  view.append(heading, explain, button, output);
}

function renderModels(): void {
  const view = views.get("models");
  if (view === undefined) return;

  view.replaceChildren(heading("Models"));
  view.append(
    note(
      "Downloads happen in the side panel, which owns the engine. This lists what is on offer and what spike S2 measured for each.",
    ),
  );
  view.append(
    table(
      ["Model", "Download", "VRAM", "Context", "Decode", "Note"],
      MODEL_CHOICES.map((model) => ({
        cells: [
          model.recommended ? `${model.label} (recommended)` : model.label,
          `${String(model.downloadMB)} MB`,
          `${String(model.vramMB)} MB`,
          String(model.contextTokens),
          model.measured === undefined
            ? "—"
            : `${String(Math.round(model.measured.decodeTokensPerSec))} tok/s`,
          model.note,
        ],
      })),
    ),
  );

  renderS3(view);
}

/** Budgets, allowed domains and the history cap (docs/09). */
async function renderSettings(): Promise<void> {
  const view = views.get("settings");
  if (view === undefined) return;

  const settings = await loadSettings();
  view.replaceChildren(heading("Settings"));

  const form = document.createElement("form");
  form.className = "settings";

  const fields: Array<[keyof Settings, string, string]> = [
    ["maxSteps", "Model calls per audit", "number"],
    ["maxNetworkFetches", "Network fetches per audit", "number"],
    ["historyCap", "Audits to keep", "number"],
    ["extraAllowedDomains", "Extra allowed domains (comma separated)", "text"],
  ];

  const inputs = new Map<keyof Settings, HTMLInputElement>();

  for (const [key, label, type] of fields) {
    const row = document.createElement("label");
    row.className = "setting";
    const name = document.createElement("span");
    name.textContent = label;
    const input = document.createElement("input");
    input.type = type;
    const value = settings[key];
    input.value = Array.isArray(value) ? value.join(", ") : String(value);
    inputs.set(key, input);
    row.append(name, input);
    form.append(row);
  }

  const warning = note(
    "Every extra allowed domain widens what one audit may fetch. The background worker enforces this list on its own authority (docs/12 T2), so it is the real boundary rather than a hint.",
  );

  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Save";

  const status = document.createElement("span");
  status.className = "empty";

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const domains = (inputs.get("extraAllowedDomains")?.value ?? "")
      .split(",")
      .map((domain) => domain.trim())
      .filter((domain) => domain !== "");

    const next: Settings = {
      ...settings,
      maxSteps: Number(inputs.get("maxSteps")?.value ?? settings.maxSteps),
      maxNetworkFetches: Number(
        inputs.get("maxNetworkFetches")?.value ?? settings.maxNetworkFetches,
      ),
      historyCap: Number(inputs.get("historyCap")?.value ?? settings.historyCap),
      extraAllowedDomains: domains,
    };

    void saveSettings(next)
      .then(() => {
        status.textContent = "Saved.";
      })
      .catch((error: unknown) => {
        // The schema rejects anything that would make a run unbounded.
        status.textContent = `Not saved: ${error instanceof Error ? error.message : String(error)}`;
      });
  });

  form.append(save, status);
  view.append(form, warning);
}

// --- small builders -------------------------------------------------------

function heading(text: string): HTMLElement {
  const element = document.createElement("h2");
  element.textContent = text;
  return element;
}

function note(text: string): HTMLElement {
  const element = document.createElement("p");
  element.className = "empty";
  element.textContent = text;
  return element;
}

interface Row {
  cells: string[];
  onClick?: () => void;
}

function table(headers: string[], rows: Row[]): HTMLElement {
  const element = document.createElement("table");

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const header of headers) {
    const cell = document.createElement("th");
    cell.textContent = header;
    headRow.append(cell);
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const value of row.cells) {
      const td = document.createElement("td");
      // Every one of these can contain a URL or a title the audited site chose.
      td.textContent = value;
      tr.append(td);
    }
    if (row.onClick !== undefined) tr.addEventListener("click", row.onClick);
    body.append(tr);
  }

  element.append(head, body);
  return element;
}

/** e.g. "1 critical, 3 medium" — worse first, and nothing for what is absent. */
function severityCounts(findings: ReadonlyArray<{ severity: Severity }>): string {
  const counts = new Map<Severity, number>();
  for (const finding of findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }
  const parts = SEVERITY_ORDER.filter((severity) => counts.has(severity)).map(
    (severity) => `${String(counts.get(severity))} ${severity}`,
  );
  return parts.length === 0 ? "none" : parts.join(", ");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`workbench is missing #${id}`);
  return element;
}
