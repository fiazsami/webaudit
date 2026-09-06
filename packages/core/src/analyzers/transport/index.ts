import { createFinding, type Finding } from "../../findings/schema.js";
import type { PageSnapshot } from "../../snapshot/schema.js";
import type { Analyzer } from "../types.js";

const ANALYZER_ID = "transport";

/**
 * Page-level transport security (docs/03): was the page itself encrypted, and
 * did it pull anything insecure into that page.
 *
 * Form actions belong to the `forms` analyzer, not here, even though the
 * original table listed them under transport. One rule, one owner — otherwise
 * the same insecure form is reported twice with different wording.
 */
export const transportAnalyzer: Analyzer = {
  id: ANALYZER_ID,
  needs: [],

  run(snapshot: PageSnapshot): Promise<Finding[]> {
    const findings: Finding[] = [];

    if (snapshot.protocol === "http:") {
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "insecure-protocol",
          severity: "high",
          confidence: "high",
          title: "Page served over HTTP",
          summary:
            "This page was loaded over an unencrypted connection. Anyone on the " +
            "network path can read and modify it, including the scripts it runs.",
          evidence: [{ kind: "other", value: snapshot.url, location: "page URL" }],
          references: [
            "https://developer.mozilla.org/en-US/docs/Web/Security/Transport_Layer_Security",
          ],
          tags: ["transport"],
        }),
      );
    }

    if (snapshot.hasMixedContent === true) {
      const insecure = [
        ...snapshot.scripts.map((script) => script.src),
        ...snapshot.iframes.map((iframe) => iframe.src),
      ].filter((src): src is string => src !== undefined && src.startsWith("http:"));

      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "mixed-content",
          severity: "medium",
          confidence: "high",
          title: "Insecure subresources on an HTTPS page",
          summary:
            "This HTTPS page requests subresources over plain HTTP. Browsers " +
            "block or upgrade most of these, and any that load can be replaced " +
            "in transit, undoing the page's encryption.",
          evidence: insecure.map((src) => ({ kind: "script" as const, value: src })),
          references: [
            "https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content",
          ],
          tags: ["transport"],
        }),
      );
    }

    return Promise.resolve(findings);
  },
};
