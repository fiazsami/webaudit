import { describe, expect, it } from "vitest";

import { silentLogger } from "../../logger.js";
import { createTrackerDatabase, isThirdParty } from "../trackers/db.js";
import { trackersAnalyzer } from "../trackers/index.js";
import { TrackerDatabaseFileSchema } from "../trackers/schema.js";
import { snapshotWith } from "./snapshot-factory.js";

const db = createTrackerDatabase(
  TrackerDatabaseFileSchema.parse({
    licence: "CC BY-NC-SA 4.0",
    source: "test",
    trackers: {
      "google-analytics.com": {
        owner: "Google Analytics (Google)",
        categories: ["Analytics", "Audience Measurement"],
        prevalence: 0.394,
      },
      "doubleclick.net": {
        owner: "Google Ads",
        categories: ["Advertising"],
        prevalence: 0.2,
      },
      "fingerprintjs.com": {
        owner: "FingerprintJS",
        categories: ["Fingerprinting", "Fraud Prevention"],
        prevalence: 0.01,
      },
      "hotjar.com": { owner: "Hotjar", categories: ["Analytics"], prevalence: 0.03 },
    },
  }),
);

async function rules(snapshot: Parameters<typeof trackersAnalyzer.run>[0]) {
  const findings = await trackersAnalyzer.run(snapshot, {
    trackerDb: db,
    logger: silentLogger,
  });
  return findings.map((finding) => finding.ruleId);
}

describe("isThirdParty", () => {
  it("compares registrable domains, not hostnames", () => {
    // A subdomain of the page's own site is not a third party.
    expect(
      isThirdParty("https://cdn.example.com/a.js", "https://www.example.com/"),
    ).toBe(false);
    expect(isThirdParty("https://other.example/a.js", "https://www.example.com/")).toBe(
      true,
    );
  });
});

describe("tracker lookup", () => {
  it("matches a subdomain against its registrable domain", () => {
    // Pages request www.google-analytics.com; the database is keyed on the
    // registrable domain, so hostname matching would miss almost everything.
    expect(db.lookup("www.google-analytics.com")?.owner).toBe(
      "Google Analytics (Google)",
    );
  });

  it("returns null for a domain it does not know", () => {
    expect(db.lookup("not-a-tracker.example")).toBeNull();
  });
});

describe("trackers analyzer", () => {
  it("is skipped rather than silent when the database is absent", () => {
    expect(trackersAnalyzer.needs).toEqual(["trackerDb"]);
  });

  it("finds nothing on a page with no third parties", async () => {
    const snapshot = snapshotWith({
      scripts: [{ src: "https://example.com/app.js", attrs: {} }],
      thirdPartyRequests: [],
    });
    expect(await rules(snapshot)).toEqual([]);
  });

  it("separates fingerprinting from advertising from the rest", async () => {
    const snapshot = snapshotWith({
      thirdPartyRequests: [
        { url: "https://fingerprintjs.com/v3.js", type: "script" },
        { url: "https://doubleclick.net/tag.js", type: "script" },
        { url: "https://www.google-analytics.com/collect", type: "xhr" },
      ],
    });

    expect(await rules(snapshot)).toEqual([
      "fingerprinting-tracker",
      "advertising-tracker",
      "third-party-tracker",
    ]);
  });

  it("counts a party once however many hosts it uses", async () => {
    const snapshot = snapshotWith({
      thirdPartyRequests: [
        { url: "https://hotjar.com/a.js", type: "script" },
        { url: "https://script.hotjar.com/b.js", type: "script" },
        { url: "https://vars.hotjar.com/c.js", type: "script" },
      ],
    });
    const findings = await trackersAnalyzer.run(snapshot, {
      trackerDb: db,
      logger: silentLogger,
    });

    // One company, one finding, one piece of evidence.
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toHaveLength(1);
  });

  it("reads script and iframe sources, not just the request log", async () => {
    const snapshot = snapshotWith({
      scripts: [{ src: "https://www.google-analytics.com/analytics.js", attrs: {} }],
      iframes: [{ src: "https://doubleclick.net/frame.html" }],
      thirdPartyRequests: [],
    });

    expect(await rules(snapshot)).toContain("advertising-tracker");
    expect(await rules(snapshot)).toContain("third-party-tracker");
  });

  it("says so when it could not observe the page's requests", async () => {
    const snapshot = snapshotWith({
      scripts: [{ src: "https://www.google-analytics.com/analytics.js", attrs: {} }],
      limitations: ["no-webrequest-permission"],
    });

    // Without webRequest the list is a floor, not a total.
    expect(await rules(snapshot)).toContain("tracker-coverage-partial");
  });

  it("does not claim reduced coverage when it had the request log", async () => {
    const snapshot = snapshotWith({
      thirdPartyRequests: [{ url: "https://hotjar.com/a.js", type: "script" }],
      limitations: [],
    });
    expect(await rules(snapshot)).not.toContain("tracker-coverage-partial");
  });

  it("carries prevalence so a reader can weigh the party", async () => {
    const snapshot = snapshotWith({
      thirdPartyRequests: [{ url: "https://www.google-analytics.com/x", type: "xhr" }],
    });
    const findings = await trackersAnalyzer.run(snapshot, {
      trackerDb: db,
      logger: silentLogger,
    });

    expect(findings[0]?.evidence[0]?.location).toContain("39.4% of sites");
  });
});
