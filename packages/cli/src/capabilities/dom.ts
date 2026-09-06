import type { DomDocumentLike, DomParser } from "core";
import { parseHTML } from "linkedom";

/**
 * The Node host's DOM capability (docs/01).
 *
 * The type assertion below is doing real work and is worth explaining. linkedom
 * declares `parseHTML` as returning `Window & typeof globalThis`, and `Window`
 * is a DOM type — which this package deliberately does not load, being a Node
 * host. So the return type resolves to nothing the compiler can check, and an
 * unannotated `document` would silently be `any`.
 *
 * That means the browser and Node halves of core's DOM port (docs/02) are
 * verified differently: the extension can check its half at compile time
 * because it has `lib.dom`, and here the claim is checked at runtime instead, by
 * the port-conformance test in `src/__tests__/dom.test.ts`. If linkedom's shape
 * drifts from the port, that test fails — the compiler will not catch it.
 */
export function createLinkedomParser(): DomParser {
  return {
    parse(html: string): DomDocumentLike {
      const { document } = parseHTML(html) as { document: DomDocumentLike };
      return document;
    },
  };
}
