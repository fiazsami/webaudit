import { cookiesAnalyzer } from "./cookies/index.js";
import { formsAnalyzer } from "./forms/index.js";
import { policyPresenceAnalyzer } from "./policy-presence/index.js";
import { scriptsAnalyzer } from "./scripts/index.js";
import { transportAnalyzer } from "./transport/index.js";
import type { Analyzer } from "./types.js";

/**
 * The registry. Analyzers needing external inputs — `headers`, `csp`,
 * `trackers`, `libraries` (M3) — declare those needs and are skipped with an
 * explicit finding until the inputs exist (docs/03).
 */
export const analyzers: readonly Analyzer[] = [
  transportAnalyzer,
  cookiesAnalyzer,
  formsAnalyzer,
  scriptsAnalyzer,
  policyPresenceAnalyzer,
];

export {
  cookiesAnalyzer,
  formsAnalyzer,
  policyPresenceAnalyzer,
  scriptsAnalyzer,
  transportAnalyzer,
};
