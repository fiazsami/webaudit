import { groupByCategory, type Clause, type TosReport } from "core";

/**
 * The ToS section (docs/08).
 *
 * Built with `createElement` and `textContent` throughout, like the findings
 * renderer: every quote here is verbatim text from a page the audited site
 * controls, and it must never become markup (docs/12 T1).
 *
 * Each clause shows its quote and where in the policy it came from, because a
 * report whose claims cannot be checked against the source is worth very little
 * — and because quote verification is what the pipeline's credibility rests on.
 */

const CATEGORY_LABELS: Record<Clause["category"], string> = {
  "data-collection": "What they collect",
  "data-sharing": "Who they share it with",
  "data-retention": "How long they keep it",
  "user-content-licence": "Rights over your content",
  arbitration: "Disputes and arbitration",
  termination: "Account termination",
  "auto-renewal": "Subscriptions and renewal",
  "unilateral-changes": "Changes to the terms",
  liability: "Limits on their liability",
  jurisdiction: "Governing law",
  "age-restriction": "Age requirements",
  "other-notable": "Other notable clauses",
};

const LIMITATION_TEXT: Record<string, string> = {
  "policy-truncated":
    "The policy was longer than the budget allowed, so it was read only in part.",
  "chunk-budget-exhausted":
    "Reading stopped at the section limit; later sections were not examined.",
  "no-policy-found": "No policy page could be found from this page's links.",
  "fetch-failed": "A policy page could not be fetched or contained no readable text.",
  "extraction-failed": "The model could not read one or more sections.",
  "no-model": "No model was available, so no clauses were extracted.",
};

export function renderTosReport(report: TosReport): DocumentFragment {
  const fragment = document.createDocumentFragment();

  const heading = document.createElement("h2");
  heading.textContent = "What the terms say";
  fragment.append(heading);

  const summary = document.createElement("p");
  summary.className = "tos-summary";
  summary.textContent = report.overallSummary;
  fragment.append(summary);

  // Said before the clauses, not after: a partial reading that looks complete
  // is the failure this exists to prevent (docs/02's rule, applied here).
  if (report.limitations.length > 0) {
    const list = document.createElement("ul");
    list.className = "tos-limitations";
    for (const limitation of report.limitations) {
      const item = document.createElement("li");
      item.textContent = LIMITATION_TEXT[limitation] ?? limitation;
      list.append(item);
    }
    fragment.append(list);
  }

  if (report.topConcerns.length > 0) {
    const label = document.createElement("h3");
    label.textContent = "Worth knowing about";
    fragment.append(label);
    for (const clause of report.topConcerns) {
      fragment.append(renderClause(clause, report));
    }
  }

  const rest = report.clauses.filter(
    (clause) => !report.topConcerns.some((top) => top.quote === clause.quote),
  );

  for (const group of groupByCategory(rest)) {
    const label = document.createElement("h3");
    label.textContent = CATEGORY_LABELS[group.category];
    fragment.append(label);
    for (const clause of group.clauses) {
      fragment.append(renderClause(clause, report));
    }
  }

  if (report.sources.length > 0) {
    const sources = document.createElement("p");
    sources.className = "tos-sources";
    sources.textContent = `Read from: ${report.sources.map((source) => source.url).join(", ")}`;
    fragment.append(sources);
  }

  return fragment;
}

function renderClause(clause: Clause, report: TosReport): HTMLElement {
  const element = document.createElement("details");
  element.className = "clause";
  element.style.setProperty("--sev", `var(--${concernColour(clause.concern)})`);
  element.open = clause.concern === "high";

  const summary = document.createElement("summary");
  const concern = document.createElement("span");
  concern.className = "sev";
  concern.textContent = clause.concern === "none" ? "note" : clause.concern;
  const text = document.createElement("span");
  text.textContent = clause.summary;
  summary.append(concern, text);

  const body = document.createElement("div");
  body.className = "finding-body";

  // The quote is the point. It was verified against the source before it got
  // here, and showing it is what makes that verification useful to a reader.
  const quote = document.createElement("blockquote");
  quote.className = "quote";
  quote.textContent = clause.quote;
  body.append(quote);

  const where = document.createElement("p");
  where.className = "meta";
  where.textContent =
    clause.headingPath === ""
      ? (report.sources[0]?.url ?? "")
      : `${clause.headingPath}${report.sources[0] === undefined ? "" : ` · ${report.sources[0].url}`}`;
  body.append(where);

  if (clause.concernReason !== undefined) {
    const reason = document.createElement("p");
    reason.className = "explanation";
    const label = document.createElement("span");
    label.className = "explanation-label";
    label.textContent = "Why this matters, per the model";
    const prose = document.createElement("span");
    prose.textContent = clause.concernReason;
    reason.append(label, prose);
    body.append(reason);
  }

  element.append(summary, body);
  return element;
}

function concernColour(concern: Clause["concern"]): string {
  switch (concern) {
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    case "none":
      return "info";
  }
}
