import { z } from "zod";

import type { Capabilities } from "../capabilities.js";
import type { Finding } from "../findings/schema.js";
import type { PageSnapshot } from "../snapshot/schema.js";
import type { TosReport } from "../tos/schema.js";
import { BudgetExceeded, BudgetTracker, type Budget } from "./budget.js";
import {
  buildSystemPrompt,
  describeFindingsForModel,
  describeSnapshot,
} from "./prompts.js";
import { AGENT_TOOLS } from "./tools.js";
import { TraceRecorder, type AuditTrace } from "./trace.js";
import type { Tool, ToolContext } from "./types.js";

/**
 * The orchestrator (docs/06).
 *
 * A plain think → act → observe loop, hand-written so its behaviour is fully
 * inspectable. That is the research artifact: every decision it makes is in the
 * trace, and the trace replays.
 */

/**
 * The JSON action protocol — the only tool-calling path (docs/01).
 *
 * Not a fallback. Spike S2 found WebLLM does not constrain `tools`; it injects
 * them into the system prompt via the model's chat template and hopes, which
 * fails silently on models without one. A `response_format` schema *is*
 * grammar-constrained in the WASM runtime, so this is the path that actually
 * holds.
 *
 * `input` is a loose record here on purpose. Asking a small model to satisfy a
 * discriminated union over seven different input shapes is a lot; asking it for
 * a tool name and an object is not. The named tool's own zod schema validates
 * the object immediately afterwards, and a failure goes back to the model as a
 * correction rather than ending the run.
 */
export const AgentActionSchema = z.object({
  reasoning: z.string().max(500),
  tool: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
});
export type AgentAction = z.infer<typeof AgentActionSchema>;

export interface OrchestratorOptions {
  capabilities: Capabilities;
  budget: Budget;
  auditId: string;
  tools?: readonly Tool[];
  /** Findings the deterministic pass already produced. */
  findings?: readonly Finding[];
  trackerDb?: ToolContext["trackerDb"];
  libraryDb?: ToolContext["libraryDb"];
  signal?: AbortSignal;
}

export interface AgentResult {
  findings: Finding[];
  tosReport?: TosReport;
  summary: string;
  trace: AuditTrace;
}

const MAX_OUTPUT_TOKENS = 400;

export async function runAgent(
  snapshot: PageSnapshot,
  options: OrchestratorOptions,
): Promise<AgentResult> {
  const { capabilities } = options;
  const tools = options.tools ?? AGENT_TOOLS;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const tracker = new BudgetTracker(options.budget, () => capabilities.clock.now());
  const trace = new TraceRecorder();
  const startedAt = capabilities.clock.now();

  const ctx: ToolContext = {
    snapshot,
    budget: tracker,
    caps: capabilities,
    findings: [...(options.findings ?? [])],
    ...(options.trackerDb === undefined ? {} : { trackerDb: options.trackerDb }),
    ...(options.libraryDb === undefined ? {} : { libraryDb: options.libraryDb }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };

  const system = buildSystemPrompt(tools);
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    {
      role: "user",
      content: [
        "Here is the page.",
        "",
        describeSnapshot(snapshot),
        "",
        "Findings so far:",
        describeFindingsForModel(ctx.findings),
        "",
        "Choose the next tool to call.",
      ].join("\n"),
    },
  ];

  let summary = "";
  let stoppedBy: AuditTrace["stoppedBy"] = "steps";

  while (tracker.canTakeStep()) {
    options.signal?.throwIfAborted();

    capabilities.progress.emit({
      stage: "agent",
      current: tracker.used.steps + 1,
      total: options.budget.maxSteps,
      message: `Deciding what to do next (step ${String(tracker.used.steps + 1)})`,
    });

    const stepStarted = capabilities.clock.now();
    let action: AgentAction;
    let raw: string;

    try {
      const response = await capabilities.provider.complete({
        system,
        // A copy: the provider gets the history as it was when asked, not a
        // live handle on it. Otherwise a recording made from the request would
        // capture messages appended after the call.
        messages: messages.map((message) => ({ ...message })),
        schema: AgentActionSchema,
        maxTokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });

      const parsed = AgentActionSchema.safeParse(response.json);
      if (!parsed.success) {
        // Not fatal. The model gets told what was wrong and tries again — that
        // is the whole point of the loop being a loop.
        trace.add({
          kind: "error",
          message: `unusable action: ${parsed.error.issues[0]?.message ?? "invalid"}`,
          durationMs: capabilities.clock.now() - stepStarted,
        });
        tracker.recordStep(response.usage.inputTokens);
        messages.push({
          role: "user",
          content: "That was not a valid action. Reply with JSON matching the schema.",
        });
        continue;
      }

      action = parsed.data;
      raw = JSON.stringify(action);
      tracker.recordStep(response.usage.inputTokens);

      trace.add({
        kind: "model",
        prompt: messages[messages.length - 1]?.content ?? "",
        response: raw,
        usage: response.usage,
        durationMs: capabilities.clock.now() - stepStarted,
      });
    } catch (error) {
      trace.add({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
        durationMs: capabilities.clock.now() - stepStarted,
      });
      stoppedBy = "error";
      break;
    }

    messages.push({ role: "assistant", content: raw });

    const tool = byName.get(action.tool);
    if (tool === undefined) {
      messages.push({
        role: "user",
        content: `There is no tool called "${action.tool}". Choose one of: ${[...byName.keys()].join(", ")}.`,
      });
      trace.add({
        kind: "error",
        name: action.tool,
        message: "unknown tool",
        durationMs: 0,
      });
      continue;
    }

    const input = tool.input.safeParse(action.input);
    if (!input.success) {
      // Returned to the model as a correction (docs/06), not thrown.
      const message = input.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      messages.push({
        role: "user",
        content: `The input to ${tool.name} was not valid: ${message}. Try again.`,
      });
      trace.add({
        kind: "error",
        name: tool.name,
        message: `invalid input: ${message}`,
        durationMs: 0,
      });
      continue;
    }

    const toolStarted = capabilities.clock.now();
    try {
      const result = await tool.run(input.data, ctx);
      trace.add({
        kind: "tool",
        name: tool.name,
        input: action.input,
        summary: result,
        durationMs: capabilities.clock.now() - toolStarted,
      });

      if (tool.name === "finish") {
        summary = result;
        stoppedBy = "finish";
        break;
      }

      messages.push({ role: "user", content: `${tool.name} returned:\n${result}` });
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        // The loop records it and forces a finish (docs/06). Carrying on would
        // mean spending a budget that is already gone.
        trace.add({
          kind: "budget",
          limit: error.kind,
          message: error.message,
          durationMs: capabilities.clock.now() - toolStarted,
        });
        messages.push({
          role: "user",
          content: `${tool.name} could not run: ${error.message}. Call finish.`,
        });
        continue;
      }

      trace.add({
        kind: "error",
        name: tool.name,
        message: error instanceof Error ? error.message : String(error),
        durationMs: capabilities.clock.now() - toolStarted,
      });
      messages.push({
        role: "user",
        content: `${tool.name} failed. Choose something else, or call finish.`,
      });
    }
  }

  if (stoppedBy === "steps") {
    // `domain` is a per-call refusal, not a reason the loop ended, so it never
    // appears here.
    const exhausted = tracker.exhaustedBy();
    stoppedBy = exhausted === undefined || exhausted === "domain" ? "steps" : exhausted;
  }

  return {
    findings: ctx.findings,
    ...(ctx.tosReport === undefined ? {} : { tosReport: ctx.tosReport }),
    summary,
    trace: {
      auditId: options.auditId,
      modelId: capabilities.provider.id,
      startedAt,
      endedAt: capabilities.clock.now(),
      steps: trace.steps,
      budgetUsed: tracker.used,
      stoppedBy,
    },
  };
}
