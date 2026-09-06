import { createFinding, type Finding, type Severity } from "../../findings/schema.js";
import type { PageSnapshot } from "../../snapshot/schema.js";
import type { Analyzer, AnalyzerContext } from "../types.js";
import { detectLibrary, type LibraryMatch } from "./match.js";

const ANALYZER_ID = "libraries";

/**
 * Known-vulnerable JavaScript library versions, from retire.js data (docs/03).
 *
 * The data, not the scanner: retire.js is a Node CLI and core runs in a browser
 * too. That has a real consequence. retire.js identifies libraries from file
 * contents as well as URLs, and a snapshot carries only script URLs — so this
 * finds `jquery-1.7.1.min.js` and misses the same jQuery inside
 * `/static/bundle.js`. Findings here are worth acting on; the absence of them is
 * not worth trusting, and the analyzer emits an `info` finding saying so.
 */
export const librariesAnalyzer: Analyzer = {
  id: ANALYZER_ID,
  needs: ["libraryDb"],

  run(snapshot: PageSnapshot, ctx: AnalyzerContext): Promise<Finding[]> {
    const db = ctx.libraryDb;
    if (db === undefined) return Promise.resolve([]);

    const findings: Finding[] = [];
    const seen = new Set<string>();

    for (const script of snapshot.scripts) {
      if (script.src === undefined) continue;

      const match = detectLibrary(script.src, db);
      if (match === undefined) continue;

      const key = `${match.library}@${match.version}`;
      if (seen.has(key)) continue;
      seen.add(key);

      findings.push(toFinding(match, script.src));
    }

    findings.push(coverageNote(snapshot));
    return Promise.resolve(findings);
  },
};

function toFinding(match: LibraryMatch, url: string): Finding {
  const worst = match.vulnerabilities.reduce<Severity>(
    (highest, vulnerability) =>
      maxSeverity(highest, mapSeverity(vulnerability.severity)),
    "low",
  );

  const identifiers = match.vulnerabilities
    .flatMap((vulnerability) => vulnerability.cve)
    .slice(0, 5);

  const summaries = match.vulnerabilities
    .map((vulnerability) => vulnerability.summary)
    .filter((summary): summary is string => summary !== undefined)
    .slice(0, 3);

  return createFinding({
    analyzerId: ANALYZER_ID,
    ruleId: "vulnerable-library",
    severity: worst,
    confidence: "medium",
    title: `${match.library} ${match.version} has known vulnerabilities`,
    summary:
      `This page loads ${match.library} ${match.version}, which has ` +
      `${String(match.vulnerabilities.length)} known ` +
      `${match.vulnerabilities.length === 1 ? "advisory" : "advisories"}` +
      (summaries.length > 0 ? `: ${summaries.join("; ")}` : "") +
      ". The version was read from the script's URL, so it reflects what the " +
      "file is named rather than what it contains.",
    evidence: [
      { kind: "script", value: url, location: `${match.library} ${match.version}` },
      ...identifiers.map((cve) => ({ kind: "script" as const, value: cve })),
    ],
    references: match.vulnerabilities
      .flatMap((vulnerability) => vulnerability.info)
      .filter((info) => info.startsWith("http"))
      .slice(0, 5),
    tags: ["libraries", "supply-chain"],
  });
}

/**
 * Reported every run, because the gap is structural rather than incidental: a
 * clean result here means "no vulnerable version was named in a script URL",
 * which is a much weaker statement than "no vulnerable library is loaded".
 */
function coverageNote(snapshot: PageSnapshot): Finding {
  const external = snapshot.scripts.filter((script) => script.src !== undefined).length;
  return createFinding({
    analyzerId: ANALYZER_ID,
    ruleId: "library-detection-partial",
    severity: "info",
    confidence: "high",
    title: "Library detection only sees script URLs",
    summary:
      "Versions are identified from script URLs, because a snapshot records " +
      "where scripts came from and not what is in them. A vulnerable library " +
      "inside a bundle, or served from a URL with no version in it, is not " +
      "detected here.",
    evidence: [
      {
        kind: "script",
        value: `${String(external)} external ${external === 1 ? "script" : "scripts"} examined`,
        location: snapshot.url,
      },
    ],
    tags: ["libraries"],
  });
}

/** retire.js severities are its own vocabulary; map them onto ours. */
function mapSeverity(severity: string): Severity {
  switch (severity.toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    default:
      return "medium";
  }
}

function maxSeverity(a: Severity, b: Severity): Severity {
  const order: Severity[] = ["info", "low", "medium", "high", "critical"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}
