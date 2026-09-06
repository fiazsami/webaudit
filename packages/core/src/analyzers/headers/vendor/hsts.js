/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copied from @mdn/mdn-http-observatory v1.7.1. See ./README.md (or ../vendor/README.md)
 * for the list of changes. */

// PRUNED (spike S1): upstream reads conf/hsts-preload.json with node:fs. That
// file is not in the npm tarball anyway -- it is generated at build time -- so
// the host injects the map instead. This is the only edit to upstream logic.

/**
 * @type {import("./types.js").Hsts}
 */
let hstsMap = new Map();

/**
 * @param {import("./types.js").Hsts} map
 */
export function setHstsPreloadList(map) {
  hstsMap = map;
}

/**
 * @returns {import("./types.js").Hsts}
 */
export function hsts() {
  return hstsMap;
}

/**
 *
 * @param {Site} site
 * @returns {import("./types.js").Hst | null}
 */
export function isHstsPreloaded(site) {
  const h = hsts();
  const hostname = site.hostname;

  // Check if the hostname is in the HSTS list with the right mode
  const existing = h.get(hostname);
  if (existing && existing.mode === "force-https") {
    return existing;
  }

  // Either the hostname is in the list *or* the TLD is and includeSubDomains is true
  const hostParts = hostname.split(".");

  // If hostname is foo.bar.baz.mozilla.org, check bar.baz.mozilla.org,
  // baz.mozilla.org, mozilla.org, and.org
  for (hostParts.shift(); hostParts.length > 0; hostParts.shift()) {
    const domain = hostParts.join(".");
    const exist = h.get(domain);
    if (exist && exist.mode === "force-https" && exist.includeSubDomains) {
      return exist;
    }
  }
  return null;
}
