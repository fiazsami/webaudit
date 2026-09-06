import { createFinding, type Finding } from "../../findings/schema.js";
import type { PageSnapshot } from "../../snapshot/schema.js";
import type { Analyzer, AnalyzerContext } from "../types.js";
import { HEADER_RULES, VERDICT_HEADER, type HeaderRule } from "./mapping.js";
import { setHstsPreloadList } from "./vendor/hsts.js";
import { crossOriginEmbedderPolicyTest } from "./vendor/tests/cross-origin-embedder-policy.js";
import { crossOriginOpenerPolicyTest } from "./vendor/tests/cross-origin-opener-policy.js";
import { crossOriginResourcePolicyTest } from "./vendor/tests/cross-origin-resource-policy.js";
import { contentSecurityPolicyTest } from "./vendor/tests/csp.js";
import { referrerPolicyTest } from "./vendor/tests/referrer-policy.js";
import { strictTransportSecurityTest } from "./vendor/tests/strict-transport-security.js";
import { xContentTypeOptionsTest } from "./vendor/tests/x-content-type-options.js";
import { xFrameOptionsTest } from "./vendor/tests/x-frame-options.js";

const ANALYZER_ID = "headers";

/**
 * Response-header analysis, on top of the vendored Observatory scoring sources
 * (docs/03).
 *
 * Nothing here makes a network request. The background worker refetched the page
 * and the headers arrive through `AnalyzerContext`.
 *
 * The vendor's own reference links are not preserved — it has none; it returns
 * verdict strings. `mapping.ts` supplies references instead, which is where the
 * "preserve the library's links" convention lands for this particular library.
 */

/**
 * The shape the vendored tests read. It is modelled on an axios response,
 * because upstream ran on axios; we build one from a single fetch.
 */
/**
 * Upstream ran on axios, whose header bag is enumerable *and* has `get`. The
 * vendored tests use both: `getHttpHeaders` walks `Object.entries`, while
 * csp.js reaches for `.get()`. Ours has to do the same, and `get` is attached
 * non-enumerably so it does not appear as a header named "get".
 */
type VendorHeaders = Record<string, string | string[]> & {
  get(name: string): string | string[] | undefined;
};

interface VendorResponse {
  status: number;
  url: string;
  headers: VendorHeaders;
  /**
   * A valid certificate chain, which the HSTS test requires. Set for any
   * successful HTTPS fetch: the browser refuses a bad chain before a response
   * ever reaches us, so having one is the evidence (docs/03, S1 result).
   */
  verified: boolean;
}

interface VendorRequests {
  hostname: string;
  site: { hostname: string };
  session: { url: string };
  responses: {
    auto: VendorResponse | null;
    cors: VendorResponse | null;
    http: VendorResponse | null;
    https: VendorResponse | null;
    httpRedirects: never[];
    httpsRedirects: never[];
  };
}

type VendorTest = (requests: never) => { result?: string };

/** Verdict prefix → the test that produces it. Order is the display order. */
/**
 * Verdict prefix → the test that produces it. Order is the display order.
 *
 * CORS is deliberately absent. Its only interesting verdict — a server
 * reflecting an attacker's Origin back while allowing credentials — requires a
 * probe request carrying an `Origin` header, and the background worker sends a
 * plain fetch. Wired as-is it could only ever return verdicts we treat as fine,
 * which would look like a passing check rather than an absent one. See
 * `vendor/README.md`.
 */
const TESTS: ReadonlyArray<readonly [string, VendorTest]> = [
  ["hsts", strictTransportSecurityTest as VendorTest],
  ["csp", contentSecurityPolicyTest as VendorTest],
  ["xfo", xFrameOptionsTest as VendorTest],
  ["xcto", xContentTypeOptionsTest as VendorTest],
  ["referrer", referrerPolicyTest as VendorTest],
  ["coop", crossOriginOpenerPolicyTest as VendorTest],
  ["coep", crossOriginEmbedderPolicyTest as VendorTest],
  ["corp", crossOriginResourcePolicyTest as VendorTest],
];

export const headersAnalyzer: Analyzer = {
  id: ANALYZER_ID,
  needs: ["headers"],

  run(snapshot: PageSnapshot, ctx: AnalyzerContext): Promise<Finding[]> {
    const headers = ctx.headers ?? {};
    const requests = buildRequests(snapshot, headers);
    const findings: Finding[] = [];

    for (const [name, test] of TESTS) {
      let verdict: string | undefined;
      try {
        // One failed test must not lose the other eight (docs/03).
        verdict = test(requests as never).result;
      } catch (error) {
        ctx.logger.warn(`headers: ${name} test threw`, error);
        continue;
      }

      if (verdict === undefined) continue;

      const rule = HEADER_RULES[verdict];
      if (rule === null) continue; // correctly configured — not a finding
      if (rule === undefined) {
        // An unmapped verdict is a gap in mapping.ts, not something to drop
        // silently. Upstream added a result we have not reviewed.
        ctx.logger.warn(`headers: no mapping for verdict "${verdict}"`);
        continue;
      }

      findings.push(toFinding(rule, name, verdict, headers));
    }

    return Promise.resolve(findings);
  },
};

function toFinding(
  rule: HeaderRule,
  testName: string,
  verdict: string,
  headers: Record<string, string>,
): Finding {
  const headerName = VERDICT_HEADER[testName];
  const observed = headerName === undefined ? undefined : headers[headerName];

  return createFinding({
    analyzerId: ANALYZER_ID,
    ruleId: rule.ruleId,
    severity: rule.severity,
    confidence: rule.confidence,
    title: rule.title,
    summary: rule.summary,
    evidence: [
      observed === undefined
        ? { kind: "header", value: verdict, location: headerName ?? testName }
        : { kind: "header", value: observed.slice(0, 1000), location: headerName },
    ],
    references: rule.references ?? [],
    tags: ["headers"],
  });
}

function buildRequests(
  snapshot: PageSnapshot,
  headers: Record<string, string>,
): VendorRequests {
  const isHttps = snapshot.protocol === "https:";
  const hostname = hostnameOf(snapshot.url);
  const response: VendorResponse = {
    status: 200,
    url: snapshot.url,
    headers: vendorHeaders(headers),
    verified: isHttps,
  };

  return {
    hostname,
    site: { hostname },
    session: { url: snapshot.url },
    responses: {
      auto: response,
      // No CORS probe: see the TESTS comment above.
      cors: null,
      http: isHttps ? null : response,
      https: isHttps ? response : null,
      httpRedirects: [],
      httpsRedirects: [],
    },
  };
}

/**
 * Build the axios-shaped header bag the vendored tests expect.
 *
 * Two adjustments to what `Http` hands us. `Http.headers` collapses repeats into
 * one comma-joined string, which is wrong for Set-Cookie, where values
 * legitimately contain commas — the vendor wants an array there. And `get` is
 * attached non-enumerably, so the tests that call it work without it showing up
 * as a header to the tests that enumerate.
 */
function vendorHeaders(headers: Record<string, string>): VendorHeaders {
  const bag: Record<string, string | string[]> = { ...headers };

  const setCookie = headers["set-cookie"];
  if (setCookie !== undefined) {
    bag["set-cookie"] = setCookie.split(/,(?=[^;=]+=)/).map((part) => part.trim());
  }

  Object.defineProperty(bag, "get", {
    enumerable: false,
    value: (name: string) => bag[name.toLowerCase()],
  });

  return bag as VendorHeaders;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export { setHstsPreloadList };
