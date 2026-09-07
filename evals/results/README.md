# Eval results

Committed so model comparisons are part of the repository's history rather than
something someone once saw on a laptop (docs/11 M7). With only local models
available, choosing the model is the only lever left, which makes these the
project's central research output (docs/05).

| File                     | What it is                                                 |
| ------------------------ | ---------------------------------------------------------- |
| `spike-s2.json`          | Raw throughput and cancellation measurements from spike S2 |
| `policy-extraction.json` | Model comparison on the labelled policy fixtures           |

Reproduce with:

```
pnpm build-model-integrity                     # once
WEBAUDIT_SPIKE=1 pnpm --filter extension build
pnpm run-evals Qwen2.5-0.5B-Instruct-q4f16_1-MLC Qwen2.5-1.5B-Instruct-q4f16_1-MLC
```

It needs a machine with a WebGPU browser. Node cannot drive WebGPU, which is why
the runner is an extension page and the driver is a Puppeteer script rather than
a test.

## Policy extraction — 2026-09-07

Apple M4, macOS 26, Chrome 152, WebGPU on Metal 3.

| Model        | Fixture      | Recall | Verbatim quotes | Schema | Kept / dropped | Time |
| ------------ | ------------ | ------ | --------------- | ------ | -------------- | ---- |
| Qwen2.5-0.5B | fixture-shop | 10%    | **38%**         | 100%   | 6 / 10         | 52s  |
| Qwen2.5-0.5B | social-app   | 20%    | **38%**         | 100%   | 5 / 8          | 31s  |
| Qwen2.5-1.5B | fixture-shop | 50%    | 100%            | 100%   | 15 / 0         | 117s |
| Qwen2.5-1.5B | social-app   | 80%    | 91%             | 100%   | 10 / 1         | 77s  |

### What this says

**Schema adherence is not the problem.** Both models produced valid
`ClauseExtraction` JSON for every chunk — 100% on all four runs. Grammar
constraint in the WASM runtime does what spike S2 said it does, and it does it
as well on a 0.5B model as on a 1.5B one. The worry that small models could not
hold a fixed schema was misplaced.

**Verbatim quoting is the problem, and it is the one that matters.** The 0.5B
model paraphrased or invented **62% of its quotes**. Quote verification caught
every one of them — 18 clauses dropped across the two fixtures — which is
exactly what docs/05 built it for. Without that check, a report from the 0.5B
model would have been more wrong than empty: fluent, plausible, and largely
unsupported by the document it claimed to quote.

That is the strongest argument in these numbers for the pipeline's design. The
failure mode of a small model here is not malformed output that a parser
rejects; it is well-formed output that is not true. Only checking the quote
against the source distinguishes them.

**1.5B is the usable floor, and it is not comfortable.** Half to four-fifths
recall at roughly two minutes per policy. Both models missed `age-restriction`
on every run, which is a prompt problem rather than a model one — the category
exists but nothing in the instructions suggests an age limit is notable.

**The 1.5B model raises two false alarms per fixture.** It flags text the
fixtures mark as harmless — "we do not sell your personal information" among
them. Recall alone would have rewarded that, which is why `shouldNotConcern`
exists.

### What to do about it

- Ship 1.5B as the default. 0.5B is fast and its output cannot be trusted.
- The `age-restriction` miss is a prompt fix, not a model one.
- Llama-3.1-8B is deliberately absent: spike S2 measured it at ~6 minutes of
  prefill for a 40k policy, so its extraction quality is moot on this hardware.
  Worth running once as a ceiling if someone has the patience.
