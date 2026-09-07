import {
  groupByCategory,
  SEVERITY_ORDER,
  type AuditResult,
  type Finding,
  type Severity,
  type Clause,
  type AuditTrace,
  type TosReport,
} from "core";

/**
 * Human-readable output. Deliberately plain text: it is read in a terminal and
 * diffed in CI, and both are easier without colour codes in the way.
 */
export function formatReport(result: AuditResult): string {
  const lines: string[] = [];

  lines.push(`${result.url}`);
  const count = result.findings.length;
  lines.push(
    `${String(count)} ${count === 1 ? "finding" : "findings"} in ${String(
      result.finishedAt - result.startedAt,
    )}ms  ·  audit ${result.auditId}`,
  );
  lines.push("");
  lines.push(summariseCounts(result.findings));
  lines.push("");

  for (const finding of result.findings) {
    lines.push(`[${finding.severity.toUpperCase()}] ${finding.title}`);
    lines.push(`  rule       ${finding.analyzerId}/${finding.ruleId}`);
    lines.push(`  confidence ${finding.confidence}`);
    for (const line of wrap(finding.summary, 74)) {
      lines.push(`  ${line}`);
    }
    // Marked, because it is the one part a model wrote. A reader should never
    // have to guess which sentences are deterministic (docs/03).
    if (finding.explanation !== undefined) {
      lines.push("");
      for (const line of wrap(finding.explanation, 70)) {
        lines.push(`  model │ ${line}`);
      }
    }
    for (const item of finding.evidence.slice(0, 5)) {
      const where = item.location === undefined ? "" : `  (${item.location})`;
      lines.push(`  · ${item.kind}: ${item.value}${where}`);
    }
    if (finding.evidence.length > 5) {
      lines.push(`  · … ${String(finding.evidence.length - 5)} more`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function summariseCounts(findings: readonly Finding[]): string {
  const counts = new Map<Severity, number>();
  for (const finding of findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }

  const parts = SEVERITY_ORDER.filter((severity) => counts.has(severity)).map(
    (severity) => `${String(counts.get(severity))} ${severity}`,
  );

  return parts.length === 0 ? "no findings" : parts.join("  ·  ");
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";

  for (const word of text.split(/\s+/)) {
    if (current === "") {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);

  return lines;
}

/**
 * The ToS report as text (docs/05 stage 8).
 *
 * Every clause prints its verbatim quote and where it came from. That is the
 * whole value: the quotes were verified against the source before they got
 * here, and printing them is what lets a reader check the claim.
 */
export function formatTosReport(report: TosReport): string {
  const lines: string[] = ["", "─── What the terms say ───", ""];
  lines.push(report.overallSummary);

  if (report.limitations.length > 0) {
    lines.push("");
    for (const limitation of report.limitations) {
      lines.push(`  ! ${limitation}`);
    }
  }

  if (report.topConcerns.length > 0) {
    lines.push("", "Worth knowing about:");
    for (const clause of report.topConcerns) {
      lines.push(...formatClause(clause));
    }
  }

  const rest = report.clauses.filter(
    (clause) => !report.topConcerns.some((top) => top.quote === clause.quote),
  );
  for (const group of groupByCategory(rest)) {
    lines.push("", `${group.category}:`);
    for (const clause of group.clauses) {
      lines.push(...formatClause(clause));
    }
  }

  lines.push("");
  for (const source of report.sources) {
    lines.push(`  read from ${source.url}`);
  }
  lines.push("");

  return lines.join("\n");
}

function formatClause(clause: Clause): string[] {
  const lines = [``, `  [${clause.concern.toUpperCase()}] ${clause.summary}`];
  for (const line of wrap(clause.quote, 68)) {
    lines.push(`    "${line}`);
  }
  lines.push(`    — ${clause.headingPath}`);
  return lines;
}

/**
 * The trace as text (docs/06).
 *
 * The workbench renders this properly (docs/09); here it is a flat list, which
 * is enough to see what the loop decided and what it cost.
 */
export function formatTrace(trace: AuditTrace): string {
  const lines: string[] = ["", "─── What the agent did ───", ""];

  for (const step of trace.steps) {
    switch (step.kind) {
      case "model":
        lines.push(`  ${String(step.index)}. think   ${truncate(step.response, 90)}`);
        break;
      case "tool":
        lines.push(
          `  ${String(step.index)}. tool    ${step.name} — ${truncate(step.summary, 70)}`,
        );
        break;
      case "budget":
        lines.push(`  ${String(step.index)}. budget  ${step.limit}: ${step.message}`);
        break;
      case "error":
        lines.push(
          `  ${String(step.index)}. error   ${step.name ?? ""} ${step.message}`,
        );
        break;
    }
  }

  const used = trace.budgetUsed;
  lines.push(
    "",
    `  stopped by ${trace.stoppedBy} · ${String(used.steps)} steps · ` +
      `${String(used.fetches)} fetches · ${String(used.inputTokens)} input tokens · ` +
      `${String(used.wallMs)}ms`,
    "",
  );

  return lines.join("\n");
}

function truncate(text: string, width: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`;
}
