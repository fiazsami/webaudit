import type {
  Capabilities,
  Clock,
  Logger,
  ModelProvider,
  ProgressEvent,
  ProgressSink,
} from "core";

import { createLinkedomParser } from "./dom.js";
import { createNodeHttp } from "./http.js";
import { createFileStore } from "./store.js";

export interface NodeCapabilitiesOptions {
  /** Where the file store writes. Defaults to `./out`. */
  outDir?: string;
  /** Print progress and debug lines. */
  verbose?: boolean;
  /**
   * Replay-mode provider. Node has no WebGPU, so there is no live model here
   * ever; without a recording, any model call fails loudly (docs/01).
   */
  provider?: ModelProvider;
}

export function createNodeCapabilities(
  options: NodeCapabilitiesOptions = {},
): Capabilities {
  const verbose = options.verbose ?? false;

  return {
    http: createNodeHttp(),
    store: createFileStore(options.outDir ?? "out"),
    dom: createLinkedomParser(),
    provider: options.provider ?? unavailableProvider,
    progress: createConsoleProgress(verbose),
    clock: systemClock,
    logger: createConsoleLogger(verbose),
  };
}

const systemClock: Clock = { now: () => Date.now() };

function createConsoleProgress(verbose: boolean): ProgressSink {
  return {
    emit(event: ProgressEvent) {
      if (!verbose) return;
      const step = event.step === undefined ? "" : ` ${event.step}`;
      const message = event.message === undefined ? "" : `: ${event.message}`;
      process.stderr.write(`[${event.stage}${step}]${message}\n`);
    },
  };
}

function createConsoleLogger(verbose: boolean): Logger {
  const write = (level: string, message: string, detail?: unknown): void => {
    const suffix = detail === undefined ? "" : ` ${formatDetail(detail)}`;
    process.stderr.write(`${level}: ${message}${suffix}\n`);
  };

  return {
    debug: (message, detail) => {
      if (verbose) write("debug", message, detail);
    },
    info: (message, detail) => {
      if (verbose) write("info", message, detail);
    },
    warn: (message, detail) => {
      write("warn", message, detail);
    },
    error: (message, detail) => {
      write("error", message, detail);
    },
  };
}

function formatDetail(detail: unknown): string {
  if (detail instanceof Error) return detail.message;
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

/**
 * Node has no WebGPU, so the CLI never runs a live model. Reaching for one is a
 * bug in the caller, not a condition to degrade around.
 */
const unavailableProvider: ModelProvider = {
  id: "unavailable",
  capabilities: () => {
    throw new Error(
      "No model provider: Node has no WebGPU. Supply a RecordingProvider to replay a run (docs/01).",
    );
  },
  complete: () => {
    throw new Error(
      "No model provider: Node has no WebGPU. Supply a RecordingProvider to replay a run (docs/01).",
    );
  },
  countTokens: (text: string) => Math.ceil(text.length / 4),
};

export { createFileStore, createLinkedomParser, createNodeHttp };
