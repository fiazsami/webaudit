import { describe, expect, it } from "vitest";

import {
  dedupeClauses,
  groupByCategory,
  rankClauses,
  scoreClause,
  topConcerns,
} from "../merge.js";
import type { Clause, ClauseCategory, Concern } from "../schema.js";

function clause(
  category: ClauseCategory,
  concern: Concern,
  quote = "some quoted text from the policy",
): Clause {
  return { category, quote, headingPath: "H", summary: "s", concern };
}

describe("dedupeClauses", () => {
  it("collapses the same clause seen through overlapping chunks", () => {
    const clauses = [
      clause(
        "arbitration",
        "high",
        "Any dispute shall be resolved by binding individual arbitration.",
      ),
      clause(
        "arbitration",
        "high",
        "any dispute shall be resolved by binding individual arbitration",
      ),
    ];
    expect(dedupeClauses(clauses)).toHaveLength(1);
  });

  it("keeps the longer quote, which has more of the clause in it", () => {
    const short = clause("arbitration", "high", "binding individual arbitration");
    const long = clause(
      "arbitration",
      "high",
      "binding individual arbitration and you waive any right to a jury trial",
    );

    expect(dedupeClauses([short, long])[0]?.quote).toBe(long.quote);
    expect(dedupeClauses([long, short])[0]?.quote).toBe(long.quote);
  });

  it("does not merge different clauses that share a category", () => {
    const clauses = [
      clause("data-sharing", "high", "We share your data with advertising partners."),
      clause("data-sharing", "medium", "We disclose data when required by law."),
    ];
    expect(dedupeClauses(clauses)).toHaveLength(2);
  });

  it("does not merge across categories even when the text matches", () => {
    const text = "We may change these terms at any time.";
    expect(
      dedupeClauses([
        clause("unilateral-changes", "high", text),
        clause("other-notable", "low", text),
      ]),
    ).toHaveLength(2);
  });
});

describe("rankClauses", () => {
  it("puts the most concerning first", () => {
    const ranked = rankClauses([
      clause("age-restriction", "low", "a"),
      clause("user-content-licence", "high", "b"),
      clause("jurisdiction", "medium", "c"),
    ]);
    expect(ranked[0]?.category).toBe("user-content-licence");
  });

  it("weighs the category, not just the concern", () => {
    // A high-concern jurisdiction clause should not outrank a high-concern
    // content licence.
    const ranked = rankClauses([
      clause("jurisdiction", "high", "a"),
      clause("user-content-licence", "high", "b"),
    ]);
    expect(ranked[0]?.category).toBe("user-content-licence");
  });

  it("is reproducible for clauses that score identically", () => {
    const list = [
      clause("data-sharing", "high", "zebra"),
      clause("data-sharing", "high", "apple"),
    ];
    expect(rankClauses(list).map((c) => c.quote)).toEqual(
      rankClauses([...list].reverse()).map((c) => c.quote),
    );
  });

  it("scores a clause of no concern at zero however weighty its category", () => {
    expect(scoreClause(clause("user-content-licence", "none"))).toBe(0);
  });
});

describe("topConcerns", () => {
  it("leaves out clauses the model said were not concerning", () => {
    const top = topConcerns([
      clause("user-content-licence", "none", "a"),
      clause("data-sharing", "medium", "b"),
    ]);
    expect(top).toHaveLength(1);
    expect(top[0]?.category).toBe("data-sharing");
  });

  it("returns at most five, as the report schema allows", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      clause("data-sharing", "high", `quote number ${String(index)} about sharing`),
    );
    expect(topConcerns(many).length).toBeLessThanOrEqual(5);
  });
});

describe("groupByCategory", () => {
  it("groups and orders categories by weight", () => {
    const groups = groupByCategory([
      clause("age-restriction", "low", "a"),
      clause("arbitration", "high", "b"),
      clause("arbitration", "medium", "c"),
    ]);

    expect(groups[0]?.category).toBe("arbitration");
    expect(groups[0]?.clauses).toHaveLength(2);
  });
});
