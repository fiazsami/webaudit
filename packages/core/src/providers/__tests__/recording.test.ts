import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Clock } from "../../capabilities.js";
import {
  createRecordingProvider,
  createReplayProvider,
  MissingRecordingError,
  ModelRecordingSchema,
  requestKey,
} from "../recording.js";
import type { CompletionRequest, CompletionResponse, ModelProvider } from "../types.js";

const ClauseSchema = z.object({ category: z.string(), severity: z.string() });

function fakeClock(): Clock {
  let tick = 1_000;
  return {
    now: () => {
      tick += 25;
      return tick;
    },
  };
}

/** A stand-in model that answers from a queue and counts its calls. */
function fakeProvider(responses: CompletionResponse[]): ModelProvider & {
  calls: CompletionRequest[];
} {
  const calls: CompletionRequest[] = [];
  return {
    id: "fake:test-model",
    calls,
    capabilities: () =>
      Promise.resolve({
        contextTokens: 4096,
        supportsJsonSchema: true,
        supportsToolCalls: false,
        supportsStreaming: true,
      }),
    countTokens: (text) => text.length,
    complete: (request) => {
      calls.push(request);
      const next = responses.shift();
      if (next === undefined) throw new Error("fake provider ran out of responses");
      return Promise.resolve(next);
    },
  };
}

function request(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    system: "You extract clauses.",
    messages: [{ role: "user", content: "Extract from: 3.2 Licence..." }],
    maxTokens: 256,
    temperature: 0,
    ...overrides,
  };
}

describe("requestKey", () => {
  it("is stable across identical requests", () => {
    expect(requestKey(request())).toBe(requestKey(request()));
  });

  it("ignores the order the caller wrote the fields in", () => {
    const reordered: CompletionRequest = {
      temperature: 0,
      maxTokens: 256,
      messages: [{ role: "user", content: "Extract from: 3.2 Licence..." }],
      system: "You extract clauses.",
    };
    expect(requestKey(reordered)).toBe(requestKey(request()));
  });

  it("distinguishes a different prompt", () => {
    expect(requestKey(request({ system: "Something else." }))).not.toBe(
      requestKey(request()),
    );
  });

  it("distinguishes a different schema, because it changes what the model may emit", () => {
    const withSchema = requestKey(request({ schema: ClauseSchema }));
    const withOther = requestKey(request({ schema: z.object({ other: z.string() }) }));

    expect(withSchema).not.toBe(requestKey(request()));
    expect(withSchema).not.toBe(withOther);
  });

  it("ignores an AbortSignal, which is not part of what was asked", () => {
    const controller = new AbortController();
    expect(requestKey(request({ signal: controller.signal }))).toBe(
      requestKey(request()),
    );
  });
});

describe("createRecordingProvider", () => {
  it("passes calls through and records them", async () => {
    const inner = fakeProvider([
      { text: "hello", usage: { inputTokens: 10, outputTokens: 2 } },
    ]);
    const provider = createRecordingProvider(inner, fakeClock());

    const response = await provider.complete(request());

    expect(response.text).toBe("hello");
    expect(inner.calls).toHaveLength(1);
    expect(provider.recording().exchanges).toHaveLength(1);
  });

  it("produces a recording that validates against its schema", async () => {
    const inner = fakeProvider([
      {
        json: { category: "licence-grant", severity: "high" },
        usage: { inputTokens: 20, outputTokens: 8 },
      },
    ]);
    const provider = createRecordingProvider(inner, fakeClock());
    await provider.capabilities();
    await provider.complete(request({ schema: ClauseSchema }));

    expect(() => ModelRecordingSchema.parse(provider.recording())).not.toThrow();
  });

  it("records the JSON Schema actually sent, not the zod object", async () => {
    const inner = fakeProvider([
      {
        json: { category: "a", severity: "b" },
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const provider = createRecordingProvider(inner, fakeClock());
    await provider.complete(request({ schema: ClauseSchema }));

    const recorded = provider.recording().exchanges[0]?.request.schemaJson;
    expect(recorded).toContain("category");
  });

  it("times calls with the injected clock, not a real timer", async () => {
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_450);
    const inner = fakeProvider([
      { text: "x", usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const provider = createRecordingProvider(inner, { now });

    await provider.complete(request());

    expect(provider.recording().exchanges[0]?.durationMs).toBe(450);
  });
});

describe("createReplayProvider", () => {
  async function record(
    responses: CompletionResponse[],
    requests: CompletionRequest[],
  ) {
    const provider = createRecordingProvider(fakeProvider(responses), fakeClock());
    await provider.capabilities();
    for (const item of requests) await provider.complete(item);
    return provider.recording();
  }

  it("replays a recorded response with no model present", async () => {
    const recording = await record(
      [
        {
          json: { category: "arbitration", severity: "high" },
          usage: { inputTokens: 20, outputTokens: 8 },
        },
      ],
      [request({ schema: ClauseSchema })],
    );

    const replay = createReplayProvider(recording);
    const response = await replay.complete(request({ schema: ClauseSchema }));

    expect(response.json).toEqual({ category: "arbitration", severity: "high" });
    expect(response.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
  });

  it("survives a round trip through JSON, as a stored trace would", async () => {
    const recording = await record(
      [{ text: "explained", usage: { inputTokens: 5, outputTokens: 3 } }],
      [request()],
    );

    const reloaded = ModelRecordingSchema.parse(JSON.parse(JSON.stringify(recording)));
    const response = await createReplayProvider(reloaded).complete(request());

    expect(response.text).toBe("explained");
  });

  it("refuses a request it has no record of, rather than returning nothing", async () => {
    const recording = await record(
      [{ text: "a", usage: { inputTokens: 1, outputTokens: 1 } }],
      [request()],
    );
    const replay = createReplayProvider(recording);

    // A stale recording must fail the test, not pass it quietly.
    await expect(
      replay.complete(request({ system: "a different prompt" })),
    ).rejects.toThrow(MissingRecordingError);
  });

  it("replays repeats in the order they were recorded", async () => {
    const recording = await record(
      [
        { text: "first", usage: { inputTokens: 1, outputTokens: 1 } },
        { text: "second", usage: { inputTokens: 1, outputTokens: 1 } },
      ],
      [request({ temperature: 0.7 }), request({ temperature: 0.7 })],
    );
    const replay = createReplayProvider(recording);

    expect((await replay.complete(request({ temperature: 0.7 }))).text).toBe("first");
    expect((await replay.complete(request({ temperature: 0.7 }))).text).toBe("second");
  });

  it("runs out rather than looping when a repeat is asked for once too often", async () => {
    const recording = await record(
      [{ text: "only", usage: { inputTokens: 1, outputTokens: 1 } }],
      [request()],
    );
    const replay = createReplayProvider(recording);

    await replay.complete(request());
    await expect(replay.complete(request())).rejects.toThrow(MissingRecordingError);
  });

  it("treats a changed schema as a different request", async () => {
    const recording = await record(
      [
        {
          json: { category: "x", severity: "y" },
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ],
      [request({ schema: ClauseSchema })],
    );

    // The JSON Schema is what constrained generation, so changing it changes
    // what was asked. Replaying the old answer would be answering a different
    // question.
    const stricter = z.object({
      category: z.enum(["arbitration"]),
      severity: z.string(),
    });
    await expect(
      createReplayProvider(recording).complete(request({ schema: stricter })),
    ).rejects.toThrow(MissingRecordingError);
  });

  it("validates recorded JSON rather than trusting it because we wrote it", async () => {
    // A recording edited by hand, or written by an older build, must not slip
    // past the schema (hard rule 2).
    const recording = ModelRecordingSchema.parse({
      providerId: "fake:test-model",
      capabilities: {
        contextTokens: 4096,
        supportsJsonSchema: true,
        supportsToolCalls: false,
        supportsStreaming: true,
      },
      exchanges: [
        {
          key: requestKey(request({ schema: ClauseSchema })),
          request: {
            system: "You extract clauses.",
            messages: [{ role: "user", content: "Extract from: 3.2 Licence..." }],
            maxTokens: 256,
            temperature: 0,
          },
          response: {
            json: { category: 42 },
            usage: { inputTokens: 1, outputTokens: 1 },
          },
          durationMs: 10,
        },
      ],
    });

    await expect(
      createReplayProvider(recording).complete(request({ schema: ClauseSchema })),
    ).rejects.toThrow();
  });

  it("reports the recorded capabilities", async () => {
    const recording = await record(
      [{ text: "a", usage: { inputTokens: 1, outputTokens: 1 } }],
      [request()],
    );

    expect((await createReplayProvider(recording).capabilities()).contextTokens).toBe(
      4096,
    );
  });
});
