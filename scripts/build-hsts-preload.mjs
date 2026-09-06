#!/usr/bin/env node
/**
 * Build the HSTS preload map the headers analyzer can be given.
 *
 * Why this is opt-in rather than bundled: the list is 94,644 entries — 6.2 MB
 * of JSON, 740 KB gzipped. Without it the HSTS check is still correct in every
 * case except one: a site on the browser preload list that sends a short,
 * malformed, or missing HSTS header is reported as a problem when browsers
 * force HTTPS for it regardless. Those findings carry that caveat in their
 * summary, so the analyzer is honest without the list. Whether the download is
 * worth removing the caveat is a judgement about bundle size, so it is a
 * decision rather than a default.
 *
 *   node scripts/build-hsts-preload.mjs [--out <path>]
 *
 * Output is gitignored. Source: Chromium's transport_security_state_static.json,
 * BSD-3-Clause.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const SOURCE =
  "https://chromium.googlesource.com/chromium/src/+/main/net/http/transport_security_state_static.json?format=TEXT";

const { values } = parseArgs({
  options: { out: { type: "string", default: "data/hsts-preload.json" } },
});

const out = resolve(values.out);

const response = await fetch(SOURCE);
if (!response.ok) {
  throw new Error(`could not fetch the preload list: HTTP ${response.status}`);
}

// The endpoint serves base64, and the decoded file has // comments before the
// JSON body.
const decoded = Buffer.from(await response.text(), "base64").toString("utf8");
const parsed = JSON.parse(decoded.replace(/^\s*\/\/.*$/gm, ""));

const map = {};
for (const entry of parsed.entries ?? []) {
  if (entry.mode !== "force-https" || typeof entry.name !== "string") continue;
  map[entry.name] = {
    mode: "force-https",
    includeSubDomains: entry.include_subdomains === true,
  };
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(map), "utf8");

process.stderr.write(
  `wrote ${String(Object.keys(map).length)} preloaded hosts to ${out}\n`,
);
