import { CookieRefSchema, PageSnapshotSchema } from "core/snapshot";
import { z } from "zod";

/**
 * The messages between extension contexts (docs/07).
 *
 * Every message is validated with zod at both ends. That is hard rule 2, and it
 * matters more here than anywhere else in the system: the background worker is
 * the only context holding privilege, and a message is the only way to ask it
 * to use that privilege.
 */

export const ErrorCodeSchema = z.enum([
  "invalid-message",
  "domain-not-allowed",
  "fetch-failed",
  "no-active-tab",
  "capture-failed",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

// --- Requests -------------------------------------------------------------

export const CaptureRequestSchema = z.object({
  type: z.literal("snapshot.capture"),
  payload: z.object({
    tabId: z.number().int(),
    /**
     * Binds this capture to an audit. The worker derives the audit's fetch
     * allowlist from the tab URL it reads itself, and stores it under this id
     * (see `audit-registry.ts`).
     */
    auditId: z.string(),
  }),
});

export const FetchRequestSchema = z.object({
  type: z.literal("http.fetch"),
  payload: z.object({
    url: z.url(),
    method: z.enum(["GET", "HEAD", "POST"]).default("GET"),
    /**
     * Names the audit; it does not describe its permissions. There is
     * deliberately no `allowedDomains` field here — the worker looks up the
     * allowlist it recorded at capture time. A caller that could state its own
     * allowlist would be authorising itself (docs/12 T2).
     */
    auditId: z.string(),
  }),
});

export const CookiesRequestSchema = z.object({
  type: z.literal("cookies.get"),
  payload: z.object({ url: z.url() }),
});

/** Background → content script. */
export const BuildSnapshotRequestSchema = z.object({
  type: z.literal("snapshot.build"),
  payload: z.object({ url: z.url() }),
});

/**
 * Spike S3's offscreen probe reporting in (docs/11). Present in normal builds
 * because the offscreen document is a real entrypoint; it is only ever created
 * on request.
 */
export const S3ReportSchema = z.object({
  type: z.literal("s3.report"),
  payload: z.object({
    kind: z.string(),
    at: z.number(),
    aliveMs: z.number(),
    gpu: z.object({
      available: z.boolean(),
      vendor: z.string().optional(),
      architecture: z.string().optional(),
      error: z.string().optional(),
    }),
  }),
});

/** Ask the worker to start the S3 offscreen probe (docs/11). */
export const S3StartSchema = z.object({
  type: z.literal("s3.start"),
  payload: z.object({}).default({}),
});

export const RequestSchema = z.discriminatedUnion("type", [
  CaptureRequestSchema,
  FetchRequestSchema,
  CookiesRequestSchema,
  BuildSnapshotRequestSchema,
  S3ReportSchema,
  S3StartSchema,
]);
export type Request = z.infer<typeof RequestSchema>;

// --- Replies --------------------------------------------------------------

export const SnapshotReplySchema = z.object({
  type: z.literal("snapshot.ready"),
  payload: PageSnapshotSchema,
});

export const FetchReplySchema = z.object({
  type: z.literal("http.response"),
  payload: z.object({
    url: z.url(),
    status: z.number().int(),
    headers: z.record(z.string(), z.string()),
    body: z.string(),
  }),
});

export const CookiesReplySchema = z.object({
  type: z.literal("cookies.list"),
  payload: z.array(CookieRefSchema),
});

export const ErrorReplySchema = z.object({
  type: z.literal("error"),
  payload: z.object({ code: ErrorCodeSchema, message: z.string() }),
});

export const ReplySchema = z.discriminatedUnion("type", [
  SnapshotReplySchema,
  FetchReplySchema,
  CookiesReplySchema,
  ErrorReplySchema,
]);
export type Reply = z.infer<typeof ReplySchema>;

// --- Envelope -------------------------------------------------------------

/**
 * `id` is chosen by the sender; a reply echoes it in `replyTo` (docs/07).
 * Envelope and body are validated separately so an unroutable message can still
 * be answered — a reply with no `replyTo` has nowhere to go.
 */
export const EnvelopeSchema = z.object({
  id: z.string(),
  replyTo: z.string().optional(),
  type: z.string(),
  payload: z.unknown(),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

export class MessageError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MessageError";
  }
}

/**
 * Parse an incoming message into a known request, or throw a `MessageError`
 * carrying the code the sender should see. Anything unrecognised is
 * `invalid-message`; nothing gets a default handler.
 */
export function parseRequest(raw: unknown): { id: string; request: Request } {
  const envelope = EnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new MessageError("invalid-message", "message is not a valid envelope");
  }

  const request = RequestSchema.safeParse({
    type: envelope.data.type,
    payload: envelope.data.payload,
  });
  if (!request.success) {
    throw new MessageError(
      "invalid-message",
      `unrecognised message ${envelope.data.type}: ${request.error.issues[0]?.message ?? "invalid payload"}`,
    );
  }

  return { id: envelope.data.id, request: request.data };
}

export function parseReply(raw: unknown): { replyTo?: string; reply: Reply } {
  const envelope = EnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new MessageError("invalid-message", "reply is not a valid envelope");
  }

  const reply = ReplySchema.safeParse({
    type: envelope.data.type,
    payload: envelope.data.payload,
  });
  if (!reply.success) {
    throw new MessageError(
      "invalid-message",
      `unrecognised reply ${envelope.data.type}`,
    );
  }

  return {
    ...(envelope.data.replyTo === undefined ? {} : { replyTo: envelope.data.replyTo }),
    reply: reply.data,
  };
}

export function envelope(id: string, message: Request | Reply): Envelope {
  return { id, type: message.type, payload: message.payload };
}

export function replyEnvelope(replyTo: string, message: Reply): Envelope {
  return { id: newMessageId(), replyTo, type: message.type, payload: message.payload };
}

export function errorReply(replyTo: string, error: unknown): Envelope {
  const code = error instanceof MessageError ? error.code : "invalid-message";
  const message = error instanceof Error ? error.message : String(error);
  return replyEnvelope(replyTo, { type: "error", payload: { code, message } });
}

export function newMessageId(): string {
  return crypto.randomUUID();
}
