/**
 * `core` — the host-agnostic audit runtime.
 *
 * Nothing here may touch Node built-ins, DOM globals, or `chrome.*` (CLAUDE.md
 * hard rule 1). The compiler enforces it: this package's tsconfig omits the DOM
 * and Node type libraries, so those globals cannot be named. The world arrives
 * through the `Capabilities` object the host passes in (docs/01).
 */

export const VERSION = "0.0.0";

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

export type { DomDocumentLike, DomElementLike } from "./snapshot/dom.js";

export { buildSnapshot } from "./snapshot/build.js";
export type { BuildSnapshotOptions } from "./snapshot/build.js";

export { isSameOrigin, parseUrl, resolveUrl } from "./snapshot/url.js";
