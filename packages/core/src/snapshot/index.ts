/**
 * The snapshot surface on its own.
 *
 * Exists so a host can take the builder and schemas without the analyzers. The
 * content script needs exactly this, and pulling it from the package root drags
 * in `csp_evaluator` — which is CommonJS, so a bundler cannot tree-shake it —
 * along with the vendored header sources and `tldts`. That was a 300 KB script
 * injected into every audited page to do a job that needs 60 KB.
 */
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
} from "./schema.js";
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
} from "./schema.js";

export { buildSnapshot } from "./build.js";
export type { BuildSnapshotOptions } from "./build.js";
export type { DomDocumentLike, DomElementLike } from "./dom.js";
export { isSameOrigin, parseUrl, resolveUrl } from "./url.js";
