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
 * Names that are not sites, only categories of site.
 *
 * An allowlist is built from the audited page's own hostname, so one of these
 * should never appear in it. If a bug ever put "com" there, subdomain matching
 * would open the entire suffix. This is a short denylist rather than a real
 * public-suffix list — `tldts` is already a dependency for the trackers
 * analyzer and this should switch to it.
 */
const PUBLIC_SUFFIXES = new Set([
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
]);

export type DomainVerdict =
  { allowed: true; hostname: string } | { allowed: false; reason: string };

export function normalizeAllowedDomain(domain: string): string | undefined {
  const normalized = domain
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");

  if (normalized === "") return undefined;
  // A suffix is a category of site, not a site. Nothing else is refused here:
  // `localhost`, an intranet name and an IP address are all real hosts someone
  // may legitimately be auditing, and refusing them meant refusing to fetch the
  // very page under audit.
  if (PUBLIC_SUFFIXES.has(normalized)) return undefined;
  return normalized;
}

/**
 * May this entry match subdomains, or only itself?
 *
 * Subdomain matching is the part that can over-reach, so it is limited to
 * dotted names that are not IP addresses. `localhost` matches `localhost` and
 * nothing else; `example.com` also matches `legal.example.com`.
 */
function allowsSubdomains(domain: string): boolean {
  if (!domain.includes(".")) return false;
  return !/^\d{1,3}(\.\d{1,3}){3}$/.test(domain);
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
    const matches =
      hostname === domain ||
      (allowsSubdomains(domain) && hostname.endsWith(`.${domain}`));
    if (matches) return { allowed: true, hostname };
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
