import { SEVERITY_ORDER, type AuditResult, type Finding, type Severity } from "core";

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
