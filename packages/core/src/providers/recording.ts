import { z } from "zod";

import type { Clock } from "../capabilities.js";
import { stableHash } from "../hash.js";
import type {
  CompletionRequest,
  CompletionResponse,
  ModelCapabilities,
  ModelProvider,
} from "./types.js";

/**
 * Record model calls, and replay them without a model (docs/04).
 *
 * This is what makes hard rule 6 possible: CI has no GPU, so the only way to
 * test anything that calls a model is to replay a recording made on a machine
 * that had one. It is pure — no host APIs — so the same recording drives tests
 * in Node and in the browser.
 *
 * A recording is a wire log, not a cache. It stores what was sent and what came
 * back, and replay refuses anything it has no record of rather than improvising.
 */

export const RecordedMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export const RecordedRequestSchema = z.object({
  system: z.string(),
  messages: z.array(RecordedMessageSchema),
  /**
   * The JSON Schema actually sent to the model, stringified. The zod schema
   * itself cannot be serialised, and this is the thing that constrained
   * generation — so it is what belongs in the record.
   */
  schemaJson: z.string().optional(),
  maxTokens: z.number().int(),
  temperature: z.number().optional(),
});
export type RecordedRequest = z.infer<typeof RecordedRequestSchema>;

export const RecordedResponseSchema = z.object({
  text: z.string().optional(),
  /** Re-validated against the caller's zod schema on replay, never trusted raw. */
  json: z.unknown().optional(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
});

export const ModelExchangeSchema = z.object({
  /** Hash of the request; identical requests replay identically. */
  key: z.string(),
  request: RecordedRequestSchema,
  response: RecordedResponseSchema,
  durationMs: z.number(),
});
export type ModelExchange = z.infer<typeof ModelExchangeSchema>;

export const ModelRecordingSchema = z.object({
  providerId: z.string(),
  capabilities: z.object({
    contextTokens: z.number().int(),
    supportsJsonSchema: z.boolean(),
    supportsToolCalls: z.boolean(),
    supportsStreaming: z.boolean(),
  }),
  exchanges: z.array(ModelExchangeSchema),
});
export type ModelRecording = z.infer<typeof ModelRecordingSchema>;

/**
 * The request's identity for replay purposes.
 *
 * Field order is fixed here rather than taken from the caller's object, for the
 * same reason finding ids fix theirs: `JSON.stringify` preserves insertion
 * order, and two callers building the same request differently would otherwise
 * not match. `signal` and `tools` are excluded — a signal is not part of what
 * was asked, and tools are not a path we use (docs/01).
 */
export function requestKey(request: CompletionRequest): string {
  const canonical = JSON.stringify([
    request.system,
    request.messages.map((message) => [message.role, message.content]),
    schemaJson(request.schema) ?? null,
    request.maxTokens,
    request.temperature ?? null,
  ]);
  return stableHash(canonical);
}

function schemaJson(schema: CompletionRequest["schema"]): string | undefined {
  if (schema === undefined) return undefined;
  return JSON.stringify(z.toJSONSchema(schema));
}

export interface RecordingProvider extends ModelProvider {
  /** Everything recorded so far, ready to serialise. */
  recording(): ModelRecording;
}

/**
 * Wrap a real provider and log every call.
 *
 * Duration comes from the injected clock rather than a timer, so a recording
 * made under a fake clock is deterministic (docs/01).
 */
export function createRecordingProvider(
  inner: ModelProvider,
  clock: Clock,
): RecordingProvider {
  const exchanges: ModelExchange[] = [];
  let capabilities: ModelCapabilities | undefined;

  return {
    id: inner.id,

    async capabilities(): Promise<ModelCapabilities> {
      capabilities = await inner.capabilities();
      return capabilities;
    },

    countTokens: (text: string) => inner.countTokens(text),

    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const startedAt = clock.now();
      const response = await inner.complete(request);
      const durationMs = clock.now() - startedAt;

      const json = schemaJson(request.schema);
      exchanges.push({
        key: requestKey(request),
        request: {
          system: request.system,
          messages: request.messages.map((message) => ({ ...message })),
          ...(json === undefined ? {} : { schemaJson: json }),
          maxTokens: request.maxTokens,
          ...(request.temperature === undefined
            ? {}
            : { temperature: request.temperature }),
        },
        response: {
          ...(response.text === undefined ? {} : { text: response.text }),
          ...(response.json === undefined ? {} : { json: response.json }),
          usage: response.usage,
        },
        durationMs,
      });

      return response;
    },

    recording(): ModelRecording {
      return {
        providerId: inner.id,
        capabilities: {
          contextTokens: capabilities?.contextTokens ?? 0,
          supportsJsonSchema: capabilities?.supportsJsonSchema ?? false,
          supportsToolCalls: capabilities?.supportsToolCalls ?? false,
          supportsStreaming: capabilities?.supportsStreaming ?? false,
        },
        exchanges: exchanges.map((exchange) => ({ ...exchange })),
      };
    },
  };
}

/** Thrown when replay is asked for something the recording does not contain. */
export class MissingRecordingError extends Error {
  constructor(
    readonly key: string,
    readonly system: string,
  ) {
    super(
      `No recorded response for this request (key ${key}). ` +
        `Re-record the trace on a machine with a GPU, or check the prompt has not changed.`,
    );
    this.name = "MissingRecordingError";
  }
}

/**
 * Answer from a recording. The only provider Node ever holds (docs/01).
 *
 * Repeated identical requests are replayed in the order they were recorded, so
 * a loop that asks the same question twice and got different answers still
 * reproduces. An unrecorded request throws: silently returning nothing would
 * turn a stale recording into a passing test.
 */
export function createReplayProvider(recording: ModelRecording): ModelProvider {
  const byKey = new Map<string, ModelExchange[]>();
  for (const exchange of recording.exchanges) {
    const bucket = byKey.get(exchange.key);
    if (bucket === undefined) byKey.set(exchange.key, [exchange]);
    else bucket.push(exchange);
  }

  const consumed = new Map<string, number>();

  return {
    id: `replay:${recording.providerId}`,

    // Cost fields stay absent rather than undefined: local models have no cost,
    // and exactOptionalPropertyTypes treats those as different things.
    capabilities: () =>
      Promise.resolve({ ...recording.capabilities } satisfies ModelCapabilities),

    // Cheap and host-free; the recorded usage carries the real counts.
    countTokens: (text: string) => Math.ceil(text.length / 4),

    // Async so a missing recording rejects rather than throwing synchronously:
    // callers await this, and a synchronous throw escapes their try/catch.
    // eslint-disable-next-line @typescript-eslint/require-await
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const key = requestKey(request);
      const bucket = byKey.get(key);
      const index = consumed.get(key) ?? 0;
      const exchange = bucket?.[index];

      if (exchange === undefined) throw new MissingRecordingError(key, request.system);
      consumed.set(key, index + 1);

      const { text, json, usage } = exchange.response;

      // Hard rule 2: a recording is a file, and what comes off it is validated
      // against the schema the caller asked for — not trusted because we wrote it.
      const validated =
        request.schema === undefined ? undefined : request.schema.parse(json);

      return {
        ...(text === undefined ? {} : { text }),
        ...(validated === undefined ? {} : { json: validated }),
        usage,
      };
    },
  };
}
