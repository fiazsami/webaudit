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

/**
 * Native `DOMParser` in the extension, linkedom in the CLI.
 *
 * `extractArticle` is here rather than in core for the same reason `parse` is.
 * docs/05 originally had core running `@mozilla/readability` and `turndown`
 * itself, but both need a real DOM — far more of one than core's minimal port
 * exposes — and core has no DOM types at all. So readable-text extraction is
 * something the host does and core receives, which keeps the pipeline logic
 * (chunking, prompting, merging, ranking) pure and testable.
 */
export interface DomParser {
  parse(html: string, url: string): DomDocumentLike;

  /**
   * Reduce a page to its readable article as markdown, headings intact —
   * headings are the best chunk boundary signal there is (docs/05).
   *
   * Returns undefined when there is no article to speak of, which is a real
   * outcome for a cookie banner or a redirect stub, not an error.
   */
  extractArticle(html: string, url: string): ExtractedArticle | undefined;
}

export interface ExtractedArticle {
  title: string;
  /** Markdown, with heading structure preserved. */
  markdown: string;
}

/**
 * Audit history and the policy cache (docs/09).
 *
 * The cache is not an optimisation. Spike S2 measured 90–120 seconds of prefill
 * for one policy on the default model, so re-reading an unchanged policy is the
 * difference between a usable tool and one nobody waits for. It is keyed by
 * content hash and model id, because the same text read by a different model is
 * a different result.
 */
export interface AuditStore {
  putAudit(result: AuditResult): Promise<void>;
  getAudit(auditId: string): Promise<AuditResult | undefined>;
  /** Most recent first. */
  listAudits(): Promise<AuditSummary[]>;

  getCachedExtraction(key: PolicyCacheKey): Promise<CachedExtraction | undefined>;
  putCachedExtraction(entry: CachedExtraction): Promise<void>;
}

export interface PolicyCacheKey {
  contentHash: string;
  modelId: string;
}

export interface CachedExtraction extends PolicyCacheKey {
  url: string;
  /** Clauses as extracted and verified, before merging across documents. */
  clauses: unknown;
  createdAt: number;
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
