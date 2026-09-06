#!/usr/bin/env node
/**
 * Build the vulnerable-library database from retire.js data (docs/10).
 *
 * We use the data, not the scanner: retire.js is a Node CLI, and core has to
 * run in a browser too. Only the `uri` and `filename` extractors are kept,
 * because a snapshot records script URLs and never script contents (docs/02) —
 * the `func` and `filecontent` extractors have nothing here to match against.
 *
 *   node scripts/build-library-db.mjs [--out <path>]
 *
 * Output is gitignored: retire.js publishes advisories continuously, and a
 * committed copy would quietly go stale. Source: RetireJS/retire.js,
 * Apache-2.0.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const SOURCE =
  "https://raw.githubusercontent.com/RetireJS/retire.js/master/repository/jsrepository-v4.json";

const { values } = parseArgs({
  options: { out: { type: "string", default: "data/library-db.json" } },
});

const out = resolve(values.out);

const response = await fetch(SOURCE);
if (!response.ok) {
  throw new Error(`could not fetch the retire.js repository: HTTP ${response.status}`);
}

const repository = await response.json();
const libraries = {};

for (const [name, library] of Object.entries(repository)) {
  const extractors = library.extractors ?? {};
  const patterns = [...(extractors.uri ?? []), ...(extractors.filename ?? [])];
  if (patterns.length === 0) continue;

  const vulnerabilities = [];
  for (const vulnerability of library.vulnerabilities ?? []) {
    const identifiers = vulnerability.identifiers ?? {};
    const entry = { severity: vulnerability.severity ?? "medium" };
    if (vulnerability.below !== undefined) entry.below = vulnerability.below;
    if (vulnerability.atOrAbove !== undefined)
      entry.atOrAbove = vulnerability.atOrAbove;
    if (identifiers.summary !== undefined) entry.summary = identifiers.summary;
    if (Array.isArray(identifiers.CVE)) entry.cve = identifiers.CVE.slice(0, 3);
    if (Array.isArray(vulnerability.info)) entry.info = vulnerability.info.slice(0, 2);
    vulnerabilities.push(entry);
  }

  if (vulnerabilities.length > 0) libraries[name] = { patterns, vulnerabilities };
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ libraries }), "utf8");

process.stderr.write(
  `wrote ${String(Object.keys(libraries).length)} libraries to ${out}\n`,
);
