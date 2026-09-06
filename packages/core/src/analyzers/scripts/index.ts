import { createFinding, type Finding } from "../../findings/schema.js";
import type { PageSnapshot, ScriptRef } from "../../snapshot/schema.js";
import { isSameOrigin } from "../../snapshot/url.js";
import type { Analyzer } from "../types.js";

const ANALYZER_ID = "scripts";

/** Above this, inline scripts stop being a handful and become a pattern. */
const INLINE_SCRIPT_THRESHOLD = 15;

/**
 * What code the page runs and where it came from (docs/03).
 *
 * The original table also listed "scripts from unexpected TLDs". That rule is
 * not implemented here: it needs a reputation list to mean anything, and a
 * hand-written TLD blocklist would produce confident false positives about
 * perfectly ordinary sites. Classifying third-party script origins is the
 * `trackers` analyzer's job in M3, which has an actual data source behind it.
 */
export const scriptsAnalyzer: Analyzer = {
  id: ANALYZER_ID,
  needs: [],

  run(snapshot: PageSnapshot): Promise<Finding[]> {
    const findings: Finding[] = [];

    const thirdPartyWithoutSri = snapshot.scripts.filter(
      (script) =>
        script.src !== undefined &&
        !isSameOrigin(script.src, snapshot.url) &&
        script.attrs["integrity"] === undefined,
    );

    const inlineCount = snapshot.scripts.filter(
      (script) => script.src === undefined,
    ).length;

    if (thirdPartyWithoutSri.length > 0) {
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "third-party-script-without-sri",
          severity: "medium",
          confidence: "high",
          title: "Third-party scripts without subresource integrity",
          summary:
            "These scripts are loaded from another origin with no integrity " +
            "hash, so whatever that origin serves runs with the full privileges " +
            "of this page. If it is ever compromised, so is every visitor here.",
          evidence: thirdPartyWithoutSri.map((script) => ({
            kind: "script" as const,
            value: script.src ?? "",
          })),
          references: [
            "https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity",
          ],
          tags: ["scripts", "supply-chain"],
        }),
      );
    }

    if (inlineCount > INLINE_SCRIPT_THRESHOLD) {
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "excessive-inline-scripts",
          severity: "low",
          confidence: "medium",
          title: `Page runs ${String(inlineCount)} inline scripts`,
          summary:
            "A page with this many inline scripts is difficult to protect with " +
            "a strict Content-Security-Policy, because every one of them needs " +
            "a nonce or a hash before 'unsafe-inline' can be dropped.",
          evidence: [
            {
              kind: "script",
              value: `${String(inlineCount)} inline scripts`,
              location: describeInline(snapshot.scripts),
            },
          ],
          tags: ["scripts", "csp"],
        }),
      );
    }

    return Promise.resolve(findings);
  },
};

function describeInline(scripts: readonly ScriptRef[]): string {
  const lengths = scripts
    .filter((script) => script.src === undefined)
    .map((script) => script.inlineLength ?? 0);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  return `${String(total)} bytes of inline JavaScript`;
}
