import { z } from "zod";

import type { ModelCapabilities } from "../providers/types.js";

/**
 * Budgets (docs/06, hard rule 5).
 *
 * Constructor arguments, not constants buried in code, with defaults derived
 * from the active model rather than guessed. The original numbers —
 * `maxInputTokens: 150_000`, `maxWallMs: 120_000` — assumed a hosted frontier
 * model and do not survive contact with a 1.5B model on integrated graphics.
 *
 * Spike S2 supplies the throughput; `provider.capabilities()` supplies the
 * context window. Deriving a default is not the same as burying a constant.
 */

export const BudgetSchema = z.object({
  maxSteps: z.number().int().positive(),
  maxNetworkFetches: z.number().int().nonnegative(),
  maxInputTokens: z.number().int().positive(),
  maxWallMs: z.number().int().positive(),
  /** The page's own host by default; the user may extend it. */
  allowedDomains: z.array(z.string()),
});
export type Budget = z.infer<typeof BudgetSchema>;

/** Measured on the default model in spike S2 (docs/05 §4). */
const DECODE_TOKENS_PER_SEC = 20;

export interface BudgetDefaults {
  capabilities: ModelCapabilities;
  allowedDomains: readonly string[];
  /** Model calls the loop may make. */
  maxSteps?: number;
}

export function defaultBudget(input: BudgetDefaults): Budget {
  const maxSteps = input.maxSteps ?? 12;

  return {
    maxSteps,
    maxNetworkFetches: 6,
    // A step cannot exceed the window, and the loop cannot exceed the window
    // times the steps it is allowed. Anything larger is arithmetic nobody has
    // the patience for.
    maxInputTokens: input.capabilities.contextTokens * maxSteps,
    // Generous, because the alternative is worse: S2 showed a run cannot be
    // stopped partway without killing the engine, so this bound is enforced by
    // not starting the next call.
    maxWallMs: Math.round((maxSteps * 400 * 1000) / DECODE_TOKENS_PER_SEC),
    allowedDomains: [...input.allowedDomains],
  };
}

export type BudgetKind = "steps" | "fetches" | "inputTokens" | "wallMs" | "domain";

/** Thrown from inside a tool. The loop catches it, records it, and finishes. */
export class BudgetExceeded extends Error {
  constructor(
    readonly kind: BudgetKind,
    message: string,
  ) {
    super(message);
    this.name = "BudgetExceeded";
  }
}

export interface BudgetUsed {
  steps: number;
  fetches: number;
  inputTokens: number;
  wallMs: number;
}

/**
 * Enforcement lives here rather than in the loop's arithmetic, so a tool cannot
 * quietly spend past a limit and so the trace has one place that knows what was
 * consumed.
 *
 * Everything is checked *before* the spend, never after. S2 established that a
 * model call in flight cannot be stopped without destroying the engine, so a
 * limit that only notices afterwards is not a limit.
 */
export class BudgetTracker {
  #steps = 0;
  #fetches = 0;
  #inputTokens = 0;
  readonly #startedAt: number;
  readonly #now: () => number;

  constructor(
    readonly budget: Budget,
    now: () => number,
  ) {
    this.#now = now;
    this.#startedAt = now();
  }

  get used(): BudgetUsed {
    return {
      steps: this.#steps,
      fetches: this.#fetches,
      inputTokens: this.#inputTokens,
      wallMs: this.#now() - this.#startedAt,
    };
  }

  /** True while another model call is affordable. Checked before starting one. */
  canTakeStep(): boolean {
    return (
      this.#steps < this.budget.maxSteps &&
      this.#now() - this.#startedAt < this.budget.maxWallMs &&
      this.#inputTokens < this.budget.maxInputTokens
    );
  }

  /** Why the loop stopped, for the trace. */
  exhaustedBy(): BudgetKind | undefined {
    if (this.#steps >= this.budget.maxSteps) return "steps";
    if (this.#now() - this.#startedAt >= this.budget.maxWallMs) return "wallMs";
    if (this.#inputTokens >= this.budget.maxInputTokens) return "inputTokens";
    return undefined;
  }

  recordStep(inputTokens: number): void {
    this.#steps += 1;
    this.#inputTokens += inputTokens;
  }

  /** Throws rather than returning false: a tool must not proceed past this. */
  spendFetch(): void {
    if (this.#fetches >= this.budget.maxNetworkFetches) {
      throw new BudgetExceeded(
        "fetches",
        `network budget exhausted after ${String(this.#fetches)} fetches`,
      );
    }
    this.#fetches += 1;
  }

  /**
   * The allowed-domain check, done by the tool before any request.
   *
   * The background worker checks again on its own authority (docs/12 T2). Two
   * checks is the point: this one gives the model a useful error, and that one
   * is the actual boundary.
   */
  assertDomainAllowed(url: string): void {
    let hostname: string;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      throw new BudgetExceeded("domain", `not a URL: ${url}`);
    }

    const allowed = this.budget.allowedDomains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
    if (!allowed) {
      throw new BudgetExceeded(
        "domain",
        `${hostname} is not in this audit's allowed domains`,
      );
    }
  }
}
