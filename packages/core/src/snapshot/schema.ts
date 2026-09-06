import { z } from "zod";

/**
 * The single input to core (docs/02).
 *
 * Three principles govern what belongs here:
 *
 * - Record what was **observed**, not conclusions. Analyzers draw conclusions.
 * - Record what could **not** be observed, in `limitations`, so an analyzer can
 *   say "unknown" instead of "missing".
 * - Keep it serialisable JSON. Fixtures are just saved snapshots.
 *
 * Naming follows the CLAUDE.md convention (`FooSchema` + `type Foo`) rather
 * than the sketch in docs/02, which reused one name for both.
 */

/** Size budget (docs/02). Exceeding one sets the matching limitation flag. */
export const SNAPSHOT_LIMITS = {
  maxLinks: 500,
  maxThirdPartyRequests: 1000,
  maxTextExcerpt: 20_000,
} as const;

export const ScriptRefSchema = z.object({
  src: z.url().optional(), // external
  inlineSha256: z.string().optional(), // inline: hash only, never the content
  inlineLength: z.number().int().nonnegative().optional(),
  attrs: z.record(z.string(), z.string()).default({}), // async, defer, type, nonce, integrity
});
export type ScriptRef = z.infer<typeof ScriptRefSchema>;

export const FormRefSchema = z.object({
  action: z.string(), // resolved absolute URL
  method: z.enum(["GET", "POST", "other"]),
  fieldTypes: z.array(z.string()), // input types: password, email, ...
  hasPasswordField: z.boolean(),
  autocompleteOff: z.boolean(),
});
export type FormRef = z.infer<typeof FormRefSchema>;

export const SameSiteSchema = z.enum(["strict", "lax", "none", "unspecified"]);
export type SameSite = z.infer<typeof SameSiteSchema>;

export const CookieRefSchema = z.object({
  name: z.string(),
  domain: z.string().optional(),
  // Flags are visible only through chrome.cookies, never document.cookie. When
  // the background worker could not supply them the fields are absent and the
  // snapshot carries the "no-cookie-flags" limitation.
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  sameSite: SameSiteSchema.optional(),
  session: z.boolean().optional(),
  expires: z.number().optional(), // seconds since epoch
});
export type CookieRef = z.infer<typeof CookieRefSchema>;

export const PolicyHintSchema = z.enum(["terms", "privacy", "cookies", "other"]);
export type PolicyHint = z.infer<typeof PolicyHintSchema>;

export const LinkRefSchema = z.object({
  href: z.url(),
  text: z.string().max(200),
  rel: z.string().optional(),
  /** Heuristic tag assigned during capture; the ToS pipeline starts here. */
  policyHint: PolicyHintSchema.optional(),
});
export type LinkRef = z.infer<typeof LinkRefSchema>;

export const IframeRefSchema = z.object({
  src: z.string().optional(),
  sandbox: z.string().optional(),
});
export type IframeRef = z.infer<typeof IframeRefSchema>;

export const ThirdPartyRequestSchema = z.object({
  url: z.url(),
  type: z.string(), // script, image, xhr, ...
  initiator: z.string().optional(),
});
export type ThirdPartyRequest = z.infer<typeof ThirdPartyRequestSchema>;

/**
 * Gaps in the capture. An analyzer that would otherwise report something as
 * missing must check here first and report it as unknown instead.
 */
export const LimitationSchema = z.enum([
  "no-webrequest-permission",
  "no-cookie-flags",
  "text-truncated",
  "links-truncated",
  "third-party-requests-truncated",
  "csp-blocked-inline-collection",
]);
export type Limitation = z.infer<typeof LimitationSchema>;

export const PageSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.iso.datetime(),
  url: z.url(),
  title: z.string().max(500),
  protocol: z.enum(["http:", "https:"]),

  // What the content script can see
  scripts: z.array(ScriptRefSchema),
  forms: z.array(FormRefSchema),
  iframes: z.array(IframeRefSchema),
  links: z.array(LinkRefSchema),
  metaTags: z.record(z.string(), z.string()), // name/property -> content
  hasMixedContent: z.boolean().optional(), // http subresources on an https page
  textExcerpt: z.string().max(SNAPSHOT_LIMITS.maxTextExcerpt),

  // From extension APIs, added by the background worker
  cookies: z.array(CookieRefSchema),
  thirdPartyRequests: z.array(ThirdPartyRequestSchema).default([]),

  // Honesty about gaps
  limitations: z.array(LimitationSchema).default([]),
});
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;

/** The version this build writes. Older snapshots are rejected, not migrated. */
export const SNAPSHOT_SCHEMA_VERSION = 1;
