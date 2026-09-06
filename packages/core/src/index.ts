/**
 * `core` — the host-agnostic audit runtime.
 *
 * Nothing here may touch Node built-ins, DOM globals, or `chrome.*` (CLAUDE.md
 * hard rule 1). The compiler enforces it: this package's tsconfig omits the DOM
 * and Node type libraries, so those globals cannot be named. The world arrives
 * through the `Capabilities` object the host passes in (docs/01).
 */

export const VERSION = "0.0.0";

// The seam (docs/01)
export type {
  AuditStore,
  Capabilities,
  Clock,
  DomParser,
  Http,
  HttpRequestInit,
  HttpResponse,
  ProgressEvent,
  ProgressSink,
} from "./capabilities.js";
export type { Logger } from "./logger.js";
export { silentLogger } from "./logger.js";

// Model access (docs/04). Types only in core; the WebLLM adapter is M4.
export type {
  CompletionRequest,
  CompletionResponse,
  ModelCapabilities,
  ModelProvider,
  ToolSpec,
} from "./providers/types.js";

// Snapshot (docs/02)
export {
  CookieRefSchema,
  FormRefSchema,
  IframeRefSchema,
  LimitationSchema,
  LinkRefSchema,
  PageSnapshotSchema,
  PolicyHintSchema,
  SameSiteSchema,
  ScriptRefSchema,
  SNAPSHOT_LIMITS,
  SNAPSHOT_SCHEMA_VERSION,
  ThirdPartyRequestSchema,
} from "./snapshot/schema.js";
export type {
  CookieRef,
  FormRef,
  IframeRef,
  Limitation,
  LinkRef,
  PageSnapshot,
  PolicyHint,
  SameSite,
  ScriptRef,
  ThirdPartyRequest,
} from "./snapshot/schema.js";

export { buildSnapshot } from "./snapshot/build.js";
export type { BuildSnapshotOptions } from "./snapshot/build.js";
export type { DomDocumentLike, DomElementLike } from "./snapshot/dom.js";
export { isSameOrigin, parseUrl, resolveUrl } from "./snapshot/url.js";

// Findings and analyzers (docs/03)
export {
  ConfidenceSchema,
  createFinding,
  dedupeFindings,
  EvidenceSchema,
  FindingSchema,
  SEVERITY_ORDER,
  SeveritySchema,
  sortFindings,
} from "./findings/schema.js";
export type {
  Confidence,
  Evidence,
  Finding,
  FindingInput,
  Severity,
} from "./findings/schema.js";

export { runAnalyzers } from "./analyzers/run.js";
export type {
  Analyzer,
  AnalyzerContext,
  AnalyzerNeed,
  TrackerDatabase,
} from "./analyzers/types.js";

// Audit results (docs/01, docs/09)
export { AuditResultSchema, AuditSummarySchema } from "./audit/schema.js";
export type { AuditResult, AuditSummary } from "./audit/schema.js";

export { stableHash } from "./hash.js";
