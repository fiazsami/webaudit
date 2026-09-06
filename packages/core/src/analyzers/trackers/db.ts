import { getDomain } from "tldts";

import type { TrackerDatabase } from "../types.js";
import type { TrackerDatabaseFile } from "./schema.js";

/**
 * A `TrackerDatabase` over the built file (docs/03).
 *
 * Lookups are by registrable domain (eTLD+1) via `tldts`, because the database
 * is keyed that way and a page requests `www.google-analytics.com` rather than
 * `google-analytics.com`. Matching on the full hostname would miss almost
 * everything.
 */
export function createTrackerDatabase(file: TrackerDatabaseFile): TrackerDatabase {
  return {
    lookup(hostname: string) {
      const domain = getDomain(hostname) ?? hostname.toLowerCase();
      const entry = file.trackers[domain];
      if (entry === undefined) return null;

      return {
        owner: entry.owner,
        categories: entry.categories,
        ...(entry.prevalence === undefined ? {} : { prevalence: entry.prevalence }),
      };
    },
  };
}

/** True when `url` is on a different registrable domain than the page. */
export function isThirdParty(url: string, pageUrl: string): boolean {
  const a = getDomain(url);
  const b = getDomain(pageUrl);
  if (a === null || b === null) return false;
  return a !== b;
}
