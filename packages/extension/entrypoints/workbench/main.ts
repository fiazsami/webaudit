import {
  SEVERITY_ORDER,
  type AuditResult,
  type AuditSummary,
  type Severity,
} from "core";

import { createIdbStore, openWebAuditDb } from "../../lib/store-idb.js";
import { MODEL_CHOICES } from "../../lib/models.js";
import { formatMs, renderTrace } from "./render-trace.js";

/**
 * The workbench (docs/09).
 *
 * A normal tab reading the same IndexedDB the side panel writes. It runs no
 * audits and loads no engine — that separation is why it can be a plain
 * document with no permissions of its own.
 */

const views = new Map<string, HTMLElement>(
  ["dashboard", "history", "trace", "models"].map((name) => [
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
