import { cookiesAnalyzer } from "./cookies/index.js";
import { cspAnalyzer } from "./csp/index.js";
import { formsAnalyzer } from "./forms/index.js";
import { headersAnalyzer } from "./headers/index.js";
import { librariesAnalyzer } from "./libraries/index.js";
import { policyPresenceAnalyzer } from "./policy-presence/index.js";
import { scriptsAnalyzer } from "./scripts/index.js";
import { transportAnalyzer } from "./transport/index.js";
import type { Analyzer } from "./types.js";

/**
 * The registry.
 *
 * An analyzer needing an external input declares it and is skipped — with an
 * explicit `info` finding naming what was missing — until a caller supplies it
 * (docs/03). `headers` is the first such analyzer: the CLI has no privileged
 * refetch, so auditing a saved snapshot reports the header checks as unknown
 * rather than passing.
 */
export const analyzers: readonly Analyzer[] = [
  transportAnalyzer,
  headersAnalyzer,
  cspAnalyzer,
  cookiesAnalyzer,
  formsAnalyzer,
  scriptsAnalyzer,
  librariesAnalyzer,
  policyPresenceAnalyzer,
];

export {
  cookiesAnalyzer,
  cspAnalyzer,
  formsAnalyzer,
  headersAnalyzer,
  librariesAnalyzer,
  policyPresenceAnalyzer,
  scriptsAnalyzer,
  transportAnalyzer,
};
