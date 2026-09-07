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
  CachedExtraction,
  Capabilities,
  Clock,
  DomParser,
  ExtractedArticle,
  Http,
  PolicyCacheKey,
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

// Recording and replay — how anything model-shaped is tested without a GPU
// (hard rule 6).
export {
  createRecordingProvider,
  createReplayProvider,
  MissingRecordingError,
  ModelExchangeSchema,
  ModelRecordingSchema,
  RecordedRequestSchema,
  requestKey,
} from "./providers/recording.js";
export type {
  ModelExchange,
  ModelRecording,
  RecordedRequest,
  RecordingProvider,
} from "./providers/recording.js";

// Explanations (docs/03) — the only field a model writes.
export {
  buildExplainPrompt,
  EXPLAIN_SYSTEM_PROMPT,
  explainFinding,
  explainFindings,
  ExplanationSchema,
} from "./explain/index.js";
export type { Explanation, ExplainOptions } from "./explain/index.js";

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

export { analyzers } from "./analyzers/index.js";
export {
  cookiesAnalyzer,
  cspAnalyzer,
  formsAnalyzer,
  headersAnalyzer,
  librariesAnalyzer,
  policyPresenceAnalyzer,
  scriptsAnalyzer,
  trackersAnalyzer,
  transportAnalyzer,
} from "./analyzers/index.js";
export { setHstsPreloadList } from "./analyzers/headers/index.js";
export { LibraryDatabaseSchema } from "./analyzers/libraries/schema.js";
export { createTrackerDatabase, isThirdParty } from "./analyzers/trackers/db.js";
export { TrackerDatabaseFileSchema } from "./analyzers/trackers/schema.js";
export type { TrackerDatabaseFile } from "./analyzers/trackers/schema.js";
export type { LibraryDatabase } from "./analyzers/libraries/schema.js";
export { HEADER_RULES } from "./analyzers/headers/mapping.js";
export { runAnalyzers } from "./analyzers/run.js";
export type {
  Analyzer,
  AnalyzerContext,
  AnalyzerNeed,
  TrackerDatabase,
} from "./analyzers/types.js";

// Audit results (docs/01, docs/09)
export { audit } from "./audit/run.js";
export type { AuditOptions } from "./audit/run.js";
export { AuditResultSchema, AuditSummarySchema } from "./audit/schema.js";
export type { AuditResult, AuditSummary } from "./audit/schema.js";

// Terms of service pipeline (docs/05)
export { runTosPipeline } from "./tos/pipeline.js";
export type { TosPipelineOptions } from "./tos/pipeline.js";
export { discoverPolicies } from "./tos/discover.js";
export type { DiscoverOptions, PolicyCandidate } from "./tos/discover.js";
export { chunkPolicy } from "./tos/chunk.js";
export { chunkBudget, countTokens as countPolicyTokens } from "./tos/tokens.js";
export {
  CATEGORY_WEIGHT,
  dedupeClauses,
  groupByCategory,
  rankClauses,
  scoreClause,
  topConcerns,
} from "./tos/merge.js";
export { normalizeForMatch, quoteAppearsIn, verifyClauses } from "./tos/verify.js";
export {
  PolicyLabelsSchema,
  PolicyLabelSchema,
  scoreAgainstLabels,
} from "./tos/labels.js";
export type { LabelScore, PolicyLabel, PolicyLabels } from "./tos/labels.js";
export { buildExtractPrompt, EXTRACT_SYSTEM_PROMPT } from "./tos/prompt.js";
export {
  ClauseCategorySchema,
  ClauseExtractionSchema,
  ClauseSchema,
  ConcernSchema,
  PolicyChunkSchema,
  PolicyDocumentSchema,
  PolicySourceSchema,
  TosLimitationSchema,
  TosReportSchema,
} from "./tos/schema.js";
export type {
  Clause,
  ClauseCategory,
  ClauseExtraction,
  Concern,
  PolicyChunk,
  PolicyDocument,
  PolicySource,
  TosLimitation,
  TosReport,
} from "./tos/schema.js";

// Agent loop (docs/06)
export { runAgent, AgentActionSchema } from "./agent/orchestrator.js";
export type {
  AgentAction,
  AgentResult,
  OrchestratorOptions,
} from "./agent/orchestrator.js";
export {
  BudgetExceeded,
  BudgetSchema,
  BudgetTracker,
  defaultBudget,
} from "./agent/budget.js";
export type { Budget, BudgetKind, BudgetUsed } from "./agent/budget.js";
export { AGENT_TOOLS } from "./agent/tools.js";
export type { Tool, ToolContext } from "./agent/types.js";
export { AuditTraceSchema, TraceRecorder, TraceStepSchema } from "./agent/trace.js";
export type { AuditTrace, TraceStep } from "./agent/trace.js";
export {
  buildSystemPrompt,
  describeSnapshot,
  ORCHESTRATOR_PROMPT,
} from "./agent/prompts.js";

export { stableHash } from "./hash.js";
