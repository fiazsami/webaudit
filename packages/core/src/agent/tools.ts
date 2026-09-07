import { z } from "zod";

import { analyzers as defaultAnalyzers } from "../analyzers/index.js";
import { runAnalyzers } from "../analyzers/run.js";
import type { AnalyzerContext } from "../analyzers/types.js";
import { explainFinding } from "../explain/index.js";
import { dedupeFindings, sortFindings, type Finding } from "../findings/schema.js";
import { discoverPolicies } from "../tos/discover.js";
import { runTosPipeline } from "../tos/pipeline.js";
import { BudgetExceeded } from "./budget.js";
import type { Tool, ToolContext } from "./types.js";

/**
 * The tools the orchestrator may call (docs/06).
 *
 * Two rules run through all of them:
 *
 * - **Results are summarised before going back to the model.** Full objects
 *   stay in the context and the store. A model with a 4k window cannot afford
 *   to read a `TosReport` as JSON, and it does not need to.
 * - **Untrusted text never becomes a tool result.** Policy text and page text
 *   stay inside the tools; what comes back is counts and schema-validated
 *   fields. This is the mechanism docs/12 T1 relies on, not the prompt warning.
 */

function analyzerContext(ctx: ToolContext): AnalyzerContext {
  return {
    logger: ctx.caps.logger,
    ...(ctx.headers === undefined ? {} : { headers: ctx.headers }),
    ...(ctx.trackerDb === undefined ? {} : { trackerDb: ctx.trackerDb }),
    ...(ctx.libraryDb === undefined ? {} : { libraryDb: ctx.libraryDb }),
  };
}

function describeFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return "No new findings.";
  return findings
    .map((finding) => `${finding.id} | ${finding.severity} | ${finding.title}`)
    .join("\n");
}

const fetchHeadersInput = z.object({ url: z.url() });

export const fetchHeadersTool = {
  name: "fetchHeaders",
  description:
    "Refetch a URL to read its response headers. A content script cannot see " +
    "them, so this is what enables the header and CSP checks. Call it once for " +
    "the audited page before running analyzers.",
  input: fetchHeadersInput,
  sideEffects: "network",

  async run(
    { url }: z.infer<typeof fetchHeadersInput>,
    ctx: ToolContext,
  ): Promise<string> {
    // Checked before the request, by the tool. The background worker checks
    // again on its own authority, which is where the real boundary is
    // (docs/12 T2).
    ctx.budget.assertDomainAllowed(url);
    ctx.budget.spendFetch();

    const response = await ctx.caps.http.fetch(url, {
      method: "GET",
      timeoutMs: 15_000,
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    });

    ctx.headers = response.headers;
    const names = Object.keys(response.headers).sort();
    return `HTTP ${String(response.status)} from ${response.url}. ${String(names.length)} headers: ${names.join(", ")}`;
  },
} satisfies Tool;

const runAnalyzersInput = z.object({ ids: z.array(z.string()).optional() });

export const runAnalyzersTool = {
  name: "runAnalyzers",
  description:
    "Run the deterministic analyzers whose inputs are now available. Safe to " +
    "call again after fetchHeaders; analyzers whose inputs are still missing " +
    "report themselves as skipped rather than passing.",
  input: runAnalyzersInput,
  sideEffects: "none",

  async run(
    { ids }: z.infer<typeof runAnalyzersInput>,
    ctx: ToolContext,
  ): Promise<string> {
    const selected =
      ids === undefined
        ? defaultAnalyzers
        : defaultAnalyzers.filter((analyzer) => ids.includes(analyzer.id));

    const found = await runAnalyzers(ctx.snapshot, analyzerContext(ctx), selected);
    const before = new Set(ctx.findings.map((finding) => finding.id));
    const added = found.filter((finding) => !before.has(finding.id));

    // Drop the "checks skipped" notes for analyzers that have now run. The
    // first pass has no headers, so several analyzers report themselves
    // skipped; leaving those in after fetchHeaders would have the report say
    // the header checks did not run *and* list their findings.
    //
    // Derived from which analyzers were *not* skipped this time, not from which
    // produced findings: an analyzer that ran and found nothing has still run,
    // and is the commonest case for a well-configured site.
    const skippedNow = new Set(
      found
        .filter((finding) => finding.ruleId === "analyzer-skipped")
        .map((finding) => finding.evidence[0]?.location ?? ""),
    );
    const ranNow = new Set(
      selected.map((analyzer) => analyzer.id).filter((id) => !skippedNow.has(id)),
    );
    const stillRelevant = ctx.findings.filter(
      (finding) =>
        finding.ruleId !== "analyzer-skipped" ||
        !ranNow.has(finding.evidence[0]?.location ?? ""),
    );

    ctx.findings = sortFindings(dedupeFindings([...stillRelevant, ...found]));
    return describeFindings(added);
  },
} satisfies Tool;

export const discoverPoliciesTool = {
  name: "discoverPolicies",
  description:
    "List the policy pages this site appears to have, from its own links and " +
    "from common paths. Costs nothing; call it before analyzePolicies.",
  input: z.object({}),
  sideEffects: "none",

  run(_input: Record<string, never>, ctx: ToolContext): Promise<string> {
    const candidates = discoverPolicies(ctx.snapshot, {
      allowedDomains: ctx.budget.budget.allowedDomains,
    });
    if (candidates.length === 0) return Promise.resolve("No policy pages found.");
    return Promise.resolve(
      candidates
        .map((candidate) => `${candidate.hint}: ${candidate.url} (${candidate.source})`)
        .join("\n"),
    );
  },
} satisfies Tool;

const analyzePoliciesInput = z.object({ urls: z.array(z.url()).optional() });

export const analyzePoliciesTool = {
  name: "analyzePolicies",
  description:
    "Read the site's policies and extract their clauses. This is slow — a " +
    "couple of minutes — so call it once, and only after discoverPolicies " +
    "found something.",
  input: analyzePoliciesInput,
  sideEffects: "network",

  async run(
    { urls }: z.infer<typeof analyzePoliciesInput>,
    ctx: ToolContext,
  ): Promise<string> {
    for (const url of urls ?? []) ctx.budget.assertDomainAllowed(url);
    ctx.budget.spendFetch();

    const report = await runTosPipeline(ctx.snapshot, {
      capabilities: ctx.caps,
      discover: { allowedDomains: ctx.budget.budget.allowedDomains },
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    });
    ctx.tosReport = report;

    // Counts and categories, not the clauses themselves. The model has already
    // read this text once, inside the pipeline, under a schema.
    const categories = [...new Set(report.clauses.map((clause) => clause.category))];
    return [
      `Read ${String(report.sources.length)} policy pages.`,
      `${String(report.clauses.length)} clauses, ${String(report.topConcerns.length)} worth attention.`,
      categories.length === 0 ? "" : `Categories: ${categories.join(", ")}.`,
      report.limitations.length === 0
        ? ""
        : `Limitations: ${report.limitations.join(", ")}.`,
    ]
      .filter((line) => line !== "")
      .join(" ");
  },
} satisfies Tool;

export const explainFindingTool = {
  name: "explainFinding",
  description:
    "Write a plain-language explanation for one finding, given its evidence. " +
    "Use it on the findings a visitor would most want explained.",
  input: z.object({ findingId: z.string() }),
  sideEffects: "none",

  async run({ findingId }: { findingId: string }, ctx: ToolContext): Promise<string> {
    const index = ctx.findings.findIndex((finding) => finding.id === findingId);
    if (index === -1) return `No finding with id ${findingId}.`;

    const finding = ctx.findings[index];
    if (finding === undefined) return `No finding with id ${findingId}.`;

    const explained = await explainFinding(finding, {
      provider: ctx.caps.provider,
      logger: ctx.caps.logger,
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    });
    ctx.findings[index] = explained;

    return explained.explanation === undefined
      ? `Could not explain ${findingId}.`
      : `Explained ${findingId}.`;
  },
} satisfies Tool;

export const lookupDomainTool = {
  name: "lookupDomain",
  description:
    "Look up who owns a third-party domain and what it is classified as. " +
    "Useful for deciding whether a third party on the page is worth reporting.",
  input: z.object({ hostname: z.string() }),
  sideEffects: "none",

  run({ hostname }: { hostname: string }, ctx: ToolContext): Promise<string> {
    if (ctx.trackerDb === undefined) {
      return Promise.resolve("No tracker database is loaded in this audit.");
    }
    const entry = ctx.trackerDb.lookup(hostname);
    if (entry === null) return Promise.resolve(`${hostname} is not a known tracker.`);

    const prevalence =
      entry.prevalence === undefined
        ? ""
        : ` Seen on ${(entry.prevalence * 100).toFixed(1)}% of sites.`;
    return Promise.resolve(
      `${hostname} belongs to ${entry.owner}. Categories: ${entry.categories.join(", ")}.${prevalence}`,
    );
  },
} satisfies Tool;

export const finishTool = {
  name: "finish",
  description:
    "End the audit. Give a short summary of what was found, for someone who " +
    "will not read the details.",
  input: z.object({ summary: z.string().max(1200) }),
  sideEffects: "none",

  run({ summary }: { summary: string }): Promise<string> {
    return Promise.resolve(summary);
  },
} satisfies Tool;

export const AGENT_TOOLS: readonly Tool[] = [
  fetchHeadersTool,
  runAnalyzersTool,
  discoverPoliciesTool,
  analyzePoliciesTool,
  explainFindingTool,
  lookupDomainTool,
  finishTool,
];

export { BudgetExceeded };
