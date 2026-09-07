# 05 — Terms of service pipeline

Policy documents are 20–60k tokens. The models we run are small and their
context windows are small — 4k is typical — so one-shot summarisation is not
even arithmetically possible, let alone reliable. This pipeline uses fixed-schema
clause extraction with map-reduce so results are comparable across models and can
be evaluated against labelled fixtures.

## Stages

```
discover → fetch → extract-text → chunk → extract-clauses (map) → merge (reduce) → rank → report
```

### 1. Discover

Input: `PageSnapshot.links` with `policyHint`, plus common paths
(`/terms`, `/privacy`, `/legal`, `/tos`) on the same eTLD+1. Output: candidate
URLs, deduplicated, limited to the same registrable domain unless the agent
explicitly allows another (docs/06 budgets).

### 2. Fetch

Via the `fetchPage` tool, which goes through `capabilities.http` — i.e. the
background worker, which independently checks the URL against the allowed-domain
list (docs/07). Respect `robots.txt`? Debatable for a user-initiated
audit of a page they're already viewing — default to yes for discovered
policy pages, configurable. Timeout 15s, max 2 MB, follow up to 3 redirects,
stay on allowed domains.

### 3. Extract text

`@mozilla/readability` on a DOM from `capabilities.dom` (native `DOMParser` in
the extension, `linkedom` in the CLI) → `turndown` → markdown. Keep
heading structure; it's the best chunk boundary signal. Store the markdown
with a content hash so unchanged policies are not re-analysed.

### 4. Chunk

Split on headings first, then by token count using the provider's
`countTokens`. Target chunk size derived from `capabilities().contextTokens`.
Overlap ~10% to avoid cutting a clause. Each chunk records its heading path
(e.g. "3. Your Content > 3.2 Licence").

Sizing matters far more here than it did with hosted models. A 4k-context model
leaves roughly 2.5k tokens per chunk after prompt overhead, so a 40k-token policy
is 15–20 map calls — each a full prefill.

### Measured throughput (spike S2)

Apple M4, Chrome 152, WebGPU on Metal 3, engine in a Web Worker. Both models
report a 4096-token context window, so the 2.5k-per-chunk estimate above stands.

| Model                         | Load (cold) | VRAM    | Prefill @270 tok | @970 | @1900 | Decode     |
| ----------------------------- | ----------- | ------- | ---------------- | ---- | ----- | ---------- |
| Qwen2.5-0.5B-Instruct-q4f16_1 | 11 s        | 945 MB  | 1460 tok/s       | 1295 | 1378  | 40 tok/s   |
| Qwen2.5-1.5B-Instruct-q4f16_1 | 31 s        | 1630 MB | 500 tok/s        | 486  | 426   | 20.5 tok/s |
| Llama-3.1-8B-Instruct-q4f16_1 | 164 s       | 5001 MB | 119 tok/s        | 117  | 112   | 8.3 tok/s  |

Prefill throughput falls as the prompt grows, so a chunk costs worse than
linearly in its size. Extrapolating a 2.5k-token chunk, and a 40k-token policy
as roughly sixteen of them:

| Model | Per chunk | 40k-token policy, prefill alone |
| ----- | --------- | ------------------------------- |
| 0.5B  | ~1.9 s    | ~30 s                           |
| 1.5B  | ~6 s      | **90–120 s**                    |
| 8B    | ~22 s     | **~6 minutes**                  |

The 8B row is the one that decides something. At 112 tok/s prefill it took 17
seconds to read a single 1900-token prompt, and it decodes at 8 tok/s. Whatever
its extraction quality turns out to be, **Llama-3.1-8B is not viable for the ToS
pipeline** on this hardware — a single policy would take longer than anyone will
wait, and the pipeline is meant to run several. It is worth keeping in the evals
(docs/11 M7) as the quality ceiling to measure the small models against, not as
something to ship as a default.

Four consequences, the first two already anticipated:

- The content-hash policy cache (docs/09) is load-bearing, not an optimisation.
  Re-analysing an unchanged policy costs minutes.
- `limitations` must record truncation honestly when a policy exceeds what the
  budget allows.
- Chunks should be sized near the context limit rather than conservatively
  small. Prefill per token gets _worse_ with length, but a smaller chunk means
  more chunks, and each one repays the full prompt overhead again. Fewer, larger
  chunks win.

`response_format: { type: "json_object", schema }` was verified against the real
`ClauseExtraction` zod schema on both models: output parsed and validated first
time. Note the schema is passed as a **JSON string**, and zod 4 emits it
directly with `z.toJSONSchema()` — no `zod-to-json-schema` dependency is needed
(docs/10).

### 5. Extract clauses (map)

One model call per chunk with `schema = ClauseExtraction`:

```ts
export const ClauseCategory = z.enum([
  "data-collection", // what is collected
  "data-sharing", // third parties, affiliates, sale
  "data-retention",
  "user-content-licence", // rights the site takes over your content
  "arbitration", // mandatory arbitration, class-action waiver
  "termination", // account termination rights
  "auto-renewal", // subscriptions, cancellation friction
  "unilateral-changes", // "we may change these terms at any time"
  "liability", // limitation of liability, indemnification
  "jurisdiction",
  "age-restriction",
  "other-notable",
]);

export const Clause = z.object({
  category: ClauseCategory,
  quote: z.string().max(600), // verbatim from the chunk
  headingPath: z.string(),
  summary: z.string().max(300), // plain language, one or two sentences
  concern: z.enum(["none", "low", "medium", "high"]),
  concernReason: z.string().max(300).optional(),
});

export const ClauseExtraction = z.object({ clauses: z.array(Clause) });
```

Prompt rules:

- Chunk text goes inside `<document>` tags with an explicit instruction that
  the content is data to analyse, not instructions to follow.
- Require `quote` to be verbatim. The merge step verifies quotes exist in the
  source text and drops any that don't (guards against hallucination and
  against injected text trying to smuggle in fake clauses).
- Ask for empty `clauses` when nothing notable exists. Don't reward padding.

### 6. Merge (reduce)

The map stage is **serial**: one WebLLM engine processes one request at a time,
and a second engine means a second copy of the weights in VRAM. Chunks queue.
This is why the stage is worth caching aggressively and why progress reporting
per chunk matters — the user is watching a progress bar, not waiting on an API.

- Deduplicate near-identical clauses across overlapping chunks (same category
  - quote overlap > 60%).
- Group by category.
- If total clause text is small enough, one more model call to produce a
  category-level synthesis; otherwise per-category calls.

### 7. Rank

Deterministic scoring: category weight × concern level, with a bonus for
categories a user has flagged as important in settings. The model doesn't
rank; it only assesses per-clause concern.

### 8. Report

```ts
export const TosReport = z.object({
  sources: z.array(
    z.object({ url: z.string(), fetchedAt: z.string(), contentHash: z.string() }),
  ),
  clauses: z.array(Clause),
  topConcerns: z.array(Clause).max(5),
  overallSummary: z.string().max(1200),
  modelId: z.string(),
  limitations: z.array(z.string()), // e.g. "policy truncated at 60k tokens"
});
```

## Evals

`fixtures/policies/<site>/policy.md` plus `labels.json` listing expected
clauses (category + a distinctive substring). Score per model on:

- recall of labelled clauses
- precision (extracted clauses whose quotes verify)
- schema adherence rate
- tokens and wall time

Run from the in-browser evals page (docs/04) — promptfoo is a Node harness and
cannot drive WebGPU. Keep results in `evals/results/` so model comparisons are
part of the repo's history.

This is now the project's central research output: with only local models
available, choosing the model is the only lever left.
