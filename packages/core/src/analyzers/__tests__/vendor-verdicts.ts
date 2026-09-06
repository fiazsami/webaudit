import { CrossOriginEmbedderPolicyOutput } from "../headers/vendor/tests/cross-origin-embedder-policy.js";
import { CrossOriginOpenerPolicyOutput } from "../headers/vendor/tests/cross-origin-opener-policy.js";
import { CrossOriginResourcePolicyOutput } from "../headers/vendor/tests/cross-origin-resource-policy.js";
import { CspOutput } from "../headers/vendor/tests/csp.js";
import { ReferrerOutput } from "../headers/vendor/tests/referrer-policy.js";
import { StrictTransportSecurityOutput } from "../headers/vendor/tests/strict-transport-security.js";
import { XContentTypeOptionsOutput } from "../headers/vendor/tests/x-content-type-options.js";
import { XFrameOptionsOutput } from "../headers/vendor/tests/x-frame-options.js";

/**
 * Every verdict the *wired* tests can return (CORS is not wired — see
 * `headers/index.ts`), read from the vendor's own
 * `possibleResults` rather than transcribed. A verdict upstream adds shows up
 * here automatically, which is what makes the mapping-completeness test able to
 * fail.
 */
const OUTPUTS = [
  StrictTransportSecurityOutput,
  CspOutput,
  XFrameOptionsOutput,
  XContentTypeOptionsOutput,
  ReferrerOutput,
  CrossOriginOpenerPolicyOutput,
  CrossOriginEmbedderPolicyOutput,
  CrossOriginResourcePolicyOutput,
];

export const possibleVerdicts: string[] = [
  ...new Set(
    OUTPUTS.flatMap(
      (output) => (output as unknown as { possibleResults: string[] }).possibleResults,
    ),
  ),
];
