import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  chunkBudget,
  chunkPolicy,
  countPolicyTokens,
  PolicyLabelsSchema,
  quoteAppearsIn,
  scoreAgainstLabels,
  type Clause,
} from "core";
import { describe, expect, it } from "vitest";

/**
 * The labelled policy fixtures (docs/05 evals). These do not run a model —
 * that is the in-browser evals page's job (M7). They check the fixtures are
 * well formed and that the deterministic half of the pipeline handles them.
 */

const DIR = fileURLToPath(new URL("../../../../fixtures/policies/", import.meta.url));

async function sites(): Promise<string[]> {
  const entries = await readdir(DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function load(site: string) {
  const markdown = await readFile(`${DIR}${site}/policy.md`, "utf8");
  const labels = PolicyLabelsSchema.parse(
    JSON.parse(await readFile(`${DIR}${site}/labels.json`, "utf8")),
  );
  return { markdown, labels };
}

const names = await sites();

describe("policy fixtures", () => {
  it("has at least the two docs/11 asks for", () => {
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it.each(names)("%s has labels that parse", async (site) => {
    const { labels } = await load(site);
    expect(labels.expected.length).toBeGreaterThan(0);
  });

  it.each(names)(
    "%s labels every substring that is actually in the policy",
    async (site) => {
      const { markdown, labels } = await load(site);

      // A label naming text the policy does not contain can never be found, and
      // would quietly depress every model's recall score.
      for (const label of labels.expected) {
        expect(
          quoteAppearsIn(label.substring, markdown),
          `${site}: labelled substring not in policy: ${label.substring}`,
        ).toBe(true);
      }
      for (const text of labels.shouldNotConcern) {
        expect(quoteAppearsIn(text, markdown), `${site}: ${text}`).toBe(true);
      }
    },
  );

  it.each(names)("%s chunks into pieces a 4k model can read", async (site) => {
    const { markdown } = await load(site);
    const budget = chunkBudget({
      contextTokens: 4096,
      promptOverheadTokens: 400,
      maxOutputTokens: 700,
    });
    const chunks = chunkPolicy(markdown, { maxTokens: budget });

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.approxTokens).toBeLessThanOrEqual(budget);
      expect(chunk.headingPath).not.toBe("");
    }
  });

  it.each(names)("%s keeps every labelled clause inside some chunk", async (site) => {
    const { markdown, labels } = await load(site);
    const chunks = chunkPolicy(markdown, { maxTokens: 800 });

    // Chunking must not cut a labelled clause in half — that is what the
    // overlap is for.
    for (const label of labels.expected) {
      const inSome = chunks.some((chunk) =>
        quoteAppearsIn(label.substring, chunk.text),
      );
      expect(inSome, `${site}: chunking lost "${label.substring}"`).toBe(true);
    }
  });

  it("scores a perfect extraction as full recall", async () => {
    const { markdown, labels } = await load("fixture-shop");
    // Build the extraction a flawless model would produce.
    const clauses: Clause[] = labels.expected.map((label) => ({
      category: label.category,
      quote: label.substring,
      headingPath: "H",
      summary: "s",
      concern: label.minConcern === "none" ? "none" : label.minConcern,
    }));

    const score = scoreAgainstLabels(clauses, labels);
    expect(score.recall).toBe(1);
    expect(score.missed).toEqual([]);
    void markdown;
  });

  it("counts a model that flags harmless text as a false alarm", async () => {
    const { labels } = await load("social-app");
    const clauses: Clause[] = [
      {
        category: "data-sharing",
        quote: "We do not sell your personal information.",
        headingPath: "Sharing",
        summary: "They say they do not sell data.",
        concern: "high",
      },
    ];

    // Recall alone would reward a model that flags everything.
    expect(scoreAgainstLabels(clauses, labels).falseAlarms).toHaveLength(1);
  });

  it("uses a real tokenizer for the budget, not a character estimate", async () => {
    const { markdown } = await load("fixture-shop");
    expect(countPolicyTokens(markdown)).toBeGreaterThan(0);
    expect(countPolicyTokens(markdown)).toBeLessThan(markdown.length);
  });
});
