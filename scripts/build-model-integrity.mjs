#!/usr/bin/env node
/**
 * Compute SRI hashes for the models we offer (docs/12 T7).
 *
 * WebLLM ships `ModelIntegrity` with `onFailure: "error"`, but none of its 163
 * prebuilt model records carry hashes, so nothing is verified out of the box.
 * This produces the overlay that changes that.
 *
 * **What this can and cannot cover.** WebLLM calls `verifyIntegrity` in exactly
 * three places: the `mlc-chat-config.json`, the tokenizer files, and the
 * model-library `.wasm`. The weight shards — the gigabytes this project warns
 * about — are never verified by the runtime, and no field exists to make them
 * so. Pinning these three still matters, because the `.wasm` is the executable
 * part, but it is not the whole of T7 and should not be described as if it is.
 *
 *   node scripts/build-model-integrity.mjs [--out <path>]
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { prebuiltAppConfig } from "@mlc-ai/web-llm";

/** Kept in step with packages/extension/lib/models.ts. */
const MODEL_IDS = [
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
  "Llama-3.1-8B-Instruct-q4f16_1-MLC",
];

const { values } = parseArgs({
  // Committed, not gitignored like the other build-time data. Pinned hashes are
  // a security control: one that only exists on the machine that generated it
  // is not a control at all, and it is 2 KB.
  options: {
    out: {
      type: "string",
      default: "packages/extension/lib/model-integrity.json",
    },
  },
});
const out = resolve(values.out);

async function sri(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

const integrity = {};

for (const modelId of MODEL_IDS) {
  const record = prebuiltAppConfig.model_list.find((m) => m.model_id === modelId);
  if (record === undefined) {
    process.stderr.write(`skipping ${modelId}: not in prebuiltAppConfig\n`);
    continue;
  }

  const base = record.model.replace(/\/$/, "");
  const configUrl = `${base}/resolve/main/mlc-chat-config.json`;

  process.stderr.write(`${modelId}\n`);
  const configHash = await sri(configUrl);

  const config = await (await fetch(configUrl)).json();
  const tokenizer = {};
  for (const filename of config.tokenizer_files ?? []) {
    tokenizer[filename] = await sri(`${base}/resolve/main/${filename}`);
    process.stderr.write(`  ${filename}\n`);
  }

  const modelLib = await sri(record.model_lib);
  process.stderr.write(`  model_lib\n`);

  integrity[modelId] = {
    config: configHash,
    model_lib: modelLib,
    tokenizer,
    // Fail the load rather than run something we did not expect.
    onFailure: "error",
  };
}

await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  `${JSON.stringify(
    {
      note: "Covers config, tokenizer and model_lib only. WebLLM does not verify weight shards (docs/12 T7).",
      webllmVersion: prebuiltAppConfig.model_list.length > 0 ? "prebuilt" : "unknown",
      integrity,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

process.stderr.write(
  `wrote integrity for ${String(Object.keys(integrity).length)} models to ${out}\n`,
);
