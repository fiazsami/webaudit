import { createFinding, type Finding } from "../../findings/schema.js";
import type { PageSnapshot } from "../../snapshot/schema.js";
import type { Analyzer } from "../types.js";

const ANALYZER_ID = "policy-presence";

/**
 * Whether the site links to its own policies at all (docs/03).
 *
 * This reads `policyHint`, which the snapshot builder assigns heuristically, so
 * a miss is possible — a site may link its policy with wording the heuristic
 * does not recognise. Confidence reflects that, and drops further when the link
 * list was truncated, because then the link may simply not be in the snapshot.
 */
export const policyPresenceAnalyzer: Analyzer = {
  id: ANALYZER_ID,
  needs: [],

  run(snapshot: PageSnapshot): Promise<Finding[]> {
    const truncated = snapshot.limitations.includes("links-truncated");
    const confidence = truncated ? "low" : "medium";
    const caveat = truncated
      ? " The captured link list was truncated, so the link may exist further down the page."
      : "";

    const hints = new Set(
      snapshot.links
        .map((link) => link.policyHint)
        .filter((hint): hint is NonNullable<typeof hint> => hint !== undefined),
    );

    const findings: Finding[] = [];

    if (!hints.has("privacy")) {
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "no-privacy-policy-link",
          severity: "medium",
          confidence,
          title: "No privacy policy link found",
          summary:
            "Nothing on this page links to a privacy policy, so there is no " +
            "stated account of what the site collects or who it shares it with." +
            caveat,
          evidence: [linksExamined(snapshot)],
          tags: ["policy", "privacy"],
        }),
      );
    }

    if (!hints.has("terms")) {
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "no-terms-link",
          severity: "low",
          confidence,
          title: "No terms of service link found",
          summary:
            "Nothing on this page links to terms of service, so the agreement " +
            "a visitor is presumed to accept is not reachable from here." +
            caveat,
          evidence: [linksExamined(snapshot)],
          tags: ["policy"],
        }),
      );
    }

    return Promise.resolve(findings);
  },
};

function linksExamined(snapshot: PageSnapshot): Finding["evidence"][number] {
  const count = snapshot.links.length;
  return {
    kind: "other",
    value: `${String(count)} ${count === 1 ? "link" : "links"} examined`,
    location: snapshot.url,
  };
}
