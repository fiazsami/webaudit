import { readFile } from "node:fs/promises";

import { setHstsPreloadList } from "core";
import { z } from "zod";

/**
 * Load the HSTS preload list if it has been built (`pnpm build-hsts-preload`).
 *
 * Optional by design: the list is 740 KB gzipped and only changes the verdict
 * for a preloaded site that sends a bad HSTS header. Absent, HSTS findings say
 * so and carry medium confidence rather than pretending (docs/03).
 */

const PreloadEntrySchema = z.object({
  mode: z.string(),
  includeSubDomains: z.boolean(),
});
const PreloadListSchema = z.record(z.string(), PreloadEntrySchema);

export async function loadHstsPreloadList(path: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return 0; // not built; the analyzer stays honest about it
  }

  const parsed = PreloadListSchema.parse(JSON.parse(raw));
  const map = new Map(Object.entries(parsed));
  setHstsPreloadList(map);
  return map.size;
}
