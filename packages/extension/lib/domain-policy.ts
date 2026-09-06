/**
 * Which URLs an audit is allowed to fetch (docs/07, docs/12 T2).
 *
 * The background worker calls this against its own stored copy of the audit's
 * allowlist. It never checks a URL against a list the *same message* supplied —
 * that would be asking the caller whether the caller is permitted. Enforcement
 * belongs with the capability, not with its requester.
 */

/** Only these schemes are ever fetchable. No file:, no data:, no chrome-extension:. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Refused as an allowlist entry.
 *
 * An allowlist is built from the audited page's own hostname, so a bare public
 * suffix should never appear in one. If a bug ever put "com" or "co.uk" there,
 * subdomain matching would silently open the entire suffix. This is a short
 * denylist rather than a real public-suffix list — `tldts` arrives in M3 for the
 * trackers analyzer and this should switch to it then.
 */
const REFUSED_ENTRIES = new Set([
  "com",
  "org",
  "net",
  "edu",
  "gov",
  "mil",
  "int",
  "io",
  "co",
  "dev",
  "app",
  "co.uk",
  "org.uk",
  "ac.uk",
  "com.au",
  "co.jp",
  "com.br",
  "co.in",
  "localhost",
]);

export type DomainVerdict =
  { allowed: true; hostname: string } | { allowed: false; reason: string };

export function normalizeAllowedDomain(domain: string): string | undefined {
  const normalized = domain
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
  if (normalized === "" || REFUSED_ENTRIES.has(normalized)) return undefined;
  if (!normalized.includes(".")) return undefined;
  return normalized;
}

/** Drop anything unusable so a bad entry cannot widen the list. */
export function normalizeAllowedDomains(domains: readonly string[]): string[] {
  const normalized = domains
    .map(normalizeAllowedDomain)
    .filter((domain): domain is string => domain !== undefined);
  return [...new Set(normalized)];
}

export function checkUrlAllowed(
  url: string,
  allowedDomains: readonly string[],
): DomainVerdict {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: "not a URL" };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { allowed: false, reason: `scheme ${parsed.protocol} is never fetchable` };
  }

  // Credentials in a URL are a redirect-and-exfiltrate shape, not something a
  // policy page needs.
  if (parsed.username !== "" || parsed.password !== "") {
    return { allowed: false, reason: "URL carries credentials" };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "") return { allowed: false, reason: "URL has no host" };

  for (const domain of allowedDomains) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return { allowed: true, hostname };
    }
  }

  return { allowed: false, reason: `${hostname} is not in this audit's allowlist` };
}

/** The allowlist an audit starts with: the audited page's own host. */
export function allowlistForPage(pageUrl: string): string[] {
  try {
    return normalizeAllowedDomains([new URL(pageUrl).hostname]);
  } catch {
    return [];
  }
}
