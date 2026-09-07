// @vitest-environment happy-dom
import type { Clause, TosReport } from "core";
import { describe, expect, it } from "vitest";

import { renderTosReport } from "../render-tos.js";

function clause(overrides: Partial<Clause> = {}): Clause {
  return {
    category: "user-content-licence",
    quote: "you grant us a worldwide, irrevocable, perpetual licence",
    headingPath: "3. Your Content > 3.2 Licence",
    summary: "They take a broad licence over anything you post.",
    concern: "high",
    concernReason: "It is perpetual and cannot be withdrawn.",
    ...overrides,
  };
}

function report(overrides: Partial<TosReport> = {}): TosReport {
  const clauses = overrides.clauses ?? [clause()];
  return {
    sources: [
      {
        url: "https://example.com/terms",
        fetchedAt: "2026-09-07T00:00:00.000Z",
        contentHash: "abc123",
      },
    ],
    clauses,
    topConcerns: clauses.filter((c) => c.concern === "high"),
    overallSummary: "3 clauses were extracted.",
    modelId: "webllm:test",
    limitations: [],
    ...overrides,
  };
}

function render(input: TosReport): HTMLElement {
  const host = document.createElement("div");
  host.append(renderTosReport(input));
  return host;
}

describe("renderTosReport", () => {
  it("shows the verbatim quote, which is what makes the report checkable", () => {
    const host = render(report());
    expect(host.querySelector(".quote")?.textContent).toContain(
      "worldwide, irrevocable, perpetual",
    );
  });

  it("says where in the policy each clause came from", () => {
    const host = render(report());
    expect(host.textContent).toContain("3. Your Content > 3.2 Licence");
    expect(host.textContent).toContain("https://example.com/terms");
  });

  it("opens high-concern clauses without a click", () => {
    const host = render(report());
    // `open` is a boolean attribute; reading it that way avoids depending on
    // whether the test DOM types querySelector generically.
    const details = host.querySelector("details.clause");
    expect(details?.hasAttribute("open")).toBe(true);
  });

  it("states limitations before the clauses, not after", () => {
    const host = render(report({ limitations: ["policy-truncated"] }));
    const limitations = host.querySelector(".tos-limitations");

    expect(limitations?.textContent).toContain("read only in part");
    // A partial reading that reads as complete is the failure this prevents.
    const first = host.querySelector(".tos-limitations, details.clause");
    expect(first?.className).toBe("tos-limitations");
  });

  it("groups the remaining clauses by category", () => {
    const host = render(
      report({
        clauses: [
          clause(),
          clause({
            category: "arbitration",
            concern: "low",
            quote: "binding individual arbitration",
          }),
        ],
      }),
    );
    expect(host.textContent).toContain("Disputes and arbitration");
  });

  it("labels the model's reasoning as the model's", () => {
    const host = render(report());
    expect(host.querySelector(".explanation-label")?.textContent).toContain("model");
  });

  it("treats a quote as text, never as markup", () => {
    // Quotes are verbatim from a page the audited site controls.
    const host = render(
      report({ clauses: [clause({ quote: '<img src=x onerror="alert(1)">' })] }),
    );

    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("onerror");
  });

  it("renders a report with no clauses without falling over", () => {
    const host = render(
      report({ clauses: [], topConcerns: [], overallSummary: "Nothing found." }),
    );
    expect(host.textContent).toContain("Nothing found.");
  });
});
