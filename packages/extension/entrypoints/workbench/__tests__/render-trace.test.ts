// @vitest-environment happy-dom
import type { AuditTrace } from "core";
import { describe, expect, it } from "vitest";

import { formatMs, renderTrace } from "../render-trace.js";

function trace(overrides: Partial<AuditTrace> = {}): AuditTrace {
  return {
    auditId: "a1",
    modelId: "webllm:Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    startedAt: 1_000,
    endedAt: 21_000,
    steps: [
      {
        index: 0,
        kind: "model",
        prompt: "Here is the page.\nFindings so far: none",
        response: JSON.stringify({
          reasoning: "headers are invisible from inside the page",
          tool: "fetchHeaders",
          input: { url: "https://example.com/" },
        }),
        usage: { inputTokens: 420, outputTokens: 35 },
        durationMs: 6000,
      },
      {
        index: 1,
        kind: "tool",
        name: "fetchHeaders",
        input: { url: "https://example.com/" },
        summary: "HTTP 200. 12 headers: content-type, x-frame-options",
        durationMs: 300,
      },
      {
        index: 2,
        kind: "budget",
        limit: "fetches",
        message: "network budget exhausted after 6 fetches",
        durationMs: 0,
      },
      {
        index: 3,
        kind: "error",
        name: "analyzePolicies",
        message: "boom",
        durationMs: 5,
      },
    ],
    budgetUsed: { steps: 4, fetches: 6, inputTokens: 1680, wallMs: 20_000 },
    stoppedBy: "fetches",
    ...overrides,
  };
}

function render(input: AuditTrace): HTMLElement {
  const host = document.createElement("div");
  host.append(renderTrace(input));
  return host;
}

describe("renderTrace", () => {
  it("leads with what a reader wants to know first", () => {
    const summary = render(trace()).querySelector(".trace-summary");

    expect(summary?.textContent).toContain("fetches");
    expect(summary?.textContent).toContain("Qwen2.5-1.5B");
    expect(summary?.textContent).toContain("1,680");
  });

  it("unpacks the model's action instead of showing raw JSON", () => {
    const host = render(trace());
    const step = host.querySelector('.step[data-kind="model"]');

    expect(step?.textContent).toContain("headers are invisible from inside the page");
    expect(step?.textContent).toContain("chose fetchHeaders");
  });

  it("shows what the model was asked, behind a disclosure", () => {
    const details = render(trace()).querySelector('.step[data-kind="model"] details');
    expect(details?.querySelector("summary")?.textContent).toContain("shown");
    expect(details?.textContent).toContain("Findings so far");
  });

  it("shows what each model call cost", () => {
    const cost = render(trace()).querySelector('.step[data-kind="model"] .cost');
    expect(cost?.textContent).toContain("420 in / 35 out");
    expect(cost?.textContent).toContain("6.0s");
  });

  it("renders each kind of step", () => {
    const host = render(trace());
    for (const kind of ["model", "tool", "budget", "error"]) {
      expect(host.querySelector(`.step[data-kind="${kind}"]`)).not.toBeNull();
    }
  });

  it("shows where the time actually went", () => {
    // On a local model, thinking dominates — seeing that is the point.
    const segments = render(trace()).querySelectorAll(".timeline span");
    expect(segments.length).toBeGreaterThan(1);
    // Proportional to duration: the 6s model call dwarfs the 300ms tool call.
    expect((segments[0] as HTMLElement).style.flex).toContain("6000");
    expect((segments[1] as HTMLElement).style.flex).toContain("300");
  });

  it("does not divide by zero on a trace with no durations", () => {
    const flat = trace({
      steps: [
        { index: 0, kind: "error", message: "failed immediately", durationMs: 0 },
      ],
    });
    expect(() => render(flat)).not.toThrow();
  });

  it("survives a model response that is not valid JSON", () => {
    const broken = trace({
      steps: [
        {
          index: 0,
          kind: "model",
          prompt: "p",
          response: "I think we should probably...",
          usage: { inputTokens: 1, outputTokens: 1 },
          durationMs: 10,
        },
      ],
    });
    expect(render(broken).textContent).toContain("not a valid action");
  });

  it("treats a tool summary as text, not markup", () => {
    // Tool summaries are derived from a page the audited site controls.
    const hostile = trace({
      steps: [
        {
          index: 0,
          kind: "tool",
          name: "analyzePolicies",
          input: {},
          summary: '<img src=x onerror="alert(1)">',
          durationMs: 1,
        },
      ],
    });
    const host = render(hostile);

    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("onerror");
  });
});

describe("formatMs", () => {
  it("scales the unit to the magnitude", () => {
    expect(formatMs(450)).toBe("450ms");
    expect(formatMs(6000)).toBe("6.0s");
    expect(formatMs(125_000)).toBe("2m 5s");
  });
});
