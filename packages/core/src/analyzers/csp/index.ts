import { CspEvaluator } from "csp_evaluator/dist/evaluator.js";
import {
  Severity as CspEvaluatorSeverity,
  type Finding as CspEvaluatorFinding,
} from "csp_evaluator/dist/finding.js";
import { CspParser } from "csp_evaluator/dist/parser.js";

import {
  createFinding,
  SEVERITY_ORDER,
  type Confidence,
  type Finding,
  type Severity,
} from "../../findings/schema.js";
import type { PageSnapshot } from "../../snapshot/schema.js";
import type { Analyzer, AnalyzerContext } from "../types.js";
import { CSP_REFERENCES, CSP_RULES, type CspRule } from "./mapping.js";

const ANALYZER_ID = "csp";

/**
 * Directive-level CSP analysis via `csp_evaluator` (docs/03, docs/10).
 *
 * Nothing here makes a network request: the policy arrives in the headers the
 * background worker already fetched. See `mapping.ts` for how this divides work
 * with the `headers` analyzer, which reports the policy's overall strength.
 *
 * A policy can also arrive in a `<meta http-equiv>` tag. Both sources are read,
 * and each finding says which one it came from — a meta policy is weaker in
 * practice, since it applies only from the point the parser reaches it.
 */
export const cspAnalyzer: Analyzer = {
  id: ANALYZER_ID,
  needs: ["headers"],

  run(snapshot: PageSnapshot, ctx: AnalyzerContext): Promise<Finding[]> {
    const policies = collectPolicies(snapshot, ctx);
    const findings: Finding[] = [];
    const seen = new Set<string>();

    for (const { source, policy } of policies) {
      let evaluated: CspEvaluatorFinding[];
      try {
        // Never throw on one bad policy — return what we got and log (docs/03).
        evaluated = new CspEvaluator(new CspParser(policy).csp).evaluate();
      } catch (error) {
        ctx.logger.warn(`csp: could not evaluate a policy from ${source}`, error);
        continue;
      }

      for (const item of evaluated) {
        const rule = CSP_RULES[item.type];
        if (rule === undefined) continue; // covered by `headers`, or not reportable

        // One directive can produce the same finding from both sources.
        const key = `${rule.ruleId}:${item.directive}:${item.value ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // csp_evaluator distinguishes "this is wrong" from "this may be wrong":
        // `'self'` in script-src, for instance, is only a bypass if the origin
        // also hosts JSONP or user uploads, which it cannot know. Reporting
        // those at full severity would flag most of the web.
        const { severity, confidence } = weigh(rule, item.severity);

        findings.push(
          createFinding({
            analyzerId: ANALYZER_ID,
            ruleId: rule.ruleId,
            severity,
            confidence,
            title: rule.title,
            summary: rule.summary,
            evidence: [
              {
                kind: "header",
                // The library's own wording, which names the specific directive
                // and value; ours explains why it matters.
                value: `${item.description} [${item.directive}${
                  item.value === undefined ? "" : ` ${item.value}`
                }]`.slice(0, 1000),
                location: source,
              },
            ],
            references: CSP_REFERENCES,
            tags: ["csp", "headers"],
          }),
        );
      }
    }

    return Promise.resolve(findings);
  },
};

/** A `_MAYBE` verdict costs one severity step and drops confidence. */
function weigh(
  rule: CspRule,
  librarySeverity: CspEvaluatorSeverity,
): { severity: Severity; confidence: Confidence } {
  const uncertain =
    librarySeverity === CspEvaluatorSeverity.HIGH_MAYBE ||
    librarySeverity === CspEvaluatorSeverity.MEDIUM_MAYBE;

  if (!uncertain) return { severity: rule.severity, confidence: rule.confidence };

  const index = SEVERITY_ORDER.indexOf(rule.severity);
  const softened = SEVERITY_ORDER[Math.min(index + 1, SEVERITY_ORDER.length - 1)];
  return { severity: softened ?? rule.severity, confidence: "medium" };
}

interface PolicySource {
  source: string;
  policy: string;
}

function collectPolicies(snapshot: PageSnapshot, ctx: AnalyzerContext): PolicySource[] {
  const policies: PolicySource[] = [];

  const header = ctx.headers?.["content-security-policy"];
  if (header !== undefined && header.trim() !== "") {
    policies.push({ source: "content-security-policy", policy: header });
  }

  const meta = snapshot.metaTags["content-security-policy"];
  if (meta !== undefined && meta.trim() !== "") {
    policies.push({ source: "meta http-equiv", policy: meta });
  }

  return policies;
}
