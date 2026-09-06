import {
  createTrackerDatabase,
  LibraryDatabaseSchema,
  TrackerDatabaseFileSchema,
  type LibraryDatabase,
  type TrackerDatabase,
} from "core";

/**
 * Load the analyzer data sets from the extension's own packaged resources.
 *
 * They are staged into `public/data/` at build time by
 * `scripts/copy-data-to-extension.mjs`, because they are gitignored downloads
 * (docs/10) and a bare import would break a clean checkout. Absent, the
 * analyzers that need them are skipped with an explicit finding rather than
 * reporting a clean result.
 *
 * `browser.runtime.getURL` keeps this on the extension's own origin: no host
 * permission is involved, and nothing here reaches the network.
 */
export interface AnalyzerDatabases {
  trackerDb?: TrackerDatabase;
  libraryDb?: LibraryDatabase;
}

export async function loadAnalyzerDatabases(): Promise<AnalyzerDatabases> {
  const [trackers, libraries] = await Promise.all([
    readJson("data/tracker-db.json"),
    readJson("data/library-db.json"),
  ]);

  const databases: AnalyzerDatabases = {};

  if (trackers !== undefined) {
    databases.trackerDb = createTrackerDatabase(
      TrackerDatabaseFileSchema.parse(trackers),
    );
  }
  if (libraries !== undefined) {
    databases.libraryDb = LibraryDatabaseSchema.parse(libraries);
  }

  return databases;
}

async function readJson(path: string): Promise<unknown> {
  try {
    // WXT types getURL against the public files it saw at `wxt prepare` time.
    // These are staged during prebuild and are legitimately absent on a clean
    // checkout, so they can never be in that union. The cast says exactly that;
    // a missing file is handled below rather than being a build error.
    const url = browser.runtime.getURL(
      `/${path}` as Parameters<typeof browser.runtime.getURL>[0],
    );
    const response = await fetch(url);
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
}
