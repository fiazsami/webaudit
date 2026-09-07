/**
 * The models we offer, and why (docs/04, docs/11 M4).
 *
 * Chosen from what spike S2 actually measured on an Apple M4 rather than from
 * the 163 models WebLLM ships. Numbers below are from that run and are the
 * basis for the ToS pipeline's budget arithmetic (docs/05 §4).
 */

export interface ModelChoice {
  id: string;
  label: string;
  /** Approximate download, for the warning before it starts. */
  downloadMB: number;
  vramMB: number;
  contextTokens: number;
  /** Measured on an Apple M4 (spike S2). */
  measured?: { prefillTokensPerSec: number; decodeTokensPerSec: number };
  note: string;
  recommended?: boolean;
}

export const MODEL_CHOICES: readonly ModelChoice[] = [
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: "Qwen2.5 1.5B",
    downloadMB: 1100,
    vramMB: 1630,
    contextTokens: 4096,
    measured: { prefillTokensPerSec: 486, decodeTokensPerSec: 20.5 },
    note: "The default. Fast enough that a policy finishes in a couple of minutes.",
    recommended: true,
  },
  {
    id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    label: "Qwen2.5 0.5B",
    downloadMB: 350,
    vramMB: 945,
    contextTokens: 4096,
    measured: { prefillTokensPerSec: 1295, decodeTokensPerSec: 40 },
    note: "Three times faster and much smaller. Whether it extracts clauses well enough is what the evals are for.",
  },
  {
    id: "Llama-3.1-8B-Instruct-q4f16_1-MLC",
    label: "Llama 3.1 8B",
    downloadMB: 4400,
    vramMB: 5001,
    contextTokens: 4096,
    measured: { prefillTokensPerSec: 112, decodeTokensPerSec: 8.3 },
    note: "Measured at 17s to read a single 1900-token prompt, which puts one policy at roughly six minutes of prefill. Useful as a quality ceiling to compare against, not for everyday use.",
  },
];

export const DEFAULT_MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

export function findModel(id: string): ModelChoice | undefined {
  return MODEL_CHOICES.find((model) => model.id === id);
}
