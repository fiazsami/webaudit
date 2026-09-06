#!/usr/bin/env node
/**
 * Stage the built data files into the extension's `public/` directory so they
 * ship as extension resources and can be fetched from its own origin at
 * runtime (docs/10).
 *
 * Copied rather than imported: they are gitignored downloads, so a bare
 * `import` would break the build on a clean checkout. Missing files are skipped
 * silently — the analyzers that need them are skipped with an explicit finding,
 * which is the designed behaviour, not a failure.
 *
 * The HSTS preload list is deliberately not staged: 740 KB gzipped is a lot to
 * add to an extension for one caveat (docs/03).
 */
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "packages/extension/public/data");

await mkdir(target, { recursive: true });

for (const name of ["tracker-db.json", "library-db.json"]) {
  try {
    await copyFile(join(root, "data", name), join(target, name));
    process.stderr.write(`staged ${name}\n`);
  } catch {
    process.stderr.write(`skipped ${name} (not built)\n`);
  }
}
