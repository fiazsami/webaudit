import { prebuiltAppConfig, type AppConfig, type ModelRecord } from "@mlc-ai/web-llm";
import { z } from "zod";

import pinned from "./model-integrity.json" with { type: "json" };

/**
 * Apply our own SRI hashes to the models we offer (docs/12 T7).
 *
 * WebLLM's 163 prebuilt records carry none, so without this nothing about a
 * model download is verified. The hashes are produced by
 * `pnpm build-model-integrity` and committed, because a security control that
 * lives only on the machine that generated it is not a control.
 *
 * **What this does not cover.** WebLLM verifies the config, the tokenizer files
 * and the model-library `.wasm`. It never verifies the weight shards, and
 * exposes no field that would let it. The `.wasm` is the executable part, so
 * pinning it is worth doing — but the gigabytes of weights remain unverified,
 * and docs/12 T7 says so rather than implying otherwise.
 */

const IntegritySchema = z.object({
  config: z.string(),
  model_lib: z.string(),
  tokenizer: z.record(z.string(), z.string()),
  onFailure: z.enum(["error", "warn"]),
});

const PinnedSchema = z.object({
  note: z.string(),
  integrity: z.record(z.string(), IntegritySchema),
});

/** Models we have hashes for. Anything else is not offered. */
export function pinnedModelIds(): string[] {
  return Object.keys(PinnedSchema.parse(pinned).integrity);
}

/**
 * A config whose records carry integrity. Models we have no hashes for are left
 * out entirely rather than included unverified — offering a model we cannot
 * check is the situation this exists to end.
 */
export function createVerifiedAppConfig(): AppConfig {
  const { integrity } = PinnedSchema.parse(pinned);

  const model_list: ModelRecord[] = [];
  for (const record of prebuiltAppConfig.model_list) {
    const hashes = integrity[record.model_id];
    if (hashes === undefined) continue;
    model_list.push({ ...record, integrity: hashes });
  }

  return { ...prebuiltAppConfig, model_list };
}
