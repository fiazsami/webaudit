import type { DomDocumentLike, DomElementLike } from "../dom.js";

/**
 * A selector-keyed stand-in for a document.
 *
 * Deliberately not a parser: it maps a selector straight to the elements the
 * builder should see, so these tests exercise the builder's logic and nothing
 * else. The builder is proven against a real parser in `packages/cli`, where
 * linkedom does the parsing.
 */

export interface FakeElementSpec {
  attrs?: Record<string, string>;
  text?: string;
  children?: Record<string, FakeElementSpec[]>;
}

export function fakeElement(spec: FakeElementSpec): DomElementLike {
  const attrs = spec.attrs ?? {};
  const children = spec.children ?? {};
  return {
    getAttribute: (name) => attrs[name] ?? null,
    textContent: spec.text ?? null,
    querySelectorAll: (selector) =>
      (children[selector] ?? []).map((child) => fakeElement(child)),
  };
}

export function fakeDocument(spec: {
  title?: string;
  bodyText?: string;
  elements?: Record<string, FakeElementSpec[]>;
}): DomDocumentLike {
  const elements = spec.elements ?? {};
  return {
    title: spec.title ?? "",
    body: spec.bodyText === undefined ? null : fakeElement({ text: spec.bodyText }),
    querySelectorAll: (selector) =>
      (elements[selector] ?? []).map((element) => fakeElement(element)),
  };
}
