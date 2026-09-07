import { z } from "zod";

/**
 * The audit trace (docs/06).
 *
 * Every model call and every tool call, with what went in, what came out, and
 * what it cost. Stored with the audit and rendered in the workbench, which gets
 * a full page because this is the main research payoff (docs/09): the point of
 * a hand-written loop is that you can see exactly what it did.
 *
 * `input` and `output` are typed rather than `unknown`, which the sketch in
 * docs/06 used. Hard rule 2 applies to a trace as much as anything else — it is
 * read back off storage and rendered — and heterogeneous steps are expressible
 * as a discriminated union without giving up validation.
 */

export const ModelStepSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.literal("model"),
  /** What the model was asked, already summarised — never raw page text. */
  prompt: z.string(),
  /** The action it chose, verbatim, so a bad decision is inspectable. */
  response: z.string(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  durationMs: z.number(),
});

export const ToolStepSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.literal("tool"),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
  /** The summary handed back to the model, not the full result. */
  summary: z.string(),
  durationMs: z.number(),
});

export const BudgetStepSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.literal("budget"),
  /** Which limit, and what it was doing when it hit it. */
  limit: z.string(),
  message: z.string(),
  durationMs: z.number(),
});

export const ErrorStepSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.literal("error"),
  name: z.string().optional(),
  message: z.string(),
  durationMs: z.number(),
});

export const TraceStepSchema = z.discriminatedUnion("kind", [
  ModelStepSchema,
  ToolStepSchema,
  BudgetStepSchema,
  ErrorStepSchema,
]);
export type TraceStep = z.infer<typeof TraceStepSchema>;

export const AuditTraceSchema = z.object({
  auditId: z.string(),
  modelId: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  steps: z.array(TraceStepSchema),
  budgetUsed: z.object({
    steps: z.number(),
    fetches: z.number(),
    inputTokens: z.number(),
    wallMs: z.number(),
  }),
  /** Why the loop ended: the model said so, or a limit did. */
  stoppedBy: z.enum(["finish", "steps", "fetches", "inputTokens", "wallMs", "error"]),
});
export type AuditTrace = z.infer<typeof AuditTraceSchema>;

/**
 * A step before the recorder assigns its index.
 *
 * Distributive, because a plain `Omit` over a union collapses to the keys the
 * members have in common — which for these four is nothing useful.
 */
export type NewTraceStep = TraceStep extends infer Step
  ? Step extends { index: number }
    ? Omit<Step, "index">
    : never
  : never;

/** Collects steps as they happen. */
export class TraceRecorder {
  readonly #steps: TraceStep[] = [];

  add(step: NewTraceStep): void {
    this.#steps.push({ ...step, index: this.#steps.length });
  }

  get steps(): TraceStep[] {
    return [...this.#steps];
  }

  /** The tool names in order — what the injection fixtures compare (docs/06). */
  toolSequence(): string[] {
    return this.#steps
      .filter(
        (step): step is Extract<TraceStep, { kind: "tool" }> => step.kind === "tool",
      )
      .map((step) => step.name);
  }
}
