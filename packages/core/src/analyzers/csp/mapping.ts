import { Type } from "csp_evaluator/dist/finding.js";

import type { Confidence, Severity } from "../../findings/schema.js";

/**
 * `csp_evaluator` finding types → our findings (docs/03).
 *
 * **Division of labour with the headers analyzer.** The vendored Observatory
 * sources already score a CSP as a whole and report the headline problems:
 * missing policy, unsafe-inline, unsafe-eval, insecure schemes. Repeating those
 * here would produce two findings for one problem, so this table maps only what
 * csp_evaluator adds — directive-level structure that Observatory's single
 * verdict cannot express: missing object-src and base-uri, wildcards, known
 * allowlist bypasses, IP sources, deprecated directives, and syntax errors.
 *
 * A type absent from this table is deliberately not reported. That is a
 * judgement about overlap, not a gap.
 */

export interface CspRule {
  ruleId: string;
  severity: Severity;
  confidence: Confidence;
  title: string;
  summary: string;
}

const CSP_DOCS =
  "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy";

export const CSP_REFERENCES = [CSP_DOCS];

export const CSP_RULES: Partial<Record<Type, CspRule>> = {
  [Type.MISSING_DIRECTIVES]: {
    ruleId: "csp-missing-directive",
    severity: "medium",
    confidence: "high",
    title: "CSP is missing a directive that has no safe fallback",
    summary:
      "`object-src` and `base-uri` do not fall back to `default-src` in every " +
      "browser. Without them, a policy that looks complete can still allow a " +
      "plugin object or a rewritten <base> to redirect relative script URLs.",
  },
  [Type.SCRIPT_ALLOWLIST_BYPASS]: {
    ruleId: "csp-script-allowlist-bypass",
    severity: "high",
    confidence: "high",
    title: "CSP allowlists a host that can be used to bypass it",
    summary:
      "An allowlisted origin hosts endpoints — JSONP callbacks, or an entire " +
      "CDN of arbitrary libraries — that let an attacker execute chosen code " +
      "while staying inside the policy. The allowlist is decorative here.",
  },
  [Type.OBJECT_ALLOWLIST_BYPASS]: {
    ruleId: "csp-object-allowlist-bypass",
    severity: "medium",
    confidence: "high",
    title: "CSP allowlists a host that can serve active plugin content",
    summary:
      "An origin allowed for `object-src` can serve content that executes, " +
      "which routes around the rest of the policy.",
  },
  [Type.PLAIN_WILDCARD]: {
    ruleId: "csp-wildcard-source",
    severity: "high",
    confidence: "high",
    title: "CSP allows any origin",
    summary:
      "A bare `*` permits scripts from anywhere, which leaves the policy with " +
      "nothing to enforce.",
  },
  [Type.WILDCARD_URL]: {
    ruleId: "csp-wildcard-url",
    severity: "medium",
    confidence: "high",
    title: "CSP allows a whole domain by wildcard",
    summary:
      "A wildcard host trusts every subdomain, including any that a third " +
      "party controls or that is left dangling after a service is retired.",
  },
  [Type.PLAIN_URL_SCHEMES]: {
    ruleId: "csp-permissive-scheme",
    severity: "high",
    confidence: "high",
    title: "CSP allows a scheme rather than an origin",
    summary:
      "Allowing a bare scheme such as `data:` or `https:` permits any content " +
      "carried by it. `data:` in particular lets an injected string become a " +
      "script URL.",
  },
  [Type.IP_SOURCE]: {
    ruleId: "csp-ip-source",
    severity: "low",
    confidence: "high",
    title: "CSP allowlists an IP address",
    summary:
      "IP sources are usually a development leftover. They are also not matched " +
      "the way a hostname is, so the entry may not do what it appears to.",
  },
  [Type.SRC_HTTP]: {
    ruleId: "csp-http-source",
    severity: "medium",
    confidence: "high",
    title: "CSP allowlists an http: origin",
    summary:
      "A source reachable over plain HTTP can be replaced in transit, so the " +
      "policy permits an attacker-supplied script.",
  },
  [Type.NONCE_LENGTH]: {
    ruleId: "csp-nonce-too-short",
    severity: "medium",
    confidence: "high",
    title: "CSP nonce is too short to be unguessable",
    summary:
      "A nonce shorter than 8 characters can be guessed or brute-forced, which " +
      "defeats the point of using one.",
  },
  [Type.STATIC_NONCE]: {
    ruleId: "csp-static-nonce",
    severity: "high",
    confidence: "high",
    title: "CSP nonce appears to be reused",
    summary:
      "A nonce must be regenerated per response. A fixed one can be copied into " +
      "an injected script, which makes it a password the attacker already has.",
  },
  [Type.SCRIPT_UNSAFE_HASHES]: {
    ruleId: "csp-unsafe-hashes",
    severity: "medium",
    confidence: "high",
    title: "CSP allows unsafe-hashes",
    summary:
      "`unsafe-hashes` permits inline event handlers whose contents match a " +
      "hash, which reopens a category of injection the policy otherwise closes.",
  },
  [Type.DEPRECATED_DIRECTIVE]: {
    ruleId: "csp-deprecated-directive",
    severity: "low",
    confidence: "high",
    title: "CSP uses a deprecated directive",
    summary:
      "Browsers ignore this directive. Whatever it was meant to restrict is " +
      "unrestricted.",
  },
  [Type.UNKNOWN_DIRECTIVE]: {
    ruleId: "csp-unknown-directive",
    severity: "low",
    confidence: "medium",
    title: "CSP contains an unrecognised directive",
    summary:
      "Browsers ignore directives they do not know. Usually a typo, and a typo " +
      "in a policy is a silently missing restriction.",
  },
  [Type.MISSING_SEMICOLON]: {
    ruleId: "csp-missing-semicolon",
    severity: "medium",
    confidence: "high",
    title: "CSP directive is missing a semicolon",
    summary:
      "A missing separator turns the next directive's name into a source value, " +
      "so both directives end up meaning something other than intended.",
  },
  [Type.INVALID_KEYWORD]: {
    ruleId: "csp-invalid-keyword",
    severity: "low",
    confidence: "high",
    title: "CSP contains an invalid keyword",
    summary:
      "A keyword the browser does not recognise is dropped, along with whatever " +
      "it was meant to allow or forbid.",
  },
};
