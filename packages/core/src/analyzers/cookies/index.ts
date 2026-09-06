import { createFinding, type Finding } from "../../findings/schema.js";
import type { CookieRef, PageSnapshot } from "../../snapshot/schema.js";
import type { Analyzer } from "../types.js";

const ANALYZER_ID = "cookies";

/** A cookie outliving this is treated as long-lived (docs/03). */
const LONG_LIVED_DAYS = 400;
const SECONDS_PER_DAY = 86_400;

/**
 * Cookie flags (docs/03).
 *
 * Flags are visible only through `chrome.cookies`; `document.cookie` cannot see
 * them. When the capture could not read them the snapshot says so, and this
 * analyzer reports "unknown" rather than inventing a page's worth of missing
 * flags — the whole point of the `limitations` array (docs/02).
 */
export const cookiesAnalyzer: Analyzer = {
  id: ANALYZER_ID,
  needs: [],

  run(snapshot: PageSnapshot): Promise<Finding[]> {
    if (snapshot.limitations.includes("no-cookie-flags")) {
      return Promise.resolve([
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "cookie-flags-unknown",
          severity: "info",
          confidence: "high",
          title: "Cookie flags could not be read",
          summary:
            "This capture could not read cookie attributes, so Secure, HttpOnly " +
            "and SameSite are unknown for every cookie on this site — not absent.",
          evidence: [{ kind: "cookie", value: "no-cookie-flags" }],
          tags: ["cookies"],
        }),
      ]);
    }

    const findings: Finding[] = [];
    const insecure = snapshot.cookies.filter((cookie) => cookie.secure === false);
    const readable = snapshot.cookies.filter((cookie) => cookie.httpOnly === false);
    const crossSite = snapshot.cookies.filter(
      (cookie) => cookie.sameSite === "none" && cookie.secure !== true,
    );
    const unspecified = snapshot.cookies.filter(
      (cookie) => cookie.sameSite === "unspecified",
    );
    const longLived = snapshot.cookies.filter((cookie) =>
      isLongLived(cookie, snapshot.capturedAt),
    );

    if (insecure.length > 0) {
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "cookie-missing-secure",
          severity: "medium",
          confidence: "high",
          title: "Cookies sent without the Secure flag",
          summary:
            "These cookies are sent over plain HTTP as well as HTTPS, so a " +
            "network attacker can read them by forcing one insecure request.",
          evidence: evidenceFor(insecure),
          references: [
            "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#secure",
          ],
          tags: ["cookies"],
        }),
      );
    }

    if (readable.length > 0) {
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "cookie-missing-httponly",
          severity: "medium",
          confidence: "high",
          title: "Cookies readable by JavaScript",
          summary:
            "These cookies lack HttpOnly, so any script on the page — including " +
            "a third-party one — can read them. For a session cookie that is " +
            "the difference between a cross-site scripting bug and a stolen account.",
          evidence: evidenceFor(readable),
          references: [
            "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#httponly",
          ],
          tags: ["cookies"],
        }),
      );
    }

    if (crossSite.length > 0) {
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "cookie-samesite-none-insecure",
          severity: "medium",
          confidence: "high",
          title: "Cross-site cookies without Secure",
          summary:
            "SameSite=None sends these cookies on cross-site requests, which " +
            "browsers only honour when Secure is also set. As configured they " +
            "are both broadly exposed and likely to be rejected outright.",
          evidence: evidenceFor(crossSite),
          tags: ["cookies"],
        }),
      );
    }

    if (unspecified.length > 0) {
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "cookie-missing-samesite",
          severity: "low",
          confidence: "medium",
          title: "Cookies with no SameSite attribute",
          summary:
            "These cookies do not state a SameSite policy. Browsers default to " +
            "Lax, but the default has changed before and stating it is what " +
            "makes the intent reviewable.",
          evidence: evidenceFor(unspecified),
          tags: ["cookies"],
        }),
      );
    }

    if (longLived.length > 0) {
      findings.push(
        createFinding({
          analyzerId: ANALYZER_ID,
          ruleId: "cookie-long-lived",
          severity: "low",
          confidence: "medium",
          title: `Cookies that outlive ${String(LONG_LIVED_DAYS)} days`,
          summary:
            "These cookies persist long enough to track a browser across " +
            "unrelated visits. That may be intended; it is worth knowing either way.",
          evidence: evidenceFor(longLived),
          tags: ["cookies", "privacy"],
        }),
      );
    }

    return Promise.resolve(findings);
  },
};

/**
 * Measured against the capture time, not the current time: core has no clock,
 * and a fixture must produce the same findings in 2026 as in 2030.
 */
function isLongLived(cookie: CookieRef, capturedAt: string): boolean {
  if (cookie.expires === undefined) return false;
  const capturedSeconds = Date.parse(capturedAt) / 1000;
  if (Number.isNaN(capturedSeconds)) return false;
  return cookie.expires - capturedSeconds > LONG_LIVED_DAYS * SECONDS_PER_DAY;
}

function evidenceFor(cookies: readonly CookieRef[]): Finding["evidence"] {
  return cookies.map((cookie) => ({
    kind: "cookie" as const,
    value: cookie.name,
    ...(cookie.domain === undefined ? {} : { location: cookie.domain }),
  }));
}
