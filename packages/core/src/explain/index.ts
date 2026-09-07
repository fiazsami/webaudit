import type { Logger } from "../logger.js";
import type { Finding } from "../findings/schema.js";
import type { ModelProvider } from "../providers/types.js";
import { buildExplainPrompt, EXPLAIN_SYSTEM_PROMPT } from "./prompt.js";
import { ExplanationSchema } from "./schema.js";

/**
 * Have the model write a finding's `explanation` (docs/03).
 *
 * The only field a model ever writes. Everything else about a finding stays
 * exactly as the analyzer produced it — including its severity, which is why a
 * page cannot argue its way to a lower one.
 */

export interface ExplainOptions {
  provider: ModelProvider;
  logger: Logger;
  /** Room for the answer. Small by default; explanations are short. */
  maxTokens?: number;
  signal?: AbortSignal;
}

export async function explainFinding(
  finding: Finding,
  options: ExplainOptions,
): Promise<Finding> {
  const { provider, logger } = options;

  try {
    const response = await provider.complete({
      system: EXPLAIN_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildExplainPrompt(finding) }],
      schema: ExplanationSchema,
      maxTokens: options.maxTokens ?? 300,
      temperature: 0,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    const parsed = ExplanationSchema.safeParse(response.json);
    if (!parsed.success) {
      // A model that cannot produce the shape does not get to write prose into
      // a finding by other means.
      logger.warn(`explain: ${finding.ruleId} returned an unusable shape`);
      return finding;
    }

    const suffix =
      parsed.data.suggestedAction === "" ? "" : ` ${parsed.data.suggestedAction}`;

    // Rebuilt field by field rather than spread from the model's object, so a
    // response carrying extra keys cannot reach the Finding.
    return { ...finding, explanation: `${parsed.data.explanation}${suffix}`.trim() };
  } catch (error) {
    // An unexplained finding is still a finding. Losing it because a model was
    // unavailable would be much worse than showing it without prose.
    logger.warn(`explain: ${finding.ruleId} failed`, error);
    return finding;
  }
}

/**
 * Explain a list, worst first.
 *
 * Serial on purpose. A local model has one GPU: issuing these in parallel does
 * not make them finish sooner, and it makes progress reporting meaningless
 * (docs/05 makes the same call for the ToS pipeline).
 */
export async function explainFindings(
  findings: readonly Finding[],
  options: ExplainOptions & { limit?: number; onProgress?: (done: number) => void },
): Promise<Finding[]> {
  const limit = options.limit ?? findings.length;
  const explained: Finding[] = [];

  for (const [index, finding] of findings.entries()) {
    if (index >= limit) {
      explained.push(finding);
      continue;
    }
    explained.push(await explainFinding(finding, options));
    options.onProgress?.(index + 1);
  }

  return explained;
}

export { buildExplainPrompt, EXPLAIN_SYSTEM_PROMPT } from "./prompt.js";
export { ExplanationSchema } from "./schema.js";
export type { Explanation } from "./schema.js";
