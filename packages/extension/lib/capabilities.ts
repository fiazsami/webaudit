import type {
  Capabilities,
  Clock,
  DomParser,
  Http,
  HttpRequestInit,
  HttpResponse,
  Logger,
  ModelProvider,
  ProgressEvent,
  ProgressSink,
  AuditStore,
} from "core";

import {
  envelope,
  FetchReplySchema,
  MessageError,
  newMessageId,
  parseReply,
} from "./messaging.js";

/**
 * Assembles the `Capabilities` object core runs against (docs/01).
 *
 * Everything privileged goes through the background worker. The side panel has
 * no host permissions of its own, which is why `http` here is a message send
 * rather than a `fetch` — and why the worker gets to say no.
 */

export interface ExtensionCapabilitiesOptions {
  auditId: string;
  store: AuditStore;
  onProgress?: (event: ProgressEvent) => void;
  provider?: ModelProvider;
}

export function createExtensionCapabilities(
  options: ExtensionCapabilitiesOptions,
): Capabilities {
  return {
    http: createWorkerHttp(options.auditId),
    store: options.store,
    dom: createDomParser(),
    provider: options.provider ?? unavailableProvider,
    progress: createProgressSink(options.onProgress),
    clock: { now: () => Date.now() } satisfies Clock,
    logger: consoleLogger,
  };
}

/**
 * The network capability: a request to the worker, which decides. Note there is
 * nothing here that states what this audit is allowed to reach — the worker
 * holds that, keyed by `auditId` (docs/12 T2).
 */
function createWorkerHttp(auditId: string): Http {
  return {
    async fetch(url: string, init: HttpRequestInit = {}): Promise<HttpResponse> {
      const raw: unknown = await browser.runtime.sendMessage(
        envelope(newMessageId(), {
          type: "http.fetch",
          payload: { url, method: init.method ?? "GET", auditId },
        }),
      );

      const { reply } = parseReply(raw);
      if (reply.type === "error") {
        throw new MessageError(reply.payload.code, reply.payload.message);
      }

      const parsed = FetchReplySchema.safeParse(reply);
      if (!parsed.success) {
        throw new MessageError("fetch-failed", "worker returned an unexpected reply");
      }
      return parsed.data.payload;
    },
  };
}

function createDomParser(): DomParser {
  const parser = new DOMParser();
  return {
    parse(html: string) {
      return parser.parseFromString(html, "text/html");
    },
  };
}

function createProgressSink(
  onProgress: ((event: ProgressEvent) => void) | undefined,
): ProgressSink {
  return {
    emit(event) {
      onProgress?.(event);
    },
  };
}

const consoleLogger: Logger = {
  debug: (message, detail) => {
    console.debug(`webaudit: ${message}`, detail);
  },
  info: (message, detail) => {
    console.info(`webaudit: ${message}`, detail);
  },
  warn: (message, detail) => {
    console.warn(`webaudit: ${message}`, detail);
  },
  error: (message, detail) => {
    console.error(`webaudit: ${message}`, detail);
  },
};

/** The WebLLM engine arrives in M4; until then a model call is a bug. */
const unavailableProvider: ModelProvider = {
  id: "unavailable",
  capabilities: () => {
    throw new Error("No model provider yet — the WebLLM engine is M4 (docs/11).");
  },
  complete: () => {
    throw new Error("No model provider yet — the WebLLM engine is M4 (docs/11).");
  },
  countTokens: (text: string) => Math.ceil(text.length / 4),
};
