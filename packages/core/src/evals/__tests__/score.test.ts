import { describe, expect, it } from "vitest";

import { PolicyLabelsSchema } from "../../tos/labels.js";
import type { Clause } from "../../tos/schema.js";
import { overallScore, scoreExtraction } from "../score.js";
import { EvalMetricsSchema } from "../schema.js";

const SOURCE = `## 3. Your Content

By submitting content you grant us a worldwide, irrevocable, perpetual licence.

## 7. Disputes

Any dispute shall be resolved by binding individual arbitration.

## 9. Contact

Questions may be sent to legal@example.invalid.`;

const labels = PolicyLabelsSchema.parse({
  site: "test",
  expected: [
    {
      category: "user-content-licence",
      substring: "irrevocable, perpetual",
      minConcern: "high",
    },
    {
      category: "arbitration",
      substring: "binding individual arbitration",
      minConcern: "high",
    },
  ],
  shouldNotConcern: ["Questions may be sent to"],
});

function clause(overrides: Partial<Clause>): Clause {
  return {
    category: "other-notable",
    quote: "x",
    headingPath: "H",
    summary: "s",
    concern: "low",
    ...overrides,
  };
}

const perfect: Clause[] = [
  clause({
    category: "user-content-licence",
    quote: "irrevocable, perpetual",
    concern: "high",
  }),
  clause({
    category: "arbitration",
    quote: "binding individual arbitration",
    concern: "high",
  }),
];

function score(input: Partial<Parameters<typeof scoreExtraction>[0]> = {}) {
  return scoreExtraction({
    extracted: perfect,
    dropped: [],
    labels,
    sourceText: SOURCE,
    chunks: 3,
    chunksValid: 3,
    inputTokens: 1000,
    outputTokens: 200,
    wallMs: 5000,
    ...input,
  });
}

describe("scoreExtraction", () => {
  it("gives a perfect extraction full marks", () => {
    const { metrics } = score();

    expect(metrics.recall).toBe(1);
    expect(metrics.quoteAccuracy).toBe(1);
    expect(metrics.schemaAdherence).toBe(1);
    expect(metrics.falseAlarms).toBe(0);
    expect(() => EvalMetricsSchema.parse(metrics)).not.toThrow();
  });

  it("names what was missed, so a low score is diagnosable", () => {
    const { metrics, missed } = score({ extracted: [perfect[0] as Clause] });

    expect(metrics.recall).toBe(0.5);
    expect(missed).toEqual([
      { category: "arbitration", substring: "binding individual arbitration" },
    ]);
  });

  it("counts dropped quotes against accuracy, not against recall", () => {
    const { metrics } = score({
      dropped: [clause({ quote: "we sell your data to brokers", concern: "high" })],
    });

    // Two of three quotes the model produced were real.
    expect(metrics.quoteAccuracy).toBeCloseTo(2 / 3);
    expect(metrics.recall).toBe(1);
    expect(metrics.clausesDropped).toBe(1);
  });

  it("re-verifies quotes rather than trusting the pipeline that produced them", () => {
    // A clause that reached the report but is not actually in the source: the
    // eval must catch that independently, or it is not measuring anything.
    const { metrics } = score({
      extracted: [...perfect, clause({ quote: "this sentence is not in the policy" })],
    });

    expect(metrics.quoteAccuracy).toBeCloseTo(2 / 3);
  });

  it("penalises flagging text the fixture says is harmless", () => {
    const { metrics } = score({
      extracted: [
        ...perfect,
        clause({ quote: "Questions may be sent to", concern: "high" }),
      ],
    });

    // Recall alone would reward a model that flags everything.
    expect(metrics.falseAlarms).toBe(1);
    expect(metrics.recall).toBe(1);
  });

  it("measures schema adherence as chunks that came back usable", () => {
    const { metrics } = score({ chunks: 4, chunksValid: 3 });
    expect(metrics.schemaAdherence).toBe(0.75);
  });

  it("does not divide by zero on an empty policy", () => {
    const { metrics } = score({
      extracted: [],
      dropped: [],
      chunks: 0,
      chunksValid: 0,
    });
    expect(metrics.quoteAccuracy).toBe(1);
    expect(metrics.schemaAdherence).toBe(1);
  });
});

describe("overallScore", () => {
  it("ranks a good extraction above a bad one", () => {
    const good = score().metrics;
    const bad = score({
      extracted: [],
      dropped: [clause({ quote: "invented" })],
      chunks: 3,
      chunksValid: 1,
    }).metrics;

    expect(overallScore(good)).toBeGreaterThan(overallScore(bad));
  });

  it("docks a model that cries wolf", () => {
    const clean = score().metrics;
    const noisy = { ...clean, falseAlarms: 3 };
    expect(overallScore(noisy)).toBeLessThan(overallScore(clean));
  });

  it("caps the false-alarm penalty rather than driving the score negative", () => {
    const metrics = { ...score().metrics, falseAlarms: 100 };
    expect(overallScore(metrics)).toBeGreaterThanOrEqual(0);
  });
});
