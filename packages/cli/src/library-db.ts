import { readFile } from "node:fs/promises";

import { LibraryDatabaseSchema, type LibraryDatabase } from "core";

/**
 * Load the vulnerable-library database if it has been built
 * (`pnpm build-library-db`).
 *
 * Downloaded rather than committed: retire.js publishes advisories
 * continuously, and a checked-in copy would quietly go stale while looking
 * authoritative. Absent, the analyzer is skipped with an explicit finding
 * rather than reporting a clean result (docs/03).
 */
export async function loadLibraryDb(
  path: string,
): Promise<LibraryDatabase | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  // A file fetched from the internet, and we compile regexes out of it.
  return LibraryDatabaseSchema.parse(JSON.parse(raw));
}
