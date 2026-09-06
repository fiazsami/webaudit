#!/usr/bin/env node
/**
 * Build the tracker database from DuckDuckGo's Tracker Data Set (docs/10).
 *
 * **Licence: CC BY-NC-SA 4.0 — non-commercial.** The data is derived from
 * duckduckgo/tracker-radar. That is fine for a research project and is flagged
 * in the README, but it is why the file is downloaded at build time and never
 * vendored into this repository.
 *
 *   node scripts/build-tracker-db.mjs [--out <path>]
 *
 * We take the compiled Tracker Data Set rather than the tracker-radar repo
 * itself: the repo's aggregate `domain_map.json` carries owners but no
 * categories, and the per-domain files that do carry them number in the
 * thousands. The TDS has owner, categories, prevalence, and fingerprinting in
 * one 1.5 MB file, which reduces to about 118 KB of what we use.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const SOURCE =
  "https://staticcdn.duckduckgo.com/trackerblocking/v5/current/extension-tds.json";

const { values } = parseArgs({
  options: { out: { type: "string", default: "data/tracker-db.json" } },
});

const out = resolve(values.out);

const response = await fetch(SOURCE);
if (!response.ok) {
  throw new Error(`could not fetch the tracker data set: HTTP ${response.status}`);
}

const tds = await response.json();
const trackers = {};

for (const [domain, tracker] of Object.entries(tds.trackers ?? {})) {
  const owner = tracker.owner ?? {};
  const entry = {
    owner: owner.displayName ?? owner.name ?? "unknown",
    categories: tracker.categories ?? [],
  };
  if (typeof tracker.prevalence === "number") entry.prevalence = tracker.prevalence;
  if (tracker.fingerprinting) entry.fingerprinting = tracker.fingerprinting;
  trackers[domain] = entry;
}

await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  JSON.stringify({
    licence: "CC BY-NC-SA 4.0",
    source: "duckduckgo/tracker-radar via the Tracker Data Set",
    trackers,
  }),
  "utf8",
);

process.stderr.write(
  `wrote ${String(Object.keys(trackers).length)} trackers to ${out}\n`,
);
