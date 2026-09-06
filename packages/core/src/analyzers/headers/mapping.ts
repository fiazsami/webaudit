import type { Confidence, Severity } from "../../findings/schema.js";

/**
 * Observatory verdicts → our findings (docs/03). MIT; the vendored sources next
 * door are MPL-2.0.
 *
 * One entry per verdict a wired test can return, so an unmapped verdict is a
 * visible gap rather than a silent drop. Verdicts that mean "this is configured
 * correctly" map to `null`: Observatory scores a site, we report problems, and a
 * passing check is not a finding.
 *
 * Kept as a table rather than folded into the analyzer so it can be reviewed
 * against upstream when the library changes.
 */

export interface HeaderRule {
  ruleId: string;
  severity: Severity;
  confidence: Confidence;
  title: string;
  summary: string;
  references?: string[];
}

const MDN = "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers";

/** `null` means "correctly configured" — nothing to report. */
export const HEADER_RULES: Record<string, HeaderRule | null> = {
  // --- Strict-Transport-Security ---------------------------------------
  "hsts-preloaded": null,
  "hsts-implemented-max-age-at-least-six-months": null,
  "hsts-implemented-max-age-less-than-six-months": {
    ruleId: "hsts-max-age-short",
    severity: "low",
    confidence: "high",
    title: "HSTS expires in under six months",
    summary:
      "The site asks browsers to remember HTTPS-only for less than six months. " +
      "A visitor returning after that window can be downgraded to HTTP once.",
    references: [`${MDN}/Strict-Transport-Security`],
  },
  "hsts-not-implemented": {
    ruleId: "hsts-missing",
    severity: "medium",
    confidence: "high",
    title: "No HSTS header",
    summary:
      "Without Strict-Transport-Security a browser will try HTTP first when " +
      "someone types the bare domain, which is the moment a network attacker " +
      "needs to strip the encryption.",
    references: [`${MDN}/Strict-Transport-Security`],
  },
  "hsts-header-invalid": {
    ruleId: "hsts-invalid",
    severity: "medium",
    confidence: "high",
    title: "HSTS header is malformed",
    summary:
      "The Strict-Transport-Security header could not be parsed, so browsers " +
      "will ignore it. The protection it looks like it provides is not there.",
    references: [`${MDN}/Strict-Transport-Security`],
  },
  "hsts-not-implemented-no-https": {
    ruleId: "hsts-no-https",
    severity: "info",
    confidence: "high",
    title: "HSTS not applicable",
    summary: "HSTS only applies over HTTPS, and this response was not.",
  },
  "hsts-invalid-cert": {
    ruleId: "hsts-invalid-cert",
    severity: "high",
    confidence: "medium",
    title: "Certificate chain could not be verified",
    summary: "HSTS requires a valid certificate chain, and this one did not verify.",
  },

  // --- X-Content-Type-Options ------------------------------------------
  "x-content-type-options-nosniff": null,
  "x-content-type-options-not-implemented": {
    ruleId: "x-content-type-options-missing",
    severity: "low",
    confidence: "high",
    title: "No X-Content-Type-Options header",
    summary:
      "Browsers may guess a response's type rather than trusting its " +
      "Content-Type. An uploaded file served as text can be guessed into a script.",
    references: [`${MDN}/X-Content-Type-Options`],
  },
  "x-content-type-options-header-invalid": {
    ruleId: "x-content-type-options-invalid",
    severity: "low",
    confidence: "high",
    title: "X-Content-Type-Options header is malformed",
    summary: "The header's value is not `nosniff`, so browsers ignore it.",
    references: [`${MDN}/X-Content-Type-Options`],
  },

  // --- X-Frame-Options / framing ---------------------------------------
  "x-frame-options-sameorigin-or-deny": null,
  "x-frame-options-implemented-via-csp": null,
  "x-frame-options-allow-from-origin": {
    ruleId: "x-frame-options-deprecated-value",
    severity: "low",
    confidence: "high",
    title: "X-Frame-Options uses ALLOW-FROM",
    summary:
      "ALLOW-FROM is obsolete and ignored by current browsers. The page is " +
      "framable despite the header. `frame-ancestors` in CSP is the replacement.",
    references: [`${MDN}/X-Frame-Options`],
  },
  "x-frame-options-not-implemented": {
    ruleId: "framing-not-restricted",
    severity: "medium",
    confidence: "high",
    title: "Page can be framed by any site",
    summary:
      "Neither X-Frame-Options nor a CSP `frame-ancestors` directive restricts " +
      "framing, so another site can load this page invisibly and collect clicks " +
      "meant for its own UI.",
    references: [`${MDN}/X-Frame-Options`],
  },
  "x-frame-options-header-invalid": {
    ruleId: "x-frame-options-invalid",
    severity: "medium",
    confidence: "high",
    title: "X-Frame-Options header is malformed",
    summary:
      "The header could not be parsed, so browsers ignore it and the page is " +
      "framable.",
    references: [`${MDN}/X-Frame-Options`],
  },

  // --- Referrer-Policy --------------------------------------------------
  "referrer-policy-private": null,
  "referrer-policy-not-implemented": {
    ruleId: "referrer-policy-missing",
    severity: "low",
    confidence: "high",
    title: "No Referrer-Policy header",
    summary:
      "Without a policy, browsers fall back to a default that sends the origin " +
      "cross-site. Paths and query strings can leak through outbound links.",
    references: [`${MDN}/Referrer-Policy`],
  },
  "referrer-policy-unsafe": {
    ruleId: "referrer-policy-unsafe",
    severity: "medium",
    confidence: "high",
    title: "Referrer-Policy leaks full URLs",
    summary:
      "This policy sends the complete URL — path and query included — to other " +
      "sites. Anything identifying in a URL goes with it.",
    references: [`${MDN}/Referrer-Policy`],
  },
  "referrer-policy-header-invalid": {
    ruleId: "referrer-policy-invalid",
    severity: "low",
    confidence: "high",
    title: "Referrer-Policy header is malformed",
    summary: "The policy could not be parsed, so the browser default applies.",
    references: [`${MDN}/Referrer-Policy`],
  },

  // --- Content-Security-Policy -----------------------------------------
  "csp-implemented-with-no-unsafe-default-src-none": null,
  "csp-implemented-with-no-unsafe": null,
  "csp-implemented-with-unsafe-inline-in-style-src-only": {
    ruleId: "csp-unsafe-inline-styles",
    severity: "low",
    confidence: "high",
    title: "CSP allows inline styles",
    summary:
      "`unsafe-inline` is permitted for styles only. That is far weaker than " +
      "allowing inline scripts, but it still enables some data exfiltration " +
      "through CSS selectors.",
    references: [`${MDN}/Content-Security-Policy`],
  },
  "csp-implemented-with-insecure-scheme-in-passive-content-only": {
    ruleId: "csp-insecure-passive-scheme",
    severity: "low",
    confidence: "high",
    title: "CSP allows http: for images and media",
    summary:
      "Passive content may load over plain HTTP, which can be replaced in " +
      "transit and reveals visits to a network observer.",
    references: [`${MDN}/Content-Security-Policy`],
  },
  "csp-implemented-with-unsafe-eval": {
    ruleId: "csp-unsafe-eval",
    severity: "medium",
    confidence: "high",
    title: "CSP allows unsafe-eval",
    summary:
      "`unsafe-eval` lets strings become code. It removes much of the value of " +
      "having a policy, because an injected string can execute.",
    references: [`${MDN}/Content-Security-Policy`],
  },
  "csp-implemented-with-unsafe-inline": {
    ruleId: "csp-unsafe-inline",
    severity: "medium",
    confidence: "high",
    title: "CSP allows unsafe-inline scripts",
    summary:
      "`unsafe-inline` permits inline scripts, which is exactly what a cross-site " +
      "scripting payload is. The policy will not stop the attack it exists for.",
    references: [`${MDN}/Content-Security-Policy`],
  },
  "csp-implemented-with-insecure-scheme": {
    ruleId: "csp-insecure-scheme",
    severity: "medium",
    confidence: "high",
    title: "CSP allows http: sources",
    summary:
      "Active content may load over plain HTTP, so a network attacker can " +
      "substitute a script the policy would otherwise have blocked.",
    references: [`${MDN}/Content-Security-Policy`],
  },
  "csp-implemented-but-duplicate-directives": {
    ruleId: "csp-duplicate-directives",
    severity: "low",
    confidence: "medium",
    title: "CSP repeats a directive",
    summary:
      "A directive appears more than once. Browsers keep the first and ignore " +
      "the rest, so the policy in force may not be the one intended.",
    references: [`${MDN}/Content-Security-Policy`],
  },
  "csp-header-invalid": {
    ruleId: "csp-invalid",
    severity: "medium",
    confidence: "high",
    title: "CSP header is malformed",
    summary:
      "The policy could not be parsed. A policy that does not parse protects " +
      "nothing while looking like it does.",
    references: [`${MDN}/Content-Security-Policy`],
  },
  "csp-not-implemented": {
    ruleId: "csp-missing",
    severity: "medium",
    confidence: "high",
    title: "No Content-Security-Policy",
    summary:
      "There is no policy restricting where scripts, styles, and frames may " +
      "come from, so an injected script runs with the page's full privileges.",
    references: [`${MDN}/Content-Security-Policy`],
  },
  "csp-not-implemented-but-reporting-enabled": {
    ruleId: "csp-report-only",
    severity: "low",
    confidence: "high",
    title: "CSP is report-only",
    summary:
      "A policy exists but only reports violations; nothing is blocked. This is " +
      "the normal way to roll one out, and it is not yet protecting anyone.",
    references: [`${MDN}/Content-Security-Policy-Report-Only`],
  },

  // --- CORS -------------------------------------------------------------
  "cross-origin-resource-sharing-not-implemented": null,
  "cross-origin-resource-sharing-implemented-with-public-access": null,
  "cross-origin-resource-sharing-implemented-with-restricted-access": null,
  "cross-origin-resource-sharing-implemented-with-universal-access": {
    ruleId: "cors-universal-access",
    severity: "high",
    confidence: "high",
    title: "CORS allows any site to read responses with credentials",
    summary:
      "The response permits any origin to read it while sending credentials. " +
      "Any website a signed-in visitor opens can read their data here.",
    references: [`${MDN}/Access-Control-Allow-Origin`],
  },

  // --- Cross-origin isolation (COEP / COOP / CORP) ----------------------
  // Absence is the web's default and extremely common. Reported as info: worth
  // knowing, not worth alarming about.
  "coep-implemented-with-require-corp": null,
  "coep-implemented-with-credentialless": null,
  "coep-implemented-with-unsafe-none": null,
  "coep-not-implemented": null,
  "coep-header-invalid": {
    ruleId: "coep-invalid",
    severity: "info",
    confidence: "high",
    title: "Cross-Origin-Embedder-Policy is malformed",
    summary: "The header could not be parsed and is ignored.",
  },

  "coop-implemented-with-same-origin": null,
  "coop-implemented-with-same-origin-allow-popups": null,
  "coop-implemented-with-noopener-allow-popups": null,
  "coop-implemented-with-unsafe-none": {
    ruleId: "coop-unsafe-none",
    severity: "info",
    confidence: "high",
    title: "Cross-Origin-Opener-Policy is unsafe-none",
    summary:
      "A page this one opens, or that opens it, keeps a reference across the " +
      "origin boundary. This is the browser default, and stating it explicitly " +
      "usually means it was considered.",
  },
  "coop-not-implemented": {
    ruleId: "coop-missing",
    severity: "info",
    confidence: "medium",
    title: "No Cross-Origin-Opener-Policy",
    summary:
      "Windows this page opens share a browsing context group with it. Setting " +
      "`same-origin` severs that, and is a prerequisite for cross-origin isolation.",
    references: [`${MDN}/Cross-Origin-Opener-Policy`],
  },
  "coop-header-invalid": {
    ruleId: "coop-invalid",
    severity: "info",
    confidence: "high",
    title: "Cross-Origin-Opener-Policy is malformed",
    summary: "The header could not be parsed and is ignored.",
  },

  "corp-implemented-with-same-origin": null,
  "corp-implemented-with-same-site": null,
  "corp-implemented-with-cross-origin": null,
  "corp-not-implemented": null,
  "corp-header-invalid": {
    ruleId: "corp-invalid",
    severity: "info",
    confidence: "high",
    title: "Cross-Origin-Resource-Policy is malformed",
    summary: "The header could not be parsed and is ignored.",
  },
};

/** Which response header a verdict came from, for the finding's evidence. */
export const VERDICT_HEADER: Record<string, string> = {
  hsts: "strict-transport-security",
  csp: "content-security-policy",
  cors: "access-control-allow-origin",
  coep: "cross-origin-embedder-policy",
  coop: "cross-origin-opener-policy",
  corp: "cross-origin-resource-policy",
};
