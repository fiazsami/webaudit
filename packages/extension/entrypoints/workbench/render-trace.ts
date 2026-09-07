import type { AuditTrace, TraceStep } from "core";

/**
 * The trace view (docs/09).
 *
 * "The main research payoff — make it good." What makes it good is that it
 * answers the questions someone actually has about a run: what did the model
 * decide, why, what did each decision cost, and where did the time go. A JSON
 * dump answers none of those.
 *
 * Built with createElement and textContent like every other renderer here: a
 * trace contains tool summaries derived from a page the audited site controls.
 */

export function renderTrace(trace: AuditTrace): DocumentFragment {
  const fragment = document.createDocumentFragment();

  fragment.append(renderSummary(trace));
  fragment.append(renderTimeline(trace));
  fragment.append(renderLegend());

  for (const step of trace.steps) {
    fragment.append(renderStep(step));
  }

  return fragment;
}

function renderSummary(trace: AuditTrace): HTMLElement {
  const box = document.createElement("div");
  box.className = "trace-summary";

  const used = trace.budgetUsed;
  const stats: Array<[string, string]> = [
    ["stopped by", trace.stoppedBy],
    ["steps", String(used.steps)],
    ["fetches", String(used.fetches)],
    ["input tokens", used.inputTokens.toLocaleString()],
    ["wall time", formatMs(trace.endedAt - trace.startedAt)],
    ["model", trace.modelId],
  ];

  for (const [label, value] of stats) {
    const stat = document.createElement("div");
    stat.className = "stat";
    const key = document.createElement("span");
    key.className = "label";
    key.textContent = label;
    const val = document.createElement("span");
    val.className = "value";
    val.textContent = value;
    stat.append(key, val);
    box.append(stat);
  }

  return box;
}

/**
 * Where the time went, proportionally.
 *
 * Worth its own row because the answer is not obvious and it is the thing the
 * budget arithmetic in docs/06 turns on: on a local model, thinking dominates,
 * and seeing that is more useful than reading twelve durations.
 */
function renderTimeline(trace: AuditTrace): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "timeline";

  const total = trace.steps.reduce((sum, step) => sum + step.durationMs, 0);
  if (total === 0) {
    const empty = document.createElement("span");
    empty.className = "other";
    empty.style.flex = "1";
    bar.append(empty);
    return bar;
  }

  for (const step of trace.steps) {
    if (step.durationMs === 0) continue;
    const segment = document.createElement("span");
    segment.className =
      step.kind === "model" || step.kind === "tool" ? step.kind : "other";
    segment.style.flex = String(step.durationMs);
    segment.title = `${step.kind} · ${formatMs(step.durationMs)}`;
    bar.append(segment);
  }

  return bar;
}

function renderLegend(): HTMLElement {
  const legend = document.createElement("p");
  legend.className = "legend";
  for (const [name, cls] of [
    ["thinking", "model"],
    ["tools", "tool"],
    ["other", "other"],
  ] as const) {
    const item = document.createElement("span");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = `var(--${cls === "other" ? "line" : cls})`;
    item.append(swatch, document.createTextNode(name));
    legend.append(item);
  }
  return legend;
}

function renderStep(step: TraceStep): HTMLElement {
  const row = document.createElement("div");
  row.className = "step";
  row.dataset["kind"] = step.kind;

  const index = document.createElement("span");
  index.className = "index";
  index.textContent = String(step.index);

  const kind = document.createElement("span");
  kind.className = "kind";
  kind.textContent = step.kind;

  const body = document.createElement("div");
  body.className = "body";
  body.append(...renderBody(step));

  const cost = document.createElement("span");
  cost.className = "cost";
  cost.textContent =
    step.kind === "model"
      ? `${formatMs(step.durationMs)}\n${String(step.usage.inputTokens)} in / ${String(step.usage.outputTokens)} out`
      : formatMs(step.durationMs);

  row.append(index, kind, body, cost);
  return row;
}

function renderBody(step: TraceStep): Node[] {
  switch (step.kind) {
    case "model": {
      // The action, unpacked: what it decided and why, rather than raw JSON.
      const action = parseAction(step.response);
      const nodes: Node[] = [];

      if (action?.reasoning !== undefined) {
        const reasoning = document.createElement("p");
        reasoning.className = "reasoning";
        reasoning.textContent = action.reasoning;
        nodes.push(reasoning);
      }

      const chose = document.createElement("p");
      chose.className = "reasoning";
      chose.textContent =
        action?.tool === undefined
          ? "(the response was not a valid action)"
          : `→ chose ${action.tool}`;
      nodes.push(chose);

      nodes.push(details("what the model was shown", step.prompt));
      return nodes;
    }

    case "tool": {
      const name = document.createElement("p");
      name.className = "reasoning";
      const strong = document.createElement("span");
      strong.className = "tool-name";
      strong.textContent = step.name;
      name.append(strong);

      const summary = document.createElement("pre");
      summary.textContent = step.summary;

      const nodes: Node[] = [name, summary];
      if (Object.keys(step.input).length > 0) {
        nodes.push(details("input", JSON.stringify(step.input, null, 2)));
      }
      return nodes;
    }

    case "budget": {
      const text = document.createElement("p");
      text.className = "reasoning";
      text.textContent = `${step.limit}: ${step.message}`;
      return [text];
    }

    case "error": {
      const text = document.createElement("p");
      text.className = "reasoning";
      text.textContent =
        step.name === undefined ? step.message : `${step.name}: ${step.message}`;
      return [text];
    }
  }
}

function details(label: string, content: string): HTMLElement {
  const element = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = label;
  const pre = document.createElement("pre");
  pre.textContent = content;
  element.append(summary, pre);
  return element;
}

/** The action is JSON we produced, but it came from a model; parse defensively. */
function parseAction(raw: string): { reasoning?: string; tool?: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record["reasoning"] === "string"
        ? { reasoning: record["reasoning"] }
        : {}),
      ...(typeof record["tool"] === "string" ? { tool: record["tool"] } : {}),
    };
  } catch {
    return undefined;
  }
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${String(Math.floor(ms / 60_000))}m ${String(Math.round((ms % 60_000) / 1000))}s`;
}
