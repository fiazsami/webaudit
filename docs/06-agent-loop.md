# 06 — Agent loop

The orchestrator decides what to investigate after deterministic analyzers have
run. It's a plain think → act → observe loop, hand-written so its behaviour is
fully inspectable. Build it **last** (Milestone 5) — every tool it calls should
already exist and be tested.

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
2. repeat up to maxSteps:
     resp = caps.provider.complete({ ..., tools })
     if resp.toolCalls is empty → treat as finish with resp.text
     for each call:
        validate input against tool.input (zod); on failure, return error to model
        result = tool.run(input, ctx)   // may throw BudgetExceeded
        append { tool, input, resultSummary } to messages and trace
3. assemble AuditResult
```

Rules:

- Tool results are summarised before being fed back (e.g. findings become
  `id | severity | title`, not full JSON). Full results live in the store.
- Untrusted text (policy content, page text) is never placed in the message
  history raw. It stays inside tools; the model sees schema-validated
  extractions.
- Parallel tool calls are allowed when `sideEffects === "none"`, but note this
  is close to a no-op in practice: one WebLLM engine serialises requests, so
  only non-model tools actually overlap.
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

## Trace

```ts
export const AuditTrace = z.object({
  auditId: z.string(),
  modelId: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  steps: z.array(
    z.object({
      index: z.number(),
      kind: z.enum(["model", "tool", "budget", "error"]),
      name: z.string().optional(),
      input: z.unknown(),
      output: z.unknown(),
      usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
      durationMs: z.number(),
    }),
  ),
  budgetUsed: z.object({
    steps: z.number(),
    fetches: z.number(),
    inputTokens: z.number(),
    wallMs: z.number(),
  }),
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
