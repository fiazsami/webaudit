import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createWebLlmProvider } from "../webllm-provider.js";

/**
 * A stand-in engine that reproduces what spike S2 measured: after
 * `interruptGenerate()`, every completion comes back empty with
 * `finish_reason: "abort"` and stays that way.
 */
function fakeEngine(): MLCEngineInterface & { interrupted: boolean; calls: number } {
  const engine = {
    interrupted: false,
    calls: 0,
    chat: {
      completions: {
        // Resolves on a later tick, because a real generation takes seconds and
        // an interrupt has to be able to land while it is in flight.
        create: async () => {
          engine.calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (engine.interrupted) {
            return {
              choices: [{ message: { content: "" }, finish_reason: "abort" }],
              usage: { prompt_tokens: 0, completion_tokens: 0 },
            };
          }
          return {
            choices: [
              {
                message: { content: '{"explanation":"ok","suggestedAction":""}' },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 42, completion_tokens: 7 },
          };
        },
      },
    },
    interruptGenerate: () => {
      engine.interrupted = true;
      return Promise.resolve();
    },
    unload: () => Promise.resolve(),
  } as unknown as MLCEngineInterface & { interrupted: boolean; calls: number };
  return engine;
}

function providerWith(engines: Array<ReturnType<typeof fakeEngine>>) {
  const created: Array<ReturnType<typeof fakeEngine>> = [];
  const provider = createWebLlmProvider({
    modelId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    createEngine: () => {
      const next = engines.shift() ?? fakeEngine();
      created.push(next);
      return Promise.resolve(next);
    },
  });
  return { provider, created };
}

const Schema = z.object({ explanation: z.string(), suggestedAction: z.string() });

/** Let the engine build and generation actually start before interrupting. */
const tick = (ms = 2): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function request(overrides: Record<string, unknown> = {}) {
  return {
    system: "s",
    messages: [{ role: "user" as const, content: "u" }],
    maxTokens: 128,
    ...overrides,
  };
}

describe("webllm provider", () => {
  it("reports the model id and does not claim tool support", async () => {
    const { provider } = providerWith([fakeEngine()]);

    expect(provider.id).toBe("webllm:Qwen2.5-1.5B-Instruct-q4f16_1-MLC");
    const caps = await provider.capabilities();
    // WebLLM injects tools into the prompt rather than constraining them, which
    // fails silently. Saying false keeps the JSON action protocol the only path.
    expect(caps.supportsToolCalls).toBe(false);
    expect(caps.supportsJsonSchema).toBe(true);
  });

  it("builds the engine lazily, on first use", async () => {
    const { provider, created } = providerWith([fakeEngine()]);

    expect(created).toHaveLength(0);
    expect(provider.state()).toBe("idle");

    await provider.complete(request({ schema: Schema }));

    expect(created).toHaveLength(1);
    expect(provider.state()).toBe("ready");
  });

  it("reuses one engine across calls", async () => {
    const { provider, created } = providerWith([fakeEngine()]);

    await provider.complete(request({ schema: Schema }));
    await provider.complete(request({ schema: Schema }));

    expect(created).toHaveLength(1);
    expect(created[0]?.calls).toBe(2);
  });

  it("validates model output against the caller's schema", async () => {
    const { provider } = providerWith([fakeEngine()]);
    const response = await provider.complete(request({ schema: Schema }));

    expect(response.json).toEqual({ explanation: "ok", suggestedAction: "" });
    expect(response.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
  });

  it("rejects output that does not match the schema", async () => {
    const { provider } = providerWith([fakeEngine()]);
    const stricter = z.object({ explanation: z.number() });

    await expect(provider.complete(request({ schema: stricter }))).rejects.toThrow();
  });

  // --- the S2 findings ----------------------------------------------------

  it("interrupts generation when the caller's signal aborts", async () => {
    const engine = fakeEngine();
    const { provider } = providerWith([engine]);
    // Warm the engine first, so the abort lands during generation rather than
    // during engine construction.
    await provider.complete(request({ schema: Schema }));

    const controller = new AbortController();
    const pending = provider.complete(
      request({ schema: Schema, signal: controller.signal }),
    );
    await tick();
    controller.abort();
    await pending.catch(() => undefined);

    expect(engine.interrupted).toBe(true);
  });

  it("replaces the engine after an interrupt instead of reusing a dead one", async () => {
    const first = fakeEngine();
    const second = fakeEngine();
    const { provider, created } = providerWith([first, second]);

    await provider.complete(request({ schema: Schema }));
    const controller = new AbortController();
    const pending = provider.complete(
      request({ schema: Schema, signal: controller.signal }),
    );
    await tick();
    controller.abort();
    await pending.catch(() => undefined);

    // The next call must succeed. On a real engine, reusing the interrupted one
    // returns empty aborted responses forever (spike S2).
    const after = await provider.complete(request({ schema: Schema }));

    expect(after.json).toEqual({ explanation: "ok", suggestedAction: "" });
    expect(created).toHaveLength(2);
    expect(created[1]).toBe(second);
  });

  it("treats an aborted finish_reason as a dead engine even without a signal", async () => {
    const first = fakeEngine();
    const second = fakeEngine();
    const { provider, created } = providerWith([first, second]);

    // Something else interrupted it — another caller, or a stale interrupt.
    first.interrupted = true;
    await expect(provider.complete(request({ schema: Schema }))).rejects.toThrow(
      /interrupted/,
    );

    const after = await provider.complete(request({ schema: Schema }));
    expect(after.json).toEqual({ explanation: "ok", suggestedAction: "" });
    expect(created).toHaveLength(2);
  });

  it("unloads the engine it discards", async () => {
    const first = fakeEngine();
    const unload = vi.spyOn(first, "unload");
    const { provider } = providerWith([first, fakeEngine()]);

    await provider.complete(request({ schema: Schema }));
    const controller = new AbortController();
    const pending = provider.complete(
      request({ schema: Schema, signal: controller.signal }),
    );
    await tick();
    controller.abort();
    await pending.catch(() => undefined);
    await provider.complete(request({ schema: Schema }));

    expect(unload).toHaveBeenCalled();
  });

  it("does not start a request whose signal has already aborted", async () => {
    const engine = fakeEngine();
    const { provider } = providerWith([engine]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.complete(request({ schema: Schema, signal: controller.signal })),
    ).rejects.toThrow(/aborted/);
    expect(engine.calls).toBe(0);
  });

  it("returns to idle after an explicit unload", async () => {
    const { provider } = providerWith([fakeEngine(), fakeEngine()]);

    await provider.complete(request({ schema: Schema }));
    await provider.unload();

    expect(provider.state()).toBe("idle");
  });
});
