import { describe, expect, it, vi } from "vitest";

import { createFinding, FindingSchema, type Finding } from "../../findings/schema.js";
import { silentLogger } from "../../logger.js";
import type { CompletionRequest, ModelProvider } from "../../providers/types.js";
import { buildExplainPrompt } from "../prompt.js";
import { explainFinding, explainFindings } from "../index.js";

function finding(
  overrides: Partial<Parameters<typeof createFinding>[0]> = {},
): Finding {
  return createFinding({
    analyzerId: "cookies",
    ruleId: "cookie-missing-httponly",
    severity: "medium",
    confidence: "high",
    title: "Cookies readable by JavaScript",
    summary: "These cookies lack HttpOnly.",
    evidence: [{ kind: "cookie", value: "sid", location: "example.com" }],
    ...overrides,
  });
}

/**
 * Answers with whatever it is told to, and remembers what it was asked. A
 * function reply throws instead, standing in for an unavailable model.
 */
function provider(reply: unknown): ModelProvider & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    id: "fake",
    requests,
    capabilities: () =>
      Promise.resolve({
        contextTokens: 4096,
        supportsJsonSchema: true,
        supportsToolCalls: false,
        supportsStreaming: false,
      }),
    countTokens: (t) => t.length,
    complete: (request) => {
      requests.push(request);
      if (typeof reply === "function") (reply as () => never)();
      return Promise.resolve({
        json: reply,
        usage: { inputTokens: 50, outputTokens: 20 },
      });
    },
  };
}

describe("buildExplainPrompt", () => {
  it("puts page-controlled evidence inside a delimited data block", () => {
    const prompt = buildExplainPrompt(finding());

    expect(prompt).toContain("<untrusted-evidence>");
    expect(prompt).toContain("</untrusted-evidence>");
    // The evidence value is inside the block, not loose in the instructions.
    const block = prompt.slice(
      prompt.indexOf("<untrusted-evidence>"),
      prompt.indexOf("</untrusted-evidence>"),
    );
    expect(block).toContain("sid");
  });

  it("caps how much evidence reaches a small context window", () => {
    const many = finding({
      evidence: Array.from({ length: 30 }, (_, index) => ({
        kind: "cookie" as const,
        value: `cookie-${String(index)}`,
        location: "x".repeat(50),
      })),
    });
    const prompt = buildExplainPrompt(many);

    expect(prompt).toContain("cookie-0");
    expect(prompt).not.toContain("cookie-20");
  });

  it("truncates a single enormous evidence value", () => {
    const prompt = buildExplainPrompt(
      finding({ evidence: [{ kind: "other", value: "A".repeat(5000) }] }),
    );
    expect(prompt.length).toBeLessThan(2000);
  });
});

describe("explainFinding", () => {
  it("writes the explanation and changes nothing else", async () => {
    const original = finding();
    const model = provider({
      explanation: "Any script on the page can read them.",
      suggestedAction: "Set HttpOnly.",
    });

    const explained = await explainFinding(original, {
      provider: model,
      logger: silentLogger,
    });

    expect(explained.explanation).toBe(
      "Any script on the page can read them. Set HttpOnly.",
    );
    expect({ ...explained, explanation: undefined }).toEqual({
      ...original,
      explanation: undefined,
    });
  });

  it("omits the action when the model has nothing to suggest", async () => {
    const model = provider({ explanation: "It is fine.", suggestedAction: "" });
    const explained = await explainFinding(finding(), {
      provider: model,
      logger: silentLogger,
    });

    expect(explained.explanation).toBe("It is fine.");
  });

  it("constrains the response with a schema rather than hoping", async () => {
    const model = provider({ explanation: "x", suggestedAction: "" });
    await explainFinding(finding(), { provider: model, logger: silentLogger });

    expect(model.requests[0]?.schema).toBeDefined();
    expect(model.requests[0]?.temperature).toBe(0);
  });

  it("keeps the finding when the model returns an unusable shape", async () => {
    const model = provider({ severity: "info", explanation: 42 });
    const explained = await explainFinding(finding(), {
      provider: model,
      logger: silentLogger,
    });

    expect(explained.explanation).toBeUndefined();
    expect(explained.severity).toBe("medium");
  });

  it("does not let a model smuggle extra fields into a finding", async () => {
    // A response with the right explanation *and* an attempt at severity.
    const model = provider({
      explanation: "Nothing to see here.",
      suggestedAction: "",
      severity: "info",
      ruleId: "something-else",
    });

    const explained = await explainFinding(finding(), {
      provider: model,
      logger: silentLogger,
    });

    expect(explained.severity).toBe("medium");
    expect(explained.ruleId).toBe("cookie-missing-httponly");
    expect(() => FindingSchema.parse(explained)).not.toThrow();
  });

  it("keeps the finding when the model is unavailable", async () => {
    const model = provider(() => {
      throw new Error("no GPU");
    });

    const explained = await explainFinding(finding(), {
      provider: model,
      logger: silentLogger,
    });

    // An unexplained finding beats a lost one.
    expect(explained.explanation).toBeUndefined();
    expect(explained.ruleId).toBe("cookie-missing-httponly");
  });

  it("logs the failure rather than swallowing it silently", async () => {
    const warn = vi.fn();
    const model = provider(() => {
      throw new Error("no GPU");
    });

    await explainFinding(finding(), {
      provider: model,
      logger: { ...silentLogger, warn },
    });

    expect(warn).toHaveBeenCalled();
  });
});

describe("explainFindings", () => {
  it("explains up to the limit and passes the rest through untouched", async () => {
    const model = provider({ explanation: "e", suggestedAction: "" });
    const list = [
      finding(),
      finding({ evidence: [{ kind: "cookie", value: "b" }] }),
      finding({ evidence: [{ kind: "cookie", value: "c" }] }),
    ];

    const explained = await explainFindings(list, {
      provider: model,
      logger: silentLogger,
      limit: 2,
    });

    expect(explained.filter((f) => f.explanation !== undefined)).toHaveLength(2);
    expect(model.requests).toHaveLength(2);
  });

  it("reports progress as it goes, since these are slow", async () => {
    const model = provider({ explanation: "e", suggestedAction: "" });
    const onProgress = vi.fn();

    await explainFindings(
      [finding(), finding({ evidence: [{ kind: "cookie", value: "b" }] })],
      {
        provider: model,
        logger: silentLogger,
        onProgress,
      },
    );

    expect(onProgress).toHaveBeenNthCalledWith(1, 1);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2);
  });
});
