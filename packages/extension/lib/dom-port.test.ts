import { describe, expectTypeOf, it } from "vitest";

import type { DomDocumentLike, DomElementLike } from "core";

/**
 * core defines its DOM port structurally because it has no DOM types of its own
 * (docs/02). That only holds if a real browser `Document` actually satisfies the
 * port — which is a claim about types, so it is checked at compile time here,
 * in the one package that has `lib.dom` loaded.
 */
describe("core's DOM port", () => {
  it("is satisfied by a browser Document", () => {
    expectTypeOf<Document>().toExtend<DomDocumentLike>();
  });

  it("is satisfied by a browser Element", () => {
    expectTypeOf<Element>().toExtend<DomElementLike>();
    expectTypeOf<HTMLScriptElement>().toExtend<DomElementLike>();
  });
});
