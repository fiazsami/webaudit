import { describe, expect, it } from "vitest";

import { silentLogger } from "../../logger.js";
import { librariesAnalyzer } from "../libraries/index.js";
import { compareVersions, detectLibrary } from "../libraries/match.js";
import { LibraryDatabaseSchema } from "../libraries/schema.js";
import { snapshotWith } from "./snapshot-factory.js";

/** A cut-down stand-in with the same shape the build script produces. */
const db = LibraryDatabaseSchema.parse({
  libraries: {
    jquery: {
      patterns: [
        "/(§§version§§)/jquery(\\.min)?\\.js",
        "jquery-(§§version§§)(\\.min)?\\.js",
      ],
      vulnerabilities: [
        {
          below: "1.9.0",
          severity: "medium",
          summary: "XSS with location.hash",
          cve: ["CVE-2011-4969"],
          info: ["https://nvd.nist.gov/vuln/detail/CVE-2011-4969"],
        },
        {
          below: "3.5.0",
          atOrAbove: "1.2",
          severity: "medium",
          cve: ["CVE-2020-11022"],
        },
      ],
    },
  },
});

describe("compareVersions", () => {
  it("compares numerically, not as text", () => {
    // The whole reason not to use string comparison.
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
  });

  it("treats a missing component as zero-ish", () => {
    expect(compareVersions("1.9", "1.9.0")).toBeLessThan(0);
    expect(compareVersions("1.9.0", "1.9.0")).toBe(0);
  });

  it("sorts a prerelease below the release", () => {
    expect(compareVersions("1.0.0-rc1", "1.0.0")).toBeLessThan(0);
  });
});

describe("detectLibrary", () => {
  it("reads a version out of a filename", () => {
    const match = detectLibrary("https://cdn.example/js/jquery-1.7.1.min.js", db);
    expect(match).toMatchObject({ library: "jquery", version: "1.7.1" });
  });

  it("does not swallow .min into the version", () => {
    // The trap: the version character class contains `.` and letters, so a
    // greedy match reads "1.7.1.min" and then matches no advisory.
    expect(detectLibrary("https://cdn.example/jquery-1.7.1.min.js", db)?.version).toBe(
      "1.7.1",
    );
  });

  it("reads a version out of a path segment", () => {
    const match = detectLibrary("https://cdn.example/1.7.1/jquery.min.js", db);
    expect(match?.version).toBe("1.7.1");
  });

  it("reports only the advisories that apply to that version", () => {
    const match = detectLibrary("https://cdn.example/jquery-3.4.0.min.js", db);
    // Below 1.9.0 does not apply; the 3.5.0 one does.
    expect(match?.vulnerabilities).toHaveLength(1);
    expect(match?.vulnerabilities[0]?.cve).toEqual(["CVE-2020-11022"]);
  });

  it("says nothing about a version with no known advisory", () => {
    expect(
      detectLibrary("https://cdn.example/jquery-3.7.1.min.js", db),
    ).toBeUndefined();
  });

  it("does not match a URL with no version in it", () => {
    expect(detectLibrary("https://cdn.example/static/bundle.js", db)).toBeUndefined();
  });
});

describe("libraries analyzer", () => {
  it("is skipped rather than silent when the database is absent", () => {
    expect(librariesAnalyzer.needs).toEqual(["libraryDb"]);
  });

  it("reports a vulnerable version found in a script URL", async () => {
    const snapshot = snapshotWith({
      scripts: [{ src: "https://cdn.example/jquery-1.7.1.min.js", attrs: {} }],
    });
    const findings = await librariesAnalyzer.run(snapshot, {
      libraryDb: db,
      logger: silentLogger,
    });

    const vulnerable = findings.find((f) => f.ruleId === "vulnerable-library");
    expect(vulnerable?.severity).toBe("medium");
    expect(vulnerable?.title).toContain("jquery 1.7.1");
    expect(vulnerable?.evidence.map((e) => e.value)).toContain("CVE-2011-4969");
  });

  it("always says that detection only sees URLs", async () => {
    const findings = await librariesAnalyzer.run(snapshotWith(), {
      libraryDb: db,
      logger: silentLogger,
    });

    // A clean result here means "nothing vulnerable was named in a URL", which
    // is much weaker than "nothing vulnerable is loaded".
    const note = findings.find((f) => f.ruleId === "library-detection-partial");
    expect(note?.severity).toBe("info");
  });

  it("does not report the same library twice", async () => {
    const snapshot = snapshotWith({
      scripts: [
        { src: "https://a.example/jquery-1.7.1.min.js", attrs: {} },
        { src: "https://b.example/jquery-1.7.1.min.js", attrs: {} },
      ],
    });
    const findings = await librariesAnalyzer.run(snapshot, {
      libraryDb: db,
      logger: silentLogger,
    });

    expect(findings.filter((f) => f.ruleId === "vulnerable-library")).toHaveLength(1);
  });
});
