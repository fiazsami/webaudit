import { createFinding, type Finding, type Severity } from "../../findings/schema.js";
import type { PageSnapshot } from "../../snapshot/schema.js";
import type { Analyzer, AnalyzerContext, TrackerDatabase } from "../types.js";
import { isThirdParty } from "./db.js";

const ANALYZER_ID = "trackers";

/** Categories worth calling out separately from ordinary analytics. */
const FINGERPRINTING = /fingerprint/i;
// Audience measurement is deliberately not here. It is adjacent to advertising,
// but it is also what Google Analytics is categorised as, and labelling a
// site's own analytics "advertising" is a stretch a reader would rightly push
// back on. It lands in the general third-party group instead.
const ADVERTISING = /advertis|ad motivated|ad fraud/i;

/**
 * Third-party domains classified against the tracker database (docs/03).
 *
 * Two sources of hostnames, and they are not equivalent. Script `src`
 * attributes are always available. `thirdPartyRequests` comes from the optional
 * `webRequest` permission and sees far more — images, beacons, XHR — so when it
 * is absent the snapshot says `no-webrequest-permission` and this analyzer
 * reports reduced coverage rather than a shorter list of trackers.
 */
export const trackersAnalyzer: Analyzer = {
  id: ANALYZER_ID,
  needs: ["trackerDb"],

  run(snapshot: PageSnapshot, ctx: AnalyzerContext): Promise<Finding[]> {
    const db = ctx.trackerDb;
    if (db === undefined) return Promise.resolve([]);

    const identified = identify(snapshot, db);
    const findings: Finding[] = [];

    if (identified.length > 0) {
      findings.push(...group(identified, snapshot));
    }

    if (snapshot.limitations.includes("no-webrequest-permission")) {
      findings.push(coverageNote(snapshot, identified.length));
    }

    return Promise.resolve(findings);
  },
};

interface IdentifiedTracker {
  hostname: string;
  owner: string;
  categories: string[];
  prevalence: number | undefined;
}

function identify(snapshot: PageSnapshot, db: TrackerDatabase): IdentifiedTracker[] {
  const hostnames = new Set<string>();

  for (const script of snapshot.scripts) {
    if (script.src !== undefined) addHostname(hostnames, script.src, snapshot.url);
  }
  for (const request of snapshot.thirdPartyRequests) {
    addHostname(hostnames, request.url, snapshot.url);
  }
  for (const iframe of snapshot.iframes) {
    if (iframe.src !== undefined) addHostname(hostnames, iframe.src, snapshot.url);
  }

  const identified: IdentifiedTracker[] = [];
  const seenOwners = new Set<string>();

  for (const hostname of [...hostnames].sort()) {
    const entry = db.lookup(hostname);
    if (entry === null) continue;
    // One finding per owner, not per hostname: a single ad network can appear
    // under a dozen hosts and reads as a dozen problems.
    if (seenOwners.has(entry.owner)) continue;
    seenOwners.add(entry.owner);

    identified.push({
      hostname,
      owner: entry.owner,
      categories: entry.categories,
      prevalence: entry.prevalence,
    });
  }

  return identified;
}

function addHostname(into: Set<string>, url: string, pageUrl: string): void {
  if (!isThirdParty(url, pageUrl)) return;
  try {
    into.add(new URL(url).hostname);
  } catch {
    // A URL we cannot parse is not a hostname we can classify.
  }
}

/**
 * Three findings at most, by kind, rather than one per company. A page with
 * twenty trackers should read as "twenty trackers", not as twenty problems.
 */
function group(trackers: IdentifiedTracker[], snapshot: PageSnapshot): Finding[] {
  const fingerprinters = trackers.filter((tracker) =>
    tracker.categories.some((category) => FINGERPRINTING.test(category)),
  );
  const advertisers = trackers.filter(
    (tracker) =>
      !fingerprinters.includes(tracker) &&
      tracker.categories.some((category) => ADVERTISING.test(category)),
  );
  const others = trackers.filter(
    (tracker) => !fingerprinters.includes(tracker) && !advertisers.includes(tracker),
  );

  const findings: Finding[] = [];

  if (fingerprinters.length > 0) {
    findings.push(
      trackerFinding({
        ruleId: "fingerprinting-tracker",
        severity: "medium",
        title: `${describeCount(fingerprinters.length, "third party", "third parties")} that fingerprint browsers`,
        summary:
          "These parties are classified as using browser fingerprinting, which " +
          "identifies a visitor from device and browser characteristics. It " +
          "works without cookies, so clearing them or refusing consent does not " +
          "prevent it.",
        trackers: fingerprinters,
        snapshot,
      }),
    );
  }

  if (advertisers.length > 0) {
    findings.push(
      trackerFinding({
        ruleId: "advertising-tracker",
        severity: "low",
        title: `${describeCount(advertisers.length, "advertising party", "advertising parties")} on this page`,
        summary:
          "These parties are classified as advertising. Each one sees that this " +
          "page was visited, along with whatever the request carries.",
        trackers: advertisers,
        snapshot,
      }),
    );
  }

  if (others.length > 0) {
    findings.push(
      trackerFinding({
        ruleId: "third-party-tracker",
        severity: "info",
        title: `${describeCount(others.length, "known third-party service", "known third-party services")} on this page`,
        summary:
          "These are in the tracker database but not classified as advertising " +
          "or fingerprinting — analytics, tag management, embedded widgets. " +
          "Each still observes the visit.",
        trackers: others,
        snapshot,
      }),
    );
  }

  return findings;
}

function trackerFinding(input: {
  ruleId: string;
  severity: Severity;
  title: string;
  summary: string;
  trackers: IdentifiedTracker[];
  snapshot: PageSnapshot;
}): Finding {
  return createFinding({
    analyzerId: ANALYZER_ID,
    ruleId: input.ruleId,
    severity: input.severity,
    confidence: "high",
    title: input.title,
    summary: input.summary,
    evidence: input.trackers.slice(0, 20).map((tracker) => ({
      kind: "request" as const,
      value: tracker.hostname,
      location:
        tracker.prevalence === undefined
          ? tracker.owner
          : `${tracker.owner} · on ${(tracker.prevalence * 100).toFixed(1)}% of sites`,
    })),
    references: ["https://github.com/duckduckgo/tracker-radar"],
    tags: ["trackers", "privacy"],
  });
}

/**
 * Without `webRequest` we only see scripts and iframes, which is a fraction of
 * what a page actually requests. Saying so matters more than the count does.
 */
function coverageNote(snapshot: PageSnapshot, found: number): Finding {
  return createFinding({
    analyzerId: ANALYZER_ID,
    ruleId: "tracker-coverage-partial",
    severity: "info",
    confidence: "high",
    title: "Tracker detection saw only scripts and frames",
    summary:
      "This audit did not have permission to observe the page's network " +
      "requests, so only third parties named in script and iframe sources were " +
      "checked. Tracking pixels, beacons, and background requests were not " +
      `visible. ${String(found)} known ${found === 1 ? "party was" : "parties were"} ` +
      "identified from what could be seen.",
    evidence: [
      { kind: "other", value: "no-webrequest-permission", location: snapshot.url },
    ],
    tags: ["trackers"],
  });
}

function describeCount(count: number, singular: string, plural: string): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}
