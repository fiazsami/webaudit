import { readFile } from "node:fs/promises";

import {
  createTrackerDatabase,
  TrackerDatabaseFileSchema,
  type TrackerDatabase,
} from "core";

/**
 * Load the tracker database if it has been built (`pnpm build-tracker-db`).
 *
 * **CC BY-NC-SA 4.0 — non-commercial** (docs/10). Downloaded at build time,
 * never vendored, which is why this is optional rather than bundled. Absent, the
 * analyzer is skipped with an explicit finding.
 */
export async function loadTrackerDb(
  path: string,
): Promise<TrackerDatabase | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  return createTrackerDatabase(TrackerDatabaseFileSchema.parse(JSON.parse(raw)));
}
