import { SEVERITY_ORDER, type Finding, type Severity } from "core";

/**
 * Findings as DOM, grouped by severity (docs/08).
 *
 * Built with `document.createElement` and `textContent` throughout. Every string
 * here — a finding's title, its evidence, a URL from the page — originates in
 * content the audited site controls, so none of it goes anywhere near
 * `innerHTML`. That is the same rule as docs/12 T1, applied to the UI: untrusted
 * text is data, never markup.
 */

export function renderCounts(findings: readonly Finding[]): HTMLElement {
  const counts = new Map<Severity, number>();
  for (const finding of findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }

  const list = document.createElement("ul");
  list.className = "counts";

  for (const severity of SEVERITY_ORDER) {
    const count = counts.get(severity);
    if (count === undefined) continue;
    const item = document.createElement("li");
    item.textContent = `${String(count)} ${severity}`;
    item.style.setProperty("color", `var(--${severity})`);
    list.append(item);
  }

  return list;
}

export function renderFindings(findings: readonly Finding[]): DocumentFragment {
  const fragment = document.createDocumentFragment();

  if (findings.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      "No findings from the deterministic analyzers. That is not the same as no problems — header, CSP, and tracker checks arrive in M3.";
    fragment.append(empty);
    return fragment;
  }

  fragment.append(renderCounts(findings));
  for (const finding of findings) {
    fragment.append(renderFinding(finding));
  }

  return fragment;
}

function renderFinding(finding: Finding): HTMLElement {
  const details = document.createElement("details");
  details.className = "finding";
  details.style.setProperty("--sev", `var(--${finding.severity})`);
  // Open the ones that warrant attention without a click.
  details.open = finding.severity === "critical" || finding.severity === "high";

  const summary = document.createElement("summary");
  const severity = document.createElement("span");
  severity.className = "sev";
  severity.textContent = finding.severity;
  const title = document.createElement("span");
  title.textContent = finding.title;
  summary.append(severity, title);

  const body = document.createElement("div");
  body.className = "finding-body";

  const text = document.createElement("p");
  text.className = "summary-text";
  text.textContent = finding.summary;

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = `${finding.analyzerId}/${finding.ruleId} · confidence ${finding.confidence}`;

  body.append(text, meta);

  if (finding.evidence.length > 0) {
    const evidence = document.createElement("ul");
    evidence.className = "evidence";
    for (const item of finding.evidence.slice(0, 10)) {
      const li = document.createElement("li");
      li.textContent =
        item.location === undefined
          ? `${item.kind}: ${item.value}`
          : `${item.kind}: ${item.value} (${item.location})`;
      evidence.append(li);
    }
    if (finding.evidence.length > 10) {
      const more = document.createElement("li");
      more.textContent = `… ${String(finding.evidence.length - 10)} more`;
      evidence.append(more);
    }
    body.append(evidence);
  }

  if (finding.references.length > 0) {
    const refs = document.createElement("ul");
    refs.className = "refs";
    for (const href of finding.references) {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.textContent = href;
      li.append(link);
      refs.append(li);
    }
    body.append(refs);
  }

  details.append(summary, body);
  return details;
}
