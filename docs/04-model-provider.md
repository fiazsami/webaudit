# 04 — ModelProvider

One narrow interface; every model call in the project goes through it. There is
now exactly one real adapter — WebLLM, running in the browser over WebGPU — plus
a recording/replay wrapper that makes the whole system testable without a GPU.

Keeping the abstraction with a single implementation is deliberate. It is what
lets `RecordingProvider` exist, what keeps model-specific quirks out of the
agent loop, and what makes swapping models a settings change rather than a
refactor.

## Interface

Unchanged from the desktop design.

```ts
export interface ModelCapabilities {
  contextTokens: number; // usable context window
  supportsJsonSchema: boolean; // constrained structured output
  supportsToolCalls: boolean; // native tool/function calling
  supportsStreaming: boolean;
  costPer1kInput?: number; // undefined for local
  costPer1kOutput?: number;
}

export interface CompletionRequest {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  schema?: z.ZodTypeAny; // if set, response must be JSON matching this
  tools?: ToolSpec[]; // optional; see docs/06
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface CompletionResponse {
  text?: string;
  json?: unknown; // parsed + validated against `schema` if given
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  usage: { inputTokens: number; outputTokens: number };
  raw?: unknown; // provider response, for the trace
}

export interface ModelProvider {
  id: string; // "webllm:Llama-3.1-8B-Instruct-q4f32_1-MLC"
  capabilities(): Promise<ModelCapabilities>;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  countTokens(text: string): number; // approximate is fine
}
```

## WebLLM adapter (`providers/webllm.ts`)

`@mlc-ai/web-llm`, Apache-2.0. Runs quantized models in the browser over WebGPU
with an OpenAI-shaped API.

Because it needs WebGPU, this adapter **cannot live in `packages/core`'s Node
path** (hard rule 1). It ships as a browser-only entry point that the extension
imports and Node never touches.

| Interface member               | WebLLM                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `id`                           | `webllm:<mlc model id>`                                                           |
| `capabilities().contextTokens` | the model record's `context_window_size` override                                 |
| `supportsJsonSchema`           | `true` — grammar-constrained in the WASM runtime, not prompt-coaxed               |
| `supportsToolCalls`            | `false` — `tools`/`tool_choice` are upstream WIP                                  |
| `supportsStreaming`            | `true`                                                                            |
| `costPer1k*`                   | `undefined`                                                                       |
| `complete({ schema })`         | `response_format` with the JSON Schema from `zod-to-json-schema`                  |
| `complete({ signal })`         | `interruptGenerate()` — **verify: not in the published API reference. Spike S2.** |
| `countTokens`                  | `gpt-tokenizer` estimate, reconciled against the `usage` the response returns     |

Engine construction runs in a Web Worker (`CreateWebWorkerMLCEngine`) so a long
prefill does not freeze the side panel UI.

### Model download

New surface with no analogue in the hosted/Ollama design: the first use of a
model downloads gigabytes of weights from the HuggingFace CDN. `initProgressCallback`
feeds the `model.progress` channel in docs/07 and the model manager in docs/09.

Set the per-model SRI `integrity` field with `onFailure: "error"`. This is the
mitigation for docs/12 T7 — weights are the one large thing we pull from the
network, and they should be verified.

### Structured output strategy

When `schema` is provided:

1. `supportsJsonSchema` is true, so always pass the JSON Schema via
   `response_format`. The runtime constrains generation; malformed JSON is not
   a failure mode we have to handle.
2. Validate with zod regardless. Grammar constraint guarantees _shape_, not
   _sense_ — enum values and string contents still need checking.
3. On validation failure, retry once with the error appended. On second failure
   throw `SchemaViolationError`; the caller decides whether to degrade.

Never let unvalidated JSON escape the provider layer.

Path 2 of the old design — "put the schema in the prompt, instruct respond with
only JSON, strip code fences, parse" — is deleted. No supported model needs it.

### Tool calling strategy

`supportsToolCalls` is false, so the JSON action protocol is **the only path**,
not a fallback:

```ts
{ action: "tool", name: string, input: object } | { action: "final", answer: object }
```

Expressed as a zod schema and passed through `response_format`, so the grammar
enforces it. This is a meaningful advantage over the old prompt-and-hope
fallback: a small model cannot emit a syntactically invalid action.

Small models still choose _badly_ — wrong tool, wrong arguments — which is why
docs/06 validates every tool input separately and why budgets are hard limits.

## Recording provider (`providers/recording.ts`)

Wraps any provider, writes every request/response pair to the trace and
optionally to disk. Supports **replay mode**: given a recorded trace, returns
stored responses instead of calling the model.

This is now load-bearing rather than a convenience. CI has no GPU, so replay is
the only way the agent loop is tested automatically (hard rule 6). It lives in
`core` and is the CLI's only provider.

## Selecting chunk sizes

The ToS pipeline and any long-context work must call `capabilities()` and derive
chunk sizes from `contextTokens`, e.g. `chunk = floor(contextTokens * 0.6)` minus
prompt overhead. No hardcoded chunk sizes anywhere.

This matters more than it did with hosted models: a 4k-context local model and a
128k hosted one differ by a factor of thirty in how many map calls a policy
costs. See docs/05.

## Evals

`packages/extension/entrypoints/evals/` — an in-browser page that runs the same
structured-extraction prompt through each configured WebLLM model and compares
schema-adherence rate and field accuracy against labelled fixtures.

promptfoo is not usable here: it is a Node harness and cannot drive WebGPU. The
runner is a small page that loads fixtures, loops over models, and writes JSON to
`evals/results/`. Given "prefer simple, inspectable code", this is a feature.

The comparison is now **across local models** — Qwen2.5-1.5B vs Llama-3.1-8B vs
Phi-3.5-mini — rather than local vs hosted. Narrower, but closer to the question
that actually matters for shipping this: which models are good enough to be
useful on a laptop?
