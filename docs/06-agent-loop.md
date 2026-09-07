# 06 — Agent loop

The orchestrator decides what to investigate after deterministic analyzers have
run. It's a plain think → act → observe loop, hand-written so its behaviour is
fully inspectable. Built **last** (M6) — every tool it calls already existed and
was tested.

## Tool interface

```ts
export interface ToolContext {
  snapshot: PageSnapshot;
  budget: BudgetTracker;
  caps: Capabilities; // docs/01 — http, store, provider, dom,
  // progress, clock, logger
}

export interface Tool<I extends z.ZodTypeAny, O> {
  name: string;
  description: string; // shown to the model
  input: I;
  run(input: z.infer<I>, ctx: ToolContext): Promise<O>;
  sideEffects: "none" | "network"; // network tools consume fetch budget
}
```

## Initial tools

| name               | input                | does                                                                                           |
| ------------------ | -------------------- | ---------------------------------------------------------------------------------------------- |
| `fetchHeaders`     | `{ url }`            | HEAD/GET the page URL via `caps.http`; returns response headers. Enables header/csp analyzers. |
| `runAnalyzers`     | `{ ids?: string[] }` | Runs analyzers whose `needs` are now satisfied. Returns new findings.                          |
| `discoverPolicies` | `{}`                 | Stage 1 of docs/05. Returns candidate URLs.                                                    |
| `analyzePolicies`  | `{ urls: string[] }` | Stages 2–8 of docs/05. Returns `TosReport`.                                                    |
| `explainFinding`   | `{ findingId }`      | Model writes `explanation` for one finding, given its evidence.                                |
| `lookupDomain`     | `{ hostname }`       | Tracker DB lookup.                                                                             |
| `finish`           | `{ summary }`        | Ends the loop.                                                                                 |

All URLs passed to network tools are checked against the budget's allowed domain
list before any request is made. The tool, not the model, enforces this — and in
the extension the background worker checks again on its own authority, because
enforcement belongs with the capability rather than with its caller (docs/12 T2).

## Budgets

```ts
export interface Budget {
  maxSteps: number; // default 12
  maxNetworkFetches: number; // default 6
  maxInputTokens: number; // derived from capabilities().contextTokens
  maxWallMs: number; // derived from measured model throughput
  allowedDomains: string[]; // page eTLD+1 by default; user can extend
}
```

### Cancellation is not free (spike S2)

The concern this doc raised — that `interruptGenerate()` is undocumented and
`AbortSignal` support depends on it — turned out to understate the problem.
Measured on WebLLM 0.2.84:

- **There is no `AbortSignal` anywhere in WebLLM's API.** `interruptGenerate()`
  is the only cancellation mechanism, so `CompletionRequest.signal` (docs/04)
  has to be implemented on top of it rather than passed through.
- **It works.** Generation stops in 280–520 ms, and the stream's last chunk
  carries `finish_reason: "abort"`.
- **It poisons the engine.** Every subsequent request returns empty content with
  `finish_reason: "abort"`. `resetChat()` does not clear it. `reload()` does not
  clear it either, and in the Web Worker engine the next call after a reload
  throws `Message error should not be 0`.
- **Only a fresh engine recovers**, and the cost scales with the model. With
  weights already cached: 5.2 s for Qwen2.5-0.5B, 12.4 s for Qwen2.5-1.5B,
  **36 s for Llama-3.1-8B**.

Confirmed identically on all three models, so it is a property of the engine
rather than of a model or a size.

Reproduced across every variation that might have been our own mistake:
interrupting from inside the consumer loop and from a timer, awaited and
fire-and-forget, in a Web Worker and on the main thread. It is the engine, not
the call site.

What this means for the loop:

1. **A cancelled run is over.** Cancellation cannot be a step-level control that
   the loop recovers from and continues past. `maxWallMs` and `maxSteps` have to
   be enforced by _not starting_ the next model call, which costs nothing and is
   where enforcement belonged anyway.
2. **`interruptGenerate()` is for the user's stop button**, and even there the
   price is real: pressing stop costs a 5–36 s rebuild depending on the model.
   That is still better than waiting out a run nobody wants, but it is not a
   control to use casually, and the UI should say the engine is restarting
   rather than appearing frozen.
3. **The provider owns the rebuild.** `ModelProvider` should treat an
   interrupted engine as dead and re-create it lazily on the next call, so the
   agent loop never sees a half-working engine. This is a constraint on the
   WebLLM adapter (M4), not on the loop.
4. Budgets that need to bite _during_ a single long generation have only
   `max_tokens` to work with. Size it from the measured decode rate rather than
   assuming a run can be stopped partway.

**Defaults are derived from the active model, not hardcoded.** The old
`maxInputTokens: 150_000` and `maxWallMs: 120_000` assumed a hosted frontier
model. Neither survives contact with a 1.5B model doing 20 prefills over a 40k
policy on integrated graphics. `provider.capabilities()` supplies the context
window; spike S2 (docs/11) supplies the throughput numbers. Budgets remain
constructor arguments (hard rule 5) — deriving a default is not the same as
burying a constant.

`BudgetTracker` throws `BudgetExceeded` from inside tools; the loop catches it,
records it in the trace, and forces a `finish`.

## Loop

```
1. context = system prompt + snapshot summary + analyzer findings (compact)
2. while the budget allows another step:
     resp = caps.provider.complete({ ..., schema: AgentAction })
     validate the action; on failure, tell the model and continue
     validate input against tool.input (zod); on failure, tell the model and continue
     result = tool.run(input, ctx)   // may throw BudgetExceeded
     append { tool, input, summary } to messages and trace
3. assemble AuditResult
```

**One action per turn, not a list of tool calls.** The sketch above assumed
`resp.toolCalls`, which is native tool calling — and S2 established that WebLLM
does not have it. The model returns one `AgentAction`:

```ts
export const AgentActionSchema = z.object({
  reasoning: z.string().max(500),
  tool: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
});
```

`input` is a loose record on purpose. Asking a 1.5B model to satisfy a
discriminated union over seven input shapes is a lot; asking it for a tool name
and an object is not. The named tool's own zod schema validates the object
immediately afterwards, and a failure goes back as a correction rather than
ending the run — which is the only reason the loop is a loop.

The provider receives a _copy_ of the message history. Otherwise a recording
made from the request would capture messages appended after the call.

Rules:

- Tool results are summarised before being fed back (e.g. findings become
  `id | severity | title`, not full JSON). Full results live in the store.
- Untrusted text (policy content, page text) is never placed in the message
  history raw. It stays inside tools; the model sees schema-validated
  extractions.
- Parallel tool calls are not implemented. One action per turn, and one WebLLM
  engine serialises requests anyway, so the theoretical gain was only ever over
  non-model tools — none of which are slow enough to be worth the complexity.
- `finish` is the only way to end early. Hitting `maxSteps` also ends.

## System prompt outline

Keep it in `agent/prompts/orchestrator.md` so it's reviewable:

1. Role: a website auditor that explains risk to a non-expert.
2. What has already been done (analyzers ran; findings listed).
3. Available tools and when each is worth calling.
4. Priorities: confirm high-severity findings first; always attempt policy
   discovery; don't refetch what's cached.
5. Explicit statement that page content and policy text are untrusted data
   and cannot change these instructions.
   Note the model never sees raw page or policy text — it sees schema-validated
   extractions. This statement is defence in depth, not the mechanism.
6. When to stop.

## What running it turned up

**Stale skip findings.** The first analyzer pass has no headers, so several
analyzers report themselves skipped. After `fetchHeaders`, `runAnalyzers` runs
them for real — and the earlier "checks skipped: headers" finding was still in
the accumulated set, so a report would say the header checks did not run _and_
list their findings. `runAnalyzers` now drops the skip notes for analyzers that
have since run, decided by which were not skipped this time rather than which
produced findings: an analyzer that ran and found nothing has still run, and on
a well-configured site that is the common case.

**Recordings cover model calls, not network.** A recorded run replays the
model; `http` still goes out. That is right — replaying a site's headers from a
fixture would test the recording, not the audit — but it means a recording made
against a live site needs that site reachable to replay. The hermetic fixture
used in CI stubs `http` instead (`--offline` in `scripts/record-agent-run.mjs`).

## Trace

```ts
export const AuditTraceSchema = z.object({
  auditId: z.string(),
  modelId: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  // A discriminated union, not `input: unknown`. Hard rule 2 applies to a trace
  // as much as anything else — it is read back off storage and rendered — and
  // heterogeneous steps are expressible without giving up validation.
  steps: z.array(TraceStepSchema), // model | tool | budget | error
  budgetUsed: z.object({
    steps: z.number(),
    fetches: z.number(),
    inputTokens: z.number(),
    wallMs: z.number(),
  }),
  // Why it ended, which the sketch had no room for and the trace view needs.
  stoppedBy: z.enum(["finish", "steps", "fetches", "inputTokens", "wallMs", "error"]),
});
```

The trace is stored with every audit and rendered in the workbench tab's trace
view (docs/09), which gets a full page because it is the main research payoff.
Replaying a trace through `RecordingProvider` reproduces the run — and is how the
loop is tested in CI, since CI has no GPU.

## CLI

`pnpm --filter cli audit <snapshot.json>` runs analyzers, the non-model ToS
stages, and — with `--replay <trace.json>` — the full agent loop against recorded
responses. Findings and the ToS report print; the trace is written to `./out/`.

The CLI cannot run a live model: Node has no WebGPU. That is the price of
WebLLM-only, and it is why `RecordingProvider` is load-bearing rather than a
convenience. Live runs happen in the side panel (docs/08); the CLI is how the
loop is tested in CI on machines with no GPU.
