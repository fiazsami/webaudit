import type { LibraryDatabase, LibraryVulnerability } from "./schema.js";

/**
 * Version detection and range matching, ported from what retire.js does with
 * its `uri` and `filename` extractors.
 *
 * Only URLs are available to match against: a snapshot records script sources,
 * never script contents (docs/02). That means this finds a vulnerable version
 * whose number is in the URL, and misses one served from `/static/bundle.js`.
 * A miss is silent, which is why findings from here are worth reporting and a
 * clean result is not worth trusting — the analyzer says so.
 */

/**
 * retire.js's version pattern, substituted for its §§version§§ marker — with
 * one change: the quantifier is lazy.
 *
 * The character class includes `.` and letters, so a greedy match against
 * `jquery-1.7.1.min.js` swallows `.min` into the version and leaves the
 * pattern's own optional `(\.min)?` group matching nothing. Lazy matching lets
 * that group claim `.min` and yields `1.7.1`. Verified against both filename
 * and path-segment extractors, minified and not.
 */
const VERSION_PATTERN = "[0-9][0-9.a-z_\\\\-]+?";
const VERSION_PLACEHOLDER = /§§version§§/g;

export interface LibraryMatch {
  library: string;
  version: string;
  vulnerabilities: LibraryVulnerability[];
}

export function detectLibrary(
  url: string,
  db: LibraryDatabase,
): LibraryMatch | undefined {
  for (const [library, entry] of Object.entries(db.libraries)) {
    for (const pattern of entry.patterns) {
      const version = extractVersion(url, pattern);
      if (version === undefined) continue;

      const vulnerabilities = entry.vulnerabilities.filter((vulnerability) =>
        isAffected(version, vulnerability),
      );
      if (vulnerabilities.length > 0) {
        return { library, version, vulnerabilities };
      }
      // A recognised library at a version with no known advisory: stop looking,
      // the URL has been explained.
      return undefined;
    }
  }
  return undefined;
}

function extractVersion(url: string, pattern: string): string | undefined {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern.replace(VERSION_PLACEHOLDER, VERSION_PATTERN), "i");
  } catch {
    return undefined; // a pattern we cannot compile is not a match
  }

  const match = regex.exec(url);
  return match?.[1];
}

export function isAffected(
  version: string,
  vulnerability: LibraryVulnerability,
): boolean {
  if (
    vulnerability.below !== undefined &&
    compareVersions(version, vulnerability.below) >= 0
  ) {
    return false;
  }
  if (
    vulnerability.atOrAbove !== undefined &&
    compareVersions(version, vulnerability.atOrAbove) < 0
  ) {
    return false;
  }
  return vulnerability.below !== undefined || vulnerability.atOrAbove !== undefined;
}

/**
 * Compare dotted versions component by component. Numeric parts compare
 * numerically so 1.10 sorts above 1.9; anything non-numeric compares as text,
 * which puts a prerelease like `1.0.0-rc1` below `1.0.0` as retire.js expects.
 */
export function compareVersions(left: string, right: string): number {
  const a = splitVersion(left);
  const b = splitVersion(right);

  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index];
    const y = b[index];

    // When one side runs out, what the other side has left decides. An extra
    // numeric component makes it later (1.9.0 > 1.9); an extra text component
    // is a prerelease tag, which makes it earlier (1.0.0-rc1 < 1.0.0).
    if (x === undefined) {
      if (y === undefined) return 0;
      return typeof y === "number" ? -1 : 1;
    }
    if (y === undefined) return typeof x === "number" ? 1 : -1;

    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x < y ? -1 : 1;
      continue;
    }
    // A prerelease segment sorts below a numeric one at the same position.
    if (typeof x === "number") return 1;
    if (typeof y === "number") return -1;
    if (x !== y) return x < y ? -1 : 1;
  }

  return 0;
}

function splitVersion(version: string): Array<number | string> {
  return version
    .split(/[.\-_]/)
    .filter((part) => part !== "")
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}
