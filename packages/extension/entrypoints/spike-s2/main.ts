import {
  CreateMLCEngine,
  CreateWebWorkerMLCEngine,
  prebuiltAppConfig,
  type ChatCompletionRequestNonStreaming,
  type InitProgressReport,
  type MLCEngineInterface,
} from "@mlc-ai/web-llm";
import { z } from "zod";

/**
 * Spike S2 (docs/11): does WebLLM work in an extension page, does
 * `response_format` honour a real zod schema, can generation be cancelled, and
 * how fast is it on this hardware.
 *
 * This runs as an extension page so it inherits the manifest CSP — including
 * the `wasm-unsafe-eval` and `connect-src` entries WebLLM needs (docs/08). A
 * side panel is an extension document of exactly this kind, so what holds here
 * holds there; the one thing this cannot show is the panel's own lifetime
 * behaviour.
 *
 * Everything is exposed on `window.__s2` so a CDP driver can run it
 * unattended and collect structured results.
 */

const logEl = document.getElementById("log");

function log(message: string): void {
  if (logEl !== null) logEl.textContent += `${message}\n`;
  console.info(message);
}

/** A realistic ToS clause-extraction schema, not a toy (docs/05). */
const ClauseSchema = z.object({
  category: z.enum([
    "data-sharing",
    "arbitration",
    "licence-grant",
    "auto-renewal",
    "retention",
    "other",
  ]),
  severity: z.enum(["low", "medium", "high"]),
  quote: z.string(),
  plain_language: z.string(),
});
const ExtractionSchema = z.object({ clauses: z.array(ClauseSchema) });

const POLICY_EXCERPT = `
3.2 Licence. By submitting content you grant us a worldwide, irrevocable,
perpetual, royalty-free licence to reproduce, modify, adapt, publish and
distribute that content in any media now known or later developed.
7.1 Arbitration. Any dispute shall be resolved by binding individual
arbitration. You waive any right to a jury trial and to participate in a class
action.
`.trim();

interface WebGpuInfo {
  available: boolean;
  vendor?: string | undefined;
  architecture?: string | undefined;
  description?: string | undefined;
  maxBufferSize?: number | undefined;
  maxStorageBufferBindingSize?: number | undefined;
  error?: string | undefined;
}

async function webgpuInfo(): Promise<WebGpuInfo> {
  const gpu = (navigator as unknown as { gpu?: GPU }).gpu;
  if (gpu === undefined)
    return { available: false, error: "navigator.gpu is undefined" };

  try {
    const adapter = await gpu.requestAdapter();
    if (adapter === null)
      return { available: false, error: "requestAdapter returned null" };

    const info = adapter.info as unknown as {
      vendor?: string;
      architecture?: string;
      description?: string;
    };
    return {
      available: true,
      vendor: info.vendor,
      architecture: info.architecture,
      description: info.description,
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    };
  } catch (error) {
    return { available: false, error: String(error) };
  }
}

/**
 * The same worker the real provider uses (`lib/webllm.worker.ts`), not a copy.
 * Two of them would mean two 6 MB bundles, and the spike measuring something
 * subtly different from what ships.
 */
function createWorker(): Worker {
  return new Worker(new URL("../../lib/webllm.worker.ts", import.meta.url), {
    type: "module",
  });
}

interface LoadResult {
  modelId: string;
  inWorker: boolean;
  loadMs: number;
  vramRequiredMB: number | undefined;
  contextWindowSize: number | undefined;
  hasIntegrityField: boolean;
}

let engine: MLCEngineInterface | undefined;
let currentModelId: string | undefined;

/**
 * `inWorker` is a real variable, not a convenience: docs/08 wants the engine in
 * a Web Worker so prefill does not block the UI, and whether cancellation
 * behaves the same on both sides of that boundary is the question that decides
 * whether budgets are enforceable (docs/06).
 */
async function load(modelId: string, inWorker = true): Promise<LoadResult> {
  await unload();

  const record = prebuiltAppConfig.model_list.find((m) => m.model_id === modelId);
  const started = performance.now();
  const options = {
    initProgressCallback: (report: InitProgressReport) => {
      log(`  load ${modelId}: ${report.text}`);
    },
  };

  engine = inWorker
    ? await CreateWebWorkerMLCEngine(createWorker(), modelId, options)
    : await CreateMLCEngine(modelId, options);

  currentModelId = modelId;
  const loadMs = Math.round(performance.now() - started);
  const config = await engine.getMessage().catch(() => undefined);
  void config;

  return {
    modelId,
    inWorker,
    loadMs,
    vramRequiredMB: record?.vram_required_MB,
    contextWindowSize: record?.overrides?.context_window_size ?? undefined,
    hasIntegrityField: record?.integrity !== undefined,
  };
}

async function unload(): Promise<void> {
  if (engine === undefined) return;
  await engine.unload().catch(() => undefined);
  engine = undefined;
}

interface SchemaResult {
  ok: boolean;
  raw: string;
  parsed?: unknown;
  zodError?: string | undefined;
  usage?: { prefillTokens: number; decodeTokens: number };
  prefillTokensPerSec?: number | undefined;
  decodeTokensPerSec?: number | undefined;
  wallMs: number;
}

/**
 * The question docs/05 depends on: does `response_format` actually constrain
 * output to a schema zod will then accept? A model that produces "nearly JSON"
 * is unusable for map-reduce extraction.
 */
async function schemaRun(): Promise<SchemaResult> {
  if (engine === undefined) throw new Error("no engine loaded");

  // WebLLM takes the JSON Schema as a *string*, so the zod schema is the source
  // of truth on both sides of the call.
  const schema = JSON.stringify(z.toJSONSchema(ExtractionSchema));

  const request: ChatCompletionRequestNonStreaming = {
    messages: [
      {
        role: "system",
        content:
          "You extract clauses from terms of service. Reply only with JSON matching the schema.",
      },
      {
        role: "user",
        content: `Extract every clause from the policy text below.\n\n<policy>\n${POLICY_EXCERPT}\n</policy>`,
      },
    ],
    response_format: { type: "json_object", schema },
    max_tokens: 512,
    temperature: 0,
  };

  const started = performance.now();
  const completion = await engine.chat.completions.create(request);
  const wallMs = Math.round(performance.now() - started);

  const raw = completion.choices[0]?.message.content ?? "";
  const usage = completion.usage;

  const result: SchemaResult = {
    ok: false,
    raw,
    wallMs,
    ...(usage === undefined
      ? {}
      : {
          usage: {
            prefillTokens: usage.prompt_tokens,
            decodeTokens: usage.completion_tokens,
          },
          prefillTokensPerSec: usage.extra?.prefill_tokens_per_s,
          decodeTokensPerSec: usage.extra?.decode_tokens_per_s,
        }),
  };

  try {
    const parsed: unknown = JSON.parse(raw);
    const validated = ExtractionSchema.safeParse(parsed);
    result.ok = validated.success;
    result.parsed = parsed;
    if (!validated.success) result.zodError = validated.error.issues[0]?.message;
  } catch (error) {
    result.zodError = `not JSON at all: ${String(error)}`;
  }

  return result;
}

interface CancelResult {
  interrupted: boolean;
  elapsedMs: number;
  finishReason?: string | undefined;
  chunksBeforeInterrupt: number;
  /** Does the next request work with no intervention? */
  engineUsableAfter: boolean;
  /** Does it work after an explicit resetChat()? */
  engineUsableAfterReset: boolean;
  /** And after a full model reload, with what that cost. */
  engineUsableAfterReload: boolean;
  reloadMs?: number | undefined;
  recoveryError?: string | undefined;
  /** Exactly what each recovery attempt returned. */
  probes?: Array<{ label: string; content: string; finishReason?: string | undefined }>;
  error?: string;
}

/**
 * The risk docs/06 flags: budgets are unenforceable if a run cannot be stopped.
 * WebLLM exposes no `AbortSignal` anywhere in its API — `interruptGenerate()`
 * is the only mechanism, so this checks that it works from the document while
 * the engine is busy in a worker, and that the engine still works afterwards.
 */
async function cancelRun(): Promise<CancelResult> {
  if (engine === undefined) throw new Error("no engine loaded");

  const started = performance.now();
  let chunks = 0;
  let finishReason: string | undefined;

  try {
    const stream = await engine.chat.completions.create({
      messages: [{ role: "user", content: "Write a very long essay about the sea." }],
      max_tokens: 2000,
      temperature: 0.7,
      stream: true,
    });

    // Interrupt from a timer rather than from inside the consumer loop. That is
    // how a cancel button or a budget watchdog would actually do it, and
    // awaiting the interrupt inside the loop stalls the generator that is
    // supposed to be observing the flag.
    const timer = setTimeout(() => {
      void engine?.interruptGenerate();
    }, 500);

    try {
      for await (const chunk of stream) {
        chunks += 1;
        finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return {
      interrupted: false,
      elapsedMs: Math.round(performance.now() - started),
      chunksBeforeInterrupt: chunks,
      engineUsableAfter: false,
      engineUsableAfterReset: false,
      engineUsableAfterReload: false,
      error: String(error),
    };
  }

  const elapsedMs = Math.round(performance.now() - started);

  // An interrupt that leaves the engine wedged is not a usable cancellation.
  // Distinguish "works straight away" from "works after resetChat", because the
  // agent loop has to know which one it must do (docs/06).
  const probes: Array<{
    label: string;
    content: string;
    finishReason?: string | undefined;
  }> = [];

  const probe = async (label: string): Promise<boolean> => {
    const after = await engine!.chat.completions.create({
      messages: [{ role: "user", content: "Say OK." }],
      max_tokens: 10,
      temperature: 0,
    });
    const content = after.choices[0]?.message.content ?? "";
    probes.push({
      label,
      content,
      finishReason: after.choices[0]?.finish_reason ?? undefined,
    });
    return content.length > 0;
  };

  let engineUsableAfter = false;
  let engineUsableAfterReset = false;
  let engineUsableAfterReload = false;
  let reloadMs: number | undefined;
  let recoveryError: string | undefined;

  try {
    engineUsableAfter = await probe("immediately after interrupt");
  } catch (error) {
    recoveryError = `direct: ${String(error)}`;
  }

  // An interrupted engine can fail by returning empty content rather than
  // throwing, so recovery is attempted whenever the probe did not succeed —
  // not only when it threw. The first version of this test missed that and
  // reported resetChat as ineffective without ever having called it.
  if (engineUsableAfter) {
    engineUsableAfterReset = true;
    engineUsableAfterReload = true;
  } else {
    try {
      await engine.resetChat();
      engineUsableAfterReset = await probe("after resetChat");
      if (!engineUsableAfterReset) {
        // Does a full model reload bring it back, and what does that cost? This
        // is the number that decides whether budget enforcement is affordable
        // (docs/06).
        const reloadStarted = performance.now();
        await engine.reload(currentModelId!);
        reloadMs = Math.round(performance.now() - reloadStarted);
        engineUsableAfterReload = await probe("after reload");
      }
    } catch (resetError) {
      recoveryError = `${recoveryError ?? "empty response"} | after resetChat: ${String(resetError)}`;
    }
  }

  return {
    interrupted: chunks < 2000,
    elapsedMs,
    ...(finishReason === undefined ? {} : { finishReason }),
    chunksBeforeInterrupt: chunks,
    engineUsableAfter,
    engineUsableAfterReset,
    engineUsableAfterReload,
    reloadMs,
    recoveryError,
    probes,
  };
}

/** Prefill cost as a function of prompt size — what docs/05 chunk sizing needs. */
async function prefillCurve(sizes: number[]): Promise<
  Array<{
    approxTokens: number;
    prefillTokensPerSec: number | undefined;
    wallMs: number;
  }>
> {
  if (engine === undefined) throw new Error("no engine loaded");
  const out: Array<{
    approxTokens: number;
    prefillTokensPerSec: number | undefined;
    wallMs: number;
  }> = [];

  for (const size of sizes) {
    // ~4 characters per token is the usual rule of thumb; the exact count comes
    // back in usage.prompt_tokens, which is what gets reported.
    const filler = "The quick brown fox jumps over the lazy dog. ".repeat(
      Math.ceil((size * 4) / 44),
    );
    const started = performance.now();
    const completion = await engine.chat.completions.create({
      messages: [
        { role: "user", content: `${filler}\n\nReply with the single word: ok` },
      ],
      max_tokens: 4,
      temperature: 0,
    });
    out.push({
      approxTokens: completion.usage?.prompt_tokens ?? size,
      prefillTokensPerSec: completion.usage?.extra?.prefill_tokens_per_s,
      wallMs: Math.round(performance.now() - started),
    });
  }

  return out;
}

const api = { webgpuInfo, load, unload, schemaRun, cancelRun, prefillCurve, log };
(window as unknown as { __s2: typeof api }).__s2 = api;
log("spike ready");
