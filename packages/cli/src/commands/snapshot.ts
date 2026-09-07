import { writeFile } from "node:fs/promises";

import { buildSnapshot, PageSnapshotSchema } from "core";

import { createNodeCapabilities } from "../capabilities/index.js";

/**
 * Build a `PageSnapshot` from a live URL (docs/02).
 *
 * The same builder the content script uses, so a fixture made here and a
 * capture made in the browser cannot drift. What this host cannot supply is
 * what only the extension can see: cookie flags and the page's own request log.
 * Both are recorded as limitations rather than left blank.
 */
export interface SnapshotCommandOptions {
  url: string;
  out?: string;
}

export async function runSnapshotCommand(
  options: SnapshotCommandOptions,
): Promise<void> {
  const capabilities = createNodeCapabilities();

  const response = await capabilities.http.fetch(options.url, {
    method: "GET",
    timeoutMs: 20_000,
    redirect: "follow",
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${String(response.status)} from ${options.url}`);
  }

  const document = capabilities.dom.parse(response.body, response.url);
  const snapshot = PageSnapshotSchema.parse(
    await buildSnapshot(document, {
      // The URL we landed on, so relative links resolve against the right base.
      url: response.url,
      capturedAt: new Date(capabilities.clock.now()).toISOString(),
    }),
  );

  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (options.out === undefined) process.stdout.write(json);
  else await writeFile(options.out, json, "utf8");
}
