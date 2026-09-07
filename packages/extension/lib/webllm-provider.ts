import {
  CreateWebWorkerMLCEngine,
  prebuiltAppConfig,
  type AppConfig,
  type ChatCompletionRequestNonStreaming,
  type InitProgressReport,
  type MLCEngineInterface,
} from "@mlc-ai/web-llm";
import type {
  CompletionRequest,
  CompletionResponse,
  ModelCapabilities,
  ModelProvider,
} from "core";
import { z } from "zod";

/**
 * The WebLLM adapter (docs/04).
 *
 * It lives in the extension, not in `packages/core`, and that is a deliberate
 * departure from the original plan. docs/04 imagined a browser-only entry point
 * inside core, but core's whole enforcement of hard rule 1 is that its tsconfig
 * has no DOM types — and this file needs `Worker`, `WebGPU`, and WebLLM's own
 * DOM-typed API. Carving an exception into core would weaken the invariant that
 * makes the rule checkable. A provider is a capability the host supplies
 * (docs/01), so the host is where its implementation belongs. `RecordingProvider`
 * stays in core because it is pure.
 *
 * Everything about engine lifetime here is a consequence of spike S2. See
 * `deadAfterInterrupt` below.
 */

export interface WebLlmProviderOptions {
  modelId: string;
  /** Download and shader-compilation progress, for the model manager UI. */
  onProgress?: (report: InitProgressReport) => void;
  /**
   * Overrides the prebuilt config. This is where pinned SRI hashes go — none of
   * WebLLM's own 163 model records carry any (docs/12 T7).
   */
  appConfig?: AppConfig;
  /** Injected in tests. */
  createEngine?: (
    modelId: string,
    onProgress: (report: InitProgressReport) => void,
    appConfig: AppConfig | undefined,
  ) => Promise<MLCEngineInterface>;
}

export type EngineState = "idle" | "loading" | "ready" | "restarting";

export interface WebLlmProvider extends ModelProvider {
  state(): EngineState;
  /** Release the engine and its worker. */
  unload(): Promise<void>;
}

function defaultCreateEngine(
  modelId: string,
  onProgress: (report: InitProgressReport) => void,
  appConfig: AppConfig | undefined,
): Promise<MLCEngineInterface> {
  // A Web Worker so a long prefill does not freeze the side panel (docs/08).
  // S2 measured prefill at 6 s per chunk on a 1.5B model; on the main thread
  // that is six seconds of frozen UI.
  const worker = new Worker(new URL("./webllm.worker.ts", import.meta.url), {
    type: "module",
  });
  return CreateWebWorkerMLCEngine(worker, modelId, {
    initProgressCallback: onProgress,
    ...(appConfig === undefined ? {} : { appConfig }),
  });
}

export function createWebLlmProvider(options: WebLlmProviderOptions): WebLlmProvider {
  const createEngine = options.createEngine ?? defaultCreateEngine;
  const record = (options.appConfig ?? prebuiltAppConfig).model_list.find(
    (model) => model.model_id === options.modelId,
  );

  let engine: MLCEngineInterface | undefined;
  let loading: Promise<MLCEngineInterface> | undefined;
  let state: EngineState = "idle";

  /**
   * Spike S2: `interruptGenerate()` stops generation, and then every later
   * request on that engine returns empty content with `finish_reason: "abort"`.
   * `resetChat()` does not clear it, `reload()` does not clear it, and in the
   * worker engine the next call after a reload throws. Only a new engine
   * recovers.
   *
   * So an interrupted engine is dead. Marking it here and rebuilding lazily is
   * what keeps that out of every caller's code — the agent loop should never
   * have to know an engine was replaced (docs/06).
   */
  let dead = false;

  async function ensureEngine(): Promise<MLCEngineInterface> {
    if (dead) {
      await discard();
      dead = false;
    }
    if (engine !== undefined) return engine;
    if (loading !== undefined) return loading;

    state = state === "restarting" ? "restarting" : "loading";
    loading = createEngine(
      options.modelId,
      (report) => options.onProgress?.(report),
      options.appConfig,
    )
      .then((created) => {
        engine = created;
        state = "ready";
        return created;
      })
      .finally(() => {
        loading = undefined;
      });

    return loading;
  }

  async function discard(): Promise<void> {
    const current = engine;
    engine = undefined;
    state = "restarting";
    if (current === undefined) return;
    // Best effort: the engine is already broken, and failing to unload a broken
    // engine must not prevent building a working one.
    await current.unload().catch(() => undefined);
  }

  return {
    id: `webllm:${options.modelId}`,

    state: () => state,

    async unload(): Promise<void> {
      await discard();
      dead = false;
      state = "idle";
    },

    capabilities(): Promise<ModelCapabilities> {
      return Promise.resolve({
        // The model record's own override; S2 measured 4096 for every model tried.
        contextTokens: record?.overrides?.context_window_size ?? 4096,
        // Grammar-constrained in the WASM runtime, not prompt-coaxed. Verified
        // against a real zod schema in S2.
        supportsJsonSchema: true,
        // WebLLM no longer rejects `tools`, but it does not constrain them
        // either — it injects them into the system prompt and hopes. That fails
        // silently, which is worse than being unsupported, so we say false and
        // use the JSON action protocol (docs/01, docs/04).
        supportsToolCalls: false,
        supportsStreaming: true,
      });
    },

    /**
     * A rough estimate, deliberately. WebLLM exposes no tokenizer, and the
     * response carries real `usage` counts to reconcile against (docs/10). M5
     * needs better than this for chunk sizing and should say so there.
     */
    countTokens: (text: string) => Math.ceil(text.length / 4),

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const active = await ensureEngine();

      // WebLLM has no AbortSignal (S2), so the signal is wired to
      // `interruptGenerate` here — and because interrupting kills the engine,
      // it is marked dead in the same breath.
      const onAbort = (): void => {
        dead = true;
        void active.interruptGenerate();
      };
      request.signal?.addEventListener("abort", onAbort);

      try {
        if (request.signal?.aborted === true) {
          throw new Error("aborted before the request started");
        }

        const payload: ChatCompletionRequestNonStreaming = {
          messages: [
            { role: "system", content: request.system },
            ...request.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          ],
          max_tokens: request.maxTokens,
          ...(request.temperature === undefined
            ? {}
            : { temperature: request.temperature }),
          ...(request.schema === undefined
            ? {}
            : {
                // WebLLM wants the JSON Schema as a string; zod 4 emits it
                // directly, so no zod-to-json-schema dependency (S2, docs/10).
                response_format: {
                  type: "json_object" as const,
                  schema: JSON.stringify(z.toJSONSchema(request.schema)),
                },
              }),
        };

        const completion = await active.chat.completions.create(payload);
        const choice = completion.choices[0];
        const text = choice?.message.content ?? "";

        // An interrupt that landed during this call shows up here.
        if (choice?.finish_reason === "abort") {
          dead = true;
          throw new Error("generation was interrupted");
        }

        const usage = {
          inputTokens: completion.usage?.prompt_tokens ?? 0,
          outputTokens: completion.usage?.completion_tokens ?? 0,
        };

        if (request.schema === undefined) return { text, usage };

        // Constrained generation makes malformed JSON unlikely, not impossible.
        // Hard rule 2 applies to model output like anything else.
        return { text, json: request.schema.parse(JSON.parse(text)), usage };
      } finally {
        request.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
