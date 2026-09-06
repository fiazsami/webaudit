/**
 * The slice of a DOM that the snapshot builder reads (docs/02).
 *
 * core has no DOM types — its tsconfig omits the `dom` lib deliberately — so it
 * cannot name `Document` or `Element`. It names these structural ports instead.
 * A browser's real `Document` and linkedom's both satisfy them without any
 * adapter, which is what lets one builder serve the content script and the CLI's
 * fixtures. `packages/extension` asserts the browser half of that claim at the
 * type level; `packages/cli` asserts the linkedom half.
 *
 * Keep these minimal. Every member added here is a new thing a host must
 * provide.
 */

export interface DomElementLike {
  getAttribute(name: string): string | null;
  readonly textContent: string | null;
  /** Needed to read a form's own fields without walking the whole document. */
  querySelectorAll(selectors: string): Iterable<DomElementLike>;
}

export interface DomDocumentLike {
  readonly title: string;
  readonly body: DomElementLike | null;
  querySelectorAll(selectors: string): Iterable<DomElementLike>;
}
