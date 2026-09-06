import type { AuditResult, AuditSummary } from "./audit/schema.js";
import type { Logger } from "./logger.js";
import type { ModelProvider } from "./providers/types.js";
import type { DomDocumentLike } from "./snapshot/dom.js";

/**
 * The load-bearing seam (docs/01).
 *
 * core never reaches for the world; the world is handed to it. That is what
 * lets identical code run in the extension and in Node, and it is what makes
 * replay-mode CI possible on a machine with no GPU. If core ever needs
 * something it cannot get, the answer is a new capability here — never a direct
 * import.
 */

export interface HttpRequestInit {
  method?: "GET" | "HEAD" | "POST";
  headers?: Record<string, string>;
  body?: string;
  redirect?: "follow" | "manual";
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface HttpResponse {
  /** The final URL, after any redirects the host followed. */
  url: string;
  status: number;
  /** Header names lowercased, so analyzers can look them up without guessing. */
  headers: Record<string, string>;
  body: string;
}

/**
 * The only way out to the network.
 *
 * In the extension this is the background worker, which checks the URL against
 * the allowed-domain list on its own authority — enforcement belongs with the
 * capability, not with its caller (docs/12 T2). A tool that checks the budget
 * before calling is doing so as well, not instead.
 */
export interface Http {
  fetch(url: string, init?: HttpRequestInit): Promise<HttpResponse>;
}

/** Native `DOMParser` in the extension, linkedom in the CLI. */
export interface DomParser {
  parse(html: string, url: string): DomDocumentLike;
}

/**
 * Audit history. The policy cache and ToS report stores described in docs/09
 * join this interface in M5, when there is something to put in them.
 */
export interface AuditStore {
  putAudit(result: AuditResult): Promise<void>;
  getAudit(auditId: string): Promise<AuditResult | undefined>;
  /** Most recent first. */
  listAudits(): Promise<AuditSummary[]>;
}

export interface ProgressEvent {
  /** Coarse phase: "analyzers", "tos", "agent". */
  stage: string;
  /** Finer step within the stage, e.g. an analyzer id. */
  step?: string;
  current?: number;
  total?: number;
  message?: string;
}

export interface ProgressSink {
  emit(event: ProgressEvent): void;
}

/**
 * Reading the clock through a capability is what makes a trace reproducible
 * (hard rule 6) and lets tests pin time.
 */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export interface Capabilities {
  http: Http;
  store: AuditStore;
  provider: ModelProvider;
  dom: DomParser;
  progress: ProgressSink;
  clock: Clock;
  logger: Logger;
}
