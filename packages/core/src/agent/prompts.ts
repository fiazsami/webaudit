import type { Finding } from "../findings/schema.js";
import type { PageSnapshot } from "../snapshot/schema.js";
import type { Tool } from "./types.js";

// The prompt lives in `prompts/orchestrator.md` so it can be reviewed as prose
// rather than read out of a string literal (docs/06). It cannot be imported
// directly — Node has no markdown loader and core must run unmodified in both
// hosts — so `pnpm build-prompts` generates the module below from it, and a
// test fails if the two drift.
export { ORCHESTRATOR_PROMPT } from "./prompts/index.js";
import { ORCHESTRATOR_PROMPT } from "./prompts/index.js";

/** The system prompt: the reviewable file, plus the tools as they exist now. */
export function buildSystemPrompt(tools: readonly Tool[]): string {
  const list = tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n");
  return `${ORCHESTRATOR_PROMPT}\n\n## Tool reference\n\n${list}\n`;
}

/**
 * What the model is told about the page.
 *
 * Counts and shapes, not content. `textExcerpt` is deliberately absent: it is
 * page-controlled prose, and the whole design is that such text reaches the
 * model only as schema-validated extractions (docs/06, docs/12 T1).
 */
export function describeSnapshot(snapshot: PageSnapshot): string {
  const thirdPartyHosts = new Set<string>();
  for (const request of snapshot.thirdPartyRequests) {
    try {
      thirdPartyHosts.add(new URL(request.url).hostname);
    } catch {
      // Not a hostname we can name.
    }
  }

  const policyLinks = snapshot.links.filter((link) => link.policyHint !== undefined);

  return [
    `URL: ${snapshot.url}`,
    `Protocol: ${snapshot.protocol}`,
    `Scripts: ${String(snapshot.scripts.length)} (${String(snapshot.scripts.filter((s) => s.src !== undefined).length)} external)`,
    `Forms: ${String(snapshot.forms.length)}, ${String(snapshot.forms.filter((f) => f.hasPasswordField).length)} with a password field`,
    `Cookies: ${String(snapshot.cookies.length)}`,
    `Third-party hosts observed: ${thirdPartyHosts.size === 0 ? "none" : [...thirdPartyHosts].slice(0, 15).join(", ")}`,
    `Policy links: ${policyLinks.length === 0 ? "none" : policyLinks.map((l) => l.policyHint).join(", ")}`,
    snapshot.limitations.length === 0
      ? "Capture limitations: none"
      : `Capture limitations: ${snapshot.limitations.join(", ")}`,
  ].join("\n");
}

/** Findings as `id | severity | title`, never as full JSON (docs/06). */
export function describeFindingsForModel(findings: readonly Finding[]): string {
  if (findings.length === 0) return "No findings yet.";
  return findings
    .map((finding) => `${finding.id} | ${finding.severity} | ${finding.title}`)
    .join("\n");
}
