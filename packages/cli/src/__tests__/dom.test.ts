import { describe, expect, it } from "vitest";

import { createLinkedomParser } from "../capabilities/index.js";

/**
 * core's DOM port is structural, and linkedom's own types are too loose for the
 * compiler to check that it satisfies them (see `capabilities/dom.ts`). So each
 * member the port promises is exercised here instead. This is the Node-side
 * counterpart to the compile-time check in `packages/extension`.
 */
describe("linkedom conforms to core's DOM port", () => {
  const document = createLinkedomParser().parse(
    `<!doctype html><html><head><title>Port</title></head>
     <body><form action="/p"><input type="password"></form><p>text</p></body></html>`,
    "https://example.com/",
  );

  it("exposes title as a string", () => {
    expect(document.title).toBe("Port");
  });

  it("exposes body with textContent", () => {
    expect(document.body?.textContent).toContain("text");
  });

  it("returns something iterable from querySelectorAll", () => {
    const forms = [...document.querySelectorAll("form")];
    expect(forms).toHaveLength(1);
  });

  it("returns an empty iterable rather than null for no matches", () => {
    expect([...document.querySelectorAll("video")]).toEqual([]);
  });

  it("exposes getAttribute returning null for an absent attribute", () => {
    const form = [...document.querySelectorAll("form")][0];
    expect(form?.getAttribute("action")).toBe("/p");
    expect(form?.getAttribute("method")).toBeNull();
  });

  it("exposes querySelectorAll on elements, not just the document", () => {
    const form = [...document.querySelectorAll("form")][0];
    const inputs = [...(form?.querySelectorAll("input") ?? [])];
    expect(inputs[0]?.getAttribute("type")).toBe("password");
  });
});
