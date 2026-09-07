import type { PageSnapshot, PolicyHint } from "../snapshot/schema.js";
import { parseUrl } from "../snapshot/url.js";

/**
 * Stage 1: where might this site's policies be (docs/05).
 *
 * Two sources, in order of confidence. Links the page actually carries come
 * first — the site told us where its policy is. Guessed paths come after, and
 * only on the same registrable domain, because a guess that wanders to another
 * domain is a request to somewhere nobody asked us to go.
 */

export interface PolicyCandidate {
  url: string;
  hint: PolicyHint;
  /** How we found it. A linked policy is a fact; a guessed path is a guess. */
  source: "link" | "common-path";
}

/** Tried in this order when the page links nothing useful. */
const COMMON_PATHS: ReadonlyArray<{ path: string; hint: PolicyHint }> = [
  { path: "/privacy", hint: "privacy" },
  { path: "/privacy-policy", hint: "privacy" },
  { path: "/terms", hint: "terms" },
  { path: "/terms-of-service", hint: "terms" },
  { path: "/tos", hint: "terms" },
  { path: "/legal", hint: "other" },
];

/** Which policies are worth reading, best first. */
const HINT_ORDER: readonly PolicyHint[] = ["privacy", "terms", "cookies", "other"];

export interface DiscoverOptions {
  /**
   * The audit's allowed domains. A candidate outside them is not produced at
   * all — the worker would refuse it anyway (docs/12 T2), and generating URLs
   * we know will be rejected only makes the logs confusing.
   */
  allowedDomains?: readonly string[];
  /** How many to return. Each one costs a fetch and minutes of model time. */
  limit?: number;
}

export function discoverPolicies(
  snapshot: PageSnapshot,
  options: DiscoverOptions = {},
): PolicyCandidate[] {
  const limit = options.limit ?? 3;
  const pageUrl = parseUrl(snapshot.url);
  if (pageUrl === undefined) return [];

  const candidates: PolicyCandidate[] = [];
  const seen = new Set<string>();

  const add = (
    url: string,
    hint: PolicyHint,
    source: PolicyCandidate["source"],
  ): void => {
    const normalized = normalize(url);
    if (normalized === undefined || seen.has(normalized)) return;
    if (!isAllowed(normalized, snapshot.url, options.allowedDomains)) return;
    seen.add(normalized);
    candidates.push({ url: normalized, hint, source });
  };

  for (const hint of HINT_ORDER) {
    for (const link of snapshot.links) {
      if (link.policyHint === hint) add(link.href, hint, "link");
    }
  }

  for (const { path, hint } of COMMON_PATHS) {
    add(new URL(path, pageUrl.origin).href, hint, "common-path");
  }

  return candidates.slice(0, limit);
}

/** Drop the fragment: the same document, and a needless second fetch. */
function normalize(url: string): string | undefined {
  const parsed = parseUrl(url);
  if (parsed === undefined) return undefined;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  return `${parsed.origin}${parsed.pathname}${parsed.search}`;
}

function isAllowed(
  url: string,
  pageUrl: string,
  allowedDomains: readonly string[] | undefined,
): boolean {
  const target = parseUrl(url);
  const page = parseUrl(pageUrl);
  if (target === undefined || page === undefined) return false;

  if (allowedDomains === undefined) {
    // Without an explicit list, the page's own host is the whole of it.
    return target.hostname === page.hostname;
  }

  return allowedDomains.some(
    (domain) => target.hostname === domain || target.hostname.endsWith(`.${domain}`),
  );
}
