import { describe, expect, it } from "vitest";

import { chunkPolicy } from "../chunk.js";
import { chunkBudget, countTokens } from "../tokens.js";

const POLICY = `# Privacy Policy

Intro paragraph about the policy.

## 3\\. Your Content

Some words about content generally.

### 3.2 Licence

By submitting content you grant us a worldwide, irrevocable, perpetual,
royalty-free licence to reproduce, modify and distribute that content.

## 7\\. Disputes

Any dispute shall be resolved by binding individual arbitration.`;

describe("chunkBudget", () => {
  it("leaves room for the prompt and the answer", () => {
    const budget = chunkBudget({
      contextTokens: 4096,
      promptOverheadTokens: 700,
      maxOutputTokens: 600,
    });

    expect(budget).toBeGreaterThan(1500);
    expect(budget).toBeLessThan(4096 - 700 - 600);
  });

  it("never returns a budget too small to hold anything", () => {
    expect(
      chunkBudget({
        contextTokens: 512,
        promptOverheadTokens: 700,
        maxOutputTokens: 600,
      }),
    ).toBeGreaterThanOrEqual(256);
  });
});

describe("chunkPolicy", () => {
  it("splits on headings and records the full path", () => {
    const chunks = chunkPolicy(POLICY, { maxTokens: 2000 });
    const paths = chunks.map((chunk) => chunk.headingPath);

    // A clause needs to know it is under "Your Content", not merely "3.2 Licence".
    expect(paths).toContain("Privacy Policy > 3. Your Content > 3.2 Licence");
    expect(paths).toContain("Privacy Policy > 7. Disputes");
  });

  it("unescapes the backslashes turndown adds to numbered headings", () => {
    const paths = chunkPolicy(POLICY, { maxTokens: 2000 }).map((c) => c.headingPath);
    expect(paths.every((path) => !path.includes("\\"))).toBe(true);
  });

  it("numbers chunks in document order", () => {
    const chunks = chunkPolicy(POLICY, { maxTokens: 2000 });
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, i) => i));
  });

  it("keeps every chunk inside the budget", () => {
    const long = `# Terms\n\n${"This is a sentence about your rights and our obligations. ".repeat(600)}`;
    const chunks = chunkPolicy(long, { maxTokens: 400 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.approxTokens).toBeLessThanOrEqual(400);
    }
  });

  it("splits a single oversized paragraph rather than emitting it whole", () => {
    // Policies are written as walls of text; this is the normal case, not an edge one.
    const wall = `# Terms\n\n${"An indivisible clause sentence here. ".repeat(500)}`;
    const chunks = chunkPolicy(wall, { maxTokens: 300 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((c) => c.approxTokens))).toBeLessThanOrEqual(300);
  });

  it("overlaps adjacent chunks so a clause on a boundary survives", () => {
    const paragraphs = Array.from(
      { length: 40 },
      (_, index) =>
        `Paragraph ${String(index)} says something about your data and our rights.`,
    ).join("\n\n");
    const chunks = chunkPolicy(`# Terms\n\n${paragraphs}`, {
      maxTokens: 200,
      overlapRatio: 0.2,
    });

    expect(chunks.length).toBeGreaterThan(2);
    const first = chunks[0]?.text ?? "";
    const second = chunks[1]?.text ?? "";
    const tail = first.split("\n\n").at(-1) ?? "";
    expect(second).toContain(tail);
  });

  it("emits nothing for an empty policy rather than one empty chunk", () => {
    expect(chunkPolicy("", { maxTokens: 500 })).toEqual([]);
    expect(chunkPolicy("# Heading\n\n   \n", { maxTokens: 500 })).toEqual([]);
  });

  it("counts tokens with a real tokenizer, not a character estimate", () => {
    const text = "By submitting content you grant us a worldwide licence.";
    const chunks = chunkPolicy(`# T\n\n${text}`, { maxTokens: 500 });

    expect(chunks[0]?.approxTokens).toBe(countTokens(chunks[0]?.text ?? ""));
    // chars/4 would say ~14 for this; the real count is lower.
    expect(chunks[0]?.approxTokens).toBeLessThan(Math.ceil(text.length / 4));
  });
});
