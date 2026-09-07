import { readFile } from "node:fs/promises";

import { createReplayProvider, ModelRecordingSchema, type ModelProvider } from "core";

/**
 * Load a recorded model session and replay it (docs/04, docs/11 M4).
 *
 * This is the whole reason recordings exist: Node has no WebGPU, so the only
 * way CI can test anything that calls a model is to answer from a session
 * captured on a machine that had one (hard rule 6).
 */
export async function loadReplayProvider(path: string): Promise<ModelProvider> {
  const raw = await readFile(path, "utf8");
  // A file on disk is untrusted input like any other (hard rule 2).
  return createReplayProvider(ModelRecordingSchema.parse(JSON.parse(raw)));
}
