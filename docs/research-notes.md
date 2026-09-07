# Research notes

What this project set out to learn, and what it actually found. Written as the
work happened rather than reconstructed at the end, so the wrong turns are still
in it.

The two questions from the README were: how do you build a local, tool-using
agent for a system with several moving parts, and keep it safe when the input it
reads is controlled by the site being audited — and which local models are
actually good enough for schema-constrained extraction.

## The short version

**The safety question has a clean answer, and it is not the prompt.** A site
cannot steer the audit of itself because the model that chooses tools never sees
the site's text. Policy content is read inside a tool and comes back as counts
and schema-validated clauses. The system prompt also tells the model to ignore
instructions in its inputs, and that is defence in depth, not the mechanism.

**The model question has a sharper answer than expected.** Schema adherence —
the thing we worried about — is a solved problem. Verbatim quoting is not, and
it is what separates a usable model from an unusable one.

## What was wrong in the design, and how we found out

The docs were written before the code. Five things in them turned out to be
false, and each was found by running something rather than by reading.

**docs/12 T7 claimed model weights were verified.** WebLLM ships
`ModelIntegrity` with `onFailure: "error"`, so the mitigation looked like it
existed. Zero of its 163 prebuilt models carry an integrity field. We compute
and commit our own hashes now — and reading the source rather than trusting the
field name turned up a further limit: `verifyIntegrity` is called for the
config, the tokenizer and the model-library WASM, never for the weight shards.
The gigabytes the threat was nominally about still go unchecked, and T7 says so.

**docs/08's `connect-src` could not have downloaded a model.** It enumerated
`cdn-lfs` hostnames; HuggingFace now serves weights from its Xet backend on
hosts like `us.aws.cdn.hf.co`, and the model library is a `.wasm` from
`raw.githubusercontent.com` — two vendors, not one. What makes this worth
recording is how it hid: with the engine in a Web Worker the blocked fetch never
surfaced as a CSP error and the download appeared to work. It only failed
visibly under the document's own policy on the main thread. A `connect-src` that
is wrong can look fine for a long time.

**docs/06 understated the cancellation problem.** It flagged that
`interruptGenerate()` was undocumented. The reality is worse: there is no
`AbortSignal` anywhere in WebLLM's API, and interrupting does not merely stop
generation — it leaves the engine returning empty `finish_reason: "abort"`
responses forever after. `resetChat()` does not clear it. `reload()` does not
either. Only building a new engine recovers, at 5 s for a 0.5B model and 36 s
for an 8B one. Reproduced across every variation that might have been our own
mistake: interrupting from inside the consumer loop and from a timer, awaited
and fire-and-forget, in a worker and on the main thread, on three models.

The consequence shaped the loop. Budgets are enforced by _not starting_ the next
call, which costs nothing and is where enforcement belonged anyway.
Interruption is for the user's stop button, and the provider owns the rebuild so
the agent never sees a half-working engine.

**docs/05 assumed core could run readability.** It cannot: both readability and
turndown need a real DOM, and core has no DOM types at all — that absence is how
hard rule 1 is enforced by the compiler rather than by discipline. Extraction
became a host capability, like DOM parsing before it.

**docs/02 claimed both halves of the DOM port were checked at compile time.**
Only the browser half is. linkedom types `parseHTML` as returning
`Window & typeof globalThis`, and the CLI has no DOM lib, so that resolves to
nothing the compiler can check. The Node half is verified by a runtime
conformance test instead, and the doc now says the compiler will not catch drift
there. This one was our own claim, made in a commit message, and corrected in
the next one.

## What the measurements said

### Throughput (spike S2, Apple M4)

| Model        | Load  | Prefill @1900 tok | Decode     |
| ------------ | ----- | ----------------- | ---------- |
| Qwen2.5-0.5B | 11 s  | 1378 tok/s        | 40 tok/s   |
| Qwen2.5-1.5B | 31 s  | 426 tok/s         | 20.5 tok/s |
| Llama-3.1-8B | 164 s | 112 tok/s         | 8.3 tok/s  |

The 8B row settled a design question. Seventeen seconds to read one
1900-token prompt puts a 40k-token policy at roughly six minutes of prefill
before any decoding. Whatever its quality, it is not viable for this pipeline on
this hardware. It belongs in the evals as a ceiling, not as a default.

### Extraction quality (M7, same hardware)

| Model        | Recall | Verbatim quotes | Schema adherence |
| ------------ | ------ | --------------- | ---------------- |
| Qwen2.5-0.5B | 10–20% | **38%**         | 100%             |
| Qwen2.5-1.5B | 50–80% | 91–100%         | 100%             |

Both models produced valid JSON for every chunk of both fixtures. The worry that
a small model could not hold a fixed schema was misplaced — grammar constraint
in the WASM runtime works as well on 0.5B as on 1.5B.

The 0.5B model paraphrased or invented 62% of its quotes. Verification dropped
every one. Without that check its report would have been fluent, plausible, and
largely unsupported by the document it claimed to quote.

**That is the finding this project would most want repeated.** The failure mode
of a small model on this task is not malformed output that a parser rejects. It
is well-formed output that is not true. A schema tells you the shape is right
and says nothing about whether the content is real, and the only thing that
distinguishes them is checking the quote against the source.

## What held up

**The `Capabilities` seam.** Every host-specific thing that turned up — HTTP,
storage, DOM parsing, readable-text extraction, the clock, the model — was
absorbed by adding a member, never by weakening core. The compiler enforcing
"no DOM, no Node" made that a real constraint rather than an aspiration; twice
it caught host code sliding into core, once in a test.

**Reporting what could not be observed.** The `limitations` array on a snapshot,
the "checks skipped" findings, the ToS report's limitations, the caveat on HSTS
findings when the preload list is absent. The rule that a check which did not
run must not read like a check that passed came up in five different places, and
each time it was the right call. The one bug the agent loop turned up was a
violation of it: stale skip findings surviving after the analyzers re-ran.

**Verification over trust, everywhere.** Quotes checked against the source.
Recordings validated against the caller's schema rather than trusted because we
wrote them. Stored audits re-parsed on the way out. Model output rebuilt field by
field rather than spread, so a model returning a severity alongside its
explanation cannot reach a `Finding`.

## What we would do differently

**Write the throughput spike first, not third.** S2's numbers invalidated
budget defaults, chunk sizing, model choice, and the cancellation design.
Everything written before it that touched performance had to be revised.

**Do not describe a mitigation before checking it exists.** T7 and the
`connect-src` were both written as though implemented. Both were plausible and
both were false, and both would have shipped a claim the code did not support.

**Two fixtures is not enough to rank models.** They are enough to show that
verification is load-bearing and that 0.5B is unusable. They are not enough to
choose between two close models, and the numbers should not be read as if they
were.

## Still open

- The side panel's own document lifetime under a long run — the one thing spike
  S2 could not reach, because Chrome refuses automated navigation to extension
  pages.
- Whether an offscreen document can run WebGPU and survive going idle (S3).
  `chrome.offscreen` exists only in the background worker, and Chrome 152
  refuses both `--load-extension` and CDP access to a service worker, so this
  needs a person. The workbench has a one-click probe for it.
- Firefox. Its WebGPU support differs and may rule it out. Not yet checked, and
  worth checking rather than assuming.
