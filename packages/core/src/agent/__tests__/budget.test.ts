import { describe, expect, it } from "vitest";

import { BudgetExceeded, BudgetTracker, defaultBudget } from "../budget.js";

const caps = {
  contextTokens: 4096,
  supportsJsonSchema: true,
  supportsToolCalls: false,
  supportsStreaming: true,
};

function tracker(overrides: Partial<ReturnType<typeof defaultBudget>> = {}) {
  let now = 0;
  const budget = {
    ...defaultBudget({ capabilities: caps, allowedDomains: ["example.com"] }),
    ...overrides,
  };
  const instance = new BudgetTracker(budget, () => now);
  return { instance, advance: (ms: number) => (now += ms) };
}

describe("defaultBudget", () => {
  it("derives the token budget from the model, not a constant", () => {
    const small = defaultBudget({ capabilities: caps, allowedDomains: [] });
    const large = defaultBudget({
      capabilities: { ...caps, contextTokens: 32_768 },
      allowedDomains: [],
    });

    // The old 150_000 assumed a hosted frontier model (docs/06).
    expect(large.maxInputTokens).toBeGreaterThan(small.maxInputTokens);
  });

  it("scales the wall clock with the steps allowed", () => {
    const few = defaultBudget({ capabilities: caps, allowedDomains: [], maxSteps: 4 });
    const many = defaultBudget({
      capabilities: caps,
      allowedDomains: [],
      maxSteps: 12,
    });
    expect(many.maxWallMs).toBeGreaterThan(few.maxWallMs);
  });

  it("copies the allowed domains rather than aliasing the caller's array", () => {
    const domains = ["example.com"];
    const budget = defaultBudget({ capabilities: caps, allowedDomains: domains });
    domains.push("attacker.example");
    expect(budget.allowedDomains).toEqual(["example.com"]);
  });
});

describe("BudgetTracker", () => {
  it("allows steps until the limit", () => {
    const { instance } = tracker({ maxSteps: 2 });
    expect(instance.canTakeStep()).toBe(true);
    instance.recordStep(10);
    instance.recordStep(10);
    expect(instance.canTakeStep()).toBe(false);
    expect(instance.exhaustedBy()).toBe("steps");
  });

  it("stops on wall time", () => {
    const { instance, advance } = tracker({ maxWallMs: 1000 });
    advance(1001);
    expect(instance.canTakeStep()).toBe(false);
    expect(instance.exhaustedBy()).toBe("wallMs");
  });

  it("stops on input tokens", () => {
    const { instance } = tracker({ maxInputTokens: 100 });
    instance.recordStep(150);
    expect(instance.canTakeStep()).toBe(false);
    expect(instance.exhaustedBy()).toBe("inputTokens");
  });

  it("throws rather than returning false when a fetch is over budget", () => {
    const { instance } = tracker({ maxNetworkFetches: 1 });
    instance.spendFetch();

    // A tool must not be able to proceed past this.
    expect(() => instance.spendFetch()).toThrow(BudgetExceeded);
  });

  it("refuses a URL outside the allowed domains", () => {
    const { instance } = tracker();
    expect(() => instance.assertDomainAllowed("https://attacker.example/x")).toThrow(
      BudgetExceeded,
    );
  });

  it("allows subdomains of an allowed domain", () => {
    const { instance } = tracker();
    expect(() =>
      instance.assertDomainAllowed("https://legal.example.com/terms"),
    ).not.toThrow();
  });

  it("refuses a host that merely ends with the allowed string", () => {
    const { instance } = tracker();
    expect(() => instance.assertDomainAllowed("https://notexample.com/")).toThrow(
      BudgetExceeded,
    );
  });

  it("refuses something that is not a URL", () => {
    const { instance } = tracker();
    expect(() => instance.assertDomainAllowed("not a url")).toThrow(BudgetExceeded);
  });

  it("reports what it has spent", () => {
    const { instance, advance } = tracker();
    instance.recordStep(42);
    instance.spendFetch();
    advance(500);

    expect(instance.used).toEqual({
      steps: 1,
      fetches: 1,
      inputTokens: 42,
      wallMs: 500,
    });
  });
});
