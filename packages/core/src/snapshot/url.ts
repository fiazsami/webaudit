/**
 * URL helpers shared by the builder and the analyzers. Pure; no network, no
 * host APIs.
 */

/**
 * Resolve a possibly-relative URL against the page. Returns undefined rather
 * than throwing — a page is free to contain garbage in an href, and a snapshot
 * records what was observable, not what was well-formed.
 */
export function resolveUrl(href: string, base: string): string | undefined {
  const trimmed = href.trim();
  if (trimmed === "") return undefined;
  try {
    return new URL(trimmed, base).href;
  } catch {
    return undefined;
  }
}

/** Parse without throwing. */
export function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/** True when both URLs share a scheme, host, and port. */
export function isSameOrigin(a: string, b: string): boolean {
  const left = parseUrl(a);
  const right = parseUrl(b);
  if (left === undefined || right === undefined) return false;
  return left.origin === right.origin;
}
