import { encode } from "gpt-tokenizer";

/**
 * Token counting for chunk sizing (docs/05 stage 4).
 *
 * This is a GPT byte-pair encoder, and the models we run are Qwen and Llama,
 * which tokenize differently. It is used anyway because the alternative was
 * worse: the WebLLM adapter has no tokenizer at all and returns `length / 4`,
 * which docs/04 flagged as inadequate here. For English prose the two BPEs land
 * within about 10–20% of each other, and `CHUNK_SAFETY` below covers the gap.
 *
 * Being wrong in the two directions is not symmetric. Overestimating makes
 * chunks smaller than they need to be, which costs time. Underestimating
 * overflows the context window, which costs the chunk. So the margin is
 * deliberately generous.
 */
export function countTokens(text: string): number {
  return encode(text).length;
}

/**
 * Fraction of the computed budget actually used, covering the difference
 * between this tokenizer and the model's own.
 */
export const CHUNK_SAFETY = 0.8;

export interface ChunkBudgetInput {
  /** From `capabilities().contextTokens`. */
  contextTokens: number;
  /** The extraction prompt, schema and instructions. */
  promptOverheadTokens: number;
  /** Room the model needs for the clauses it emits. */
  maxOutputTokens: number;
}

/**
 * How much policy text fits in one call.
 *
 * S2 measured prefill cost as worse than linear in prompt length, which argues
 * for small chunks — but every chunk repays the prompt overhead in full, and
 * there are fifteen or twenty of them. Fewer, larger chunks win, so this aims
 * at the context limit rather than well under it (docs/05).
 */
export function chunkBudget(input: ChunkBudgetInput): number {
  const available =
    input.contextTokens - input.promptOverheadTokens - input.maxOutputTokens;
  return Math.max(256, Math.floor(available * CHUNK_SAFETY));
}
