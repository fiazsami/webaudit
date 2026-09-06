import type { DomDocumentLike } from "./dom.js";
import {
  type CookieRef,
  type FormRef,
  type IframeRef,
  type Limitation,
  type LinkRef,
  type PageSnapshot,
  type PolicyHint,
  type ScriptRef,
  type ThirdPartyRequest,
  SNAPSHOT_LIMITS,
  SNAPSHOT_SCHEMA_VERSION,
} from "./schema.js";
import { resolveUrl } from "./url.js";

/**
 * The pure snapshot builder (docs/02).
 *
 * The content script and the CLI's fixture tooling both call this, so a live
 * capture and a saved fixture cannot drift apart. It reads only through the DOM
 * port in `dom.ts`, so it has no idea whether it is looking at a browser or at
 * linkedom.
 */

export interface BuildSnapshotOptions {
  /** The page URL. Relative hrefs resolve against it. */
  url: string;
  /** ISO 8601. Supplied by the caller because core has no clock (docs/01). */
  capturedAt: string;

  /**
   * Cookie flags, which only `chrome.cookies` can see. Omit them and the
   * snapshot records the `no-cookie-flags` limitation, so analyzers report
   * "unknown" rather than "missing".
   */
  cookies?: readonly CookieRef[];

  /** Requires the optional `webRequest` permission; omit and it is recorded. */
  thirdPartyRequests?: readonly ThirdPartyRequest[];

  /**
   * Hashes an inline script's source. core cannot do this itself — SubtleCrypto
   * is a host API — so a host that wants inline hashes passes one in. Without
   * it only the length is recorded.
   */
  hashInlineScript?: (source: string) => Promise<string>;

  /** Limitations the host already knows about, e.g. a CSP that blocked us. */
  limitations?: readonly Limitation[];
}

/** Script attributes worth keeping. The port cannot enumerate attributes. */
const SCRIPT_ATTRS = [
  "async",
  "defer",
  "type",
  "nonce",
  "integrity",
  "crossorigin",
] as const;

export async function buildSnapshot(
  doc: DomDocumentLike,
  options: BuildSnapshotOptions,
): Promise<PageSnapshot> {
  const { url, capturedAt } = options;
  const limitations = new Set<Limitation>(options.limitations ?? []);

  const scripts = await collectScripts(doc, url, options.hashInlineScript);
  const iframes = collectIframes(doc);
  const forms = collectForms(doc, url);

  const allLinks = collectLinks(doc, url);
  const links = allLinks.slice(0, SNAPSHOT_LIMITS.maxLinks);
  if (allLinks.length > links.length) limitations.add("links-truncated");

  const allRequests = options.thirdPartyRequests ?? [];
  const thirdPartyRequests = allRequests.slice(
    0,
    SNAPSHOT_LIMITS.maxThirdPartyRequests,
  );
  if (allRequests.length > thirdPartyRequests.length) {
    limitations.add("third-party-requests-truncated");
  }

  const fullText = normalizeWhitespace(doc.body?.textContent ?? "");
  const textExcerpt = fullText.slice(0, SNAPSHOT_LIMITS.maxTextExcerpt);
  if (fullText.length > textExcerpt.length) limitations.add("text-truncated");

  if (options.cookies === undefined) limitations.add("no-cookie-flags");
  if (options.thirdPartyRequests === undefined) {
    limitations.add("no-webrequest-permission");
  }

  const protocol = url.startsWith("http:") ? "http:" : "https:";

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    capturedAt,
    url,
    title: doc.title.slice(0, 500),
    protocol,
    scripts,
    forms,
    iframes,
    links,
    metaTags: collectMetaTags(doc),
    hasMixedContent: hasMixedContent(protocol, scripts, iframes),
    textExcerpt,
    cookies: [...(options.cookies ?? [])],
    thirdPartyRequests: [...thirdPartyRequests],
    limitations: [...limitations].sort(),
  };
}

async function collectScripts(
  doc: DomDocumentLike,
  base: string,
  hashInlineScript: BuildSnapshotOptions["hashInlineScript"],
): Promise<ScriptRef[]> {
  const scripts: ScriptRef[] = [];

  for (const element of doc.querySelectorAll("script")) {
    const attrs: Record<string, string> = {};
    for (const name of SCRIPT_ATTRS) {
      const value = element.getAttribute(name);
      if (value !== null) attrs[name] = value;
    }

    const rawSrc = element.getAttribute("src");
    if (rawSrc !== null) {
      const src = resolveUrl(rawSrc, base);
      // An unresolvable src is still a script tag we saw; record it without one.
      scripts.push(src === undefined ? { attrs } : { src, attrs });
      continue;
    }

    const source = element.textContent ?? "";
    const inlineSha256 =
      hashInlineScript === undefined ? undefined : await hashInlineScript(source);
    scripts.push(
      inlineSha256 === undefined
        ? { inlineLength: source.length, attrs }
        : { inlineLength: source.length, inlineSha256, attrs },
    );
  }

  return scripts;
}

function collectForms(doc: DomDocumentLike, base: string): FormRef[] {
  const forms: FormRef[] = [];

  for (const element of doc.querySelectorAll("form")) {
    const rawAction = element.getAttribute("action");
    // A form with no action submits to the page itself.
    const action = rawAction === null ? base : (resolveUrl(rawAction, base) ?? base);

    const rawMethod = (element.getAttribute("method") ?? "GET").toUpperCase();
    const method: FormRef["method"] =
      rawMethod === "GET" || rawMethod === "POST" ? rawMethod : "other";

    const fieldTypes: string[] = [];
    for (const field of element.querySelectorAll("input")) {
      fieldTypes.push((field.getAttribute("type") ?? "text").toLowerCase());
    }

    forms.push({
      action,
      method,
      fieldTypes,
      hasPasswordField: fieldTypes.includes("password"),
      autocompleteOff:
        (element.getAttribute("autocomplete") ?? "").toLowerCase() === "off",
    });
  }

  return forms;
}

function collectIframes(doc: DomDocumentLike): IframeRef[] {
  const iframes: IframeRef[] = [];

  for (const element of doc.querySelectorAll("iframe")) {
    const src = element.getAttribute("src");
    const sandbox = element.getAttribute("sandbox");
    const iframe: IframeRef = {};
    if (src !== null) iframe.src = src;
    if (sandbox !== null) iframe.sandbox = sandbox;
    iframes.push(iframe);
  }

  return iframes;
}

function collectLinks(doc: DomDocumentLike, base: string): LinkRef[] {
  const links: LinkRef[] = [];
  const seen = new Set<string>();

  for (const element of doc.querySelectorAll("a[href]")) {
    const rawHref = element.getAttribute("href");
    if (rawHref === null) continue;

    const href = resolveUrl(rawHref, base);
    if (href === undefined || seen.has(href)) continue;
    // Only http(s) links are navigable targets we care about; mailto, tel, and
    // javascript: are noise here.
    if (!href.startsWith("http:") && !href.startsWith("https:")) continue;
    seen.add(href);

    const text = normalizeWhitespace(element.textContent ?? "").slice(0, 200);
    const rel = element.getAttribute("rel");
    const policyHint = classifyPolicyLink(href, text);

    const link: LinkRef = { href, text };
    if (rel !== null) link.rel = rel;
    if (policyHint !== undefined) link.policyHint = policyHint;
    links.push(link);
  }

  return links;
}

function collectMetaTags(doc: DomDocumentLike): Record<string, string> {
  const metaTags: Record<string, string> = {};

  for (const element of doc.querySelectorAll("meta")) {
    const key =
      element.getAttribute("name") ??
      element.getAttribute("property") ??
      element.getAttribute("http-equiv");
    const content = element.getAttribute("content");
    if (key === null || content === null) continue;
    metaTags[key.toLowerCase()] = content;
  }

  return metaTags;
}

/**
 * A heuristic, and labelled as one: it seeds the ToS pipeline's discovery stage
 * (docs/05), which re-checks anything it follows.
 */
function classifyPolicyLink(href: string, text: string): PolicyHint | undefined {
  const haystack = `${href} ${text}`.toLowerCase();
  if (/privacy|datenschutz|gdpr/.test(haystack)) return "privacy";
  if (/cookie/.test(haystack)) return "cookies";
  if (/terms|\btos\b|conditions|\beula\b|user-agreement/.test(haystack)) {
    return "terms";
  }
  if (/legal|policies|policy|imprint|impressum/.test(haystack)) return "other";
  return undefined;
}

/** An https page loading an http subresource. */
function hasMixedContent(
  protocol: PageSnapshot["protocol"],
  scripts: readonly ScriptRef[],
  iframes: readonly IframeRef[],
): boolean {
  if (protocol !== "https:") return false;
  const insecure = (value: string | undefined): boolean =>
    value !== undefined && value.startsWith("http:");
  return (
    scripts.some((script) => insecure(script.src)) ||
    iframes.some((iframe) => insecure(iframe.src))
  );
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
