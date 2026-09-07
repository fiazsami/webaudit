import { describe, expect, it } from "vitest";

import { AuditTraceSchema } from "../trace.js";
import { runAgent } from "../orchestrator.js";
import { agentHarness, pageSnapshot } from "./harness.js";

const finish = (summary = "done") => ({
  reasoning: "nothing left",
  tool: "finish",
  input: { summary },
});

describe("runAgent", () => {
  it("runs the tools it is told to, in order", async () => {
    const harness = agentHarness({
      actions: [
        {
          reasoning: "headers first",
          tool: "fetchHeaders",
          input: { url: "https://example.com/account" },
        },
        { reasoning: "now analyzers", tool: "runAnalyzers", input: {} },
        finish("audited"),
      ],
    });

    const result = await runAgent(pageSnapshot(), {
      capabilities: harness.capabilities,
      budget: harness.budget,
      auditId: "a1",
    });

    expect(
      result.trace.steps.filter((s) => s.kind === "tool").map((s) => s.name),
    ).toEqual(["fetchHeaders", "runAnalyzers", "finish"]);
    expect(result.summary).toBe("audited");
    expect(result.trace.stoppedBy).toBe("finish");
  });

  it("produces a trace that validates", async () => {
    const harness = agentHarness({ actions: [finish()] });
    const result = await runAgent(pageSnapshot(), {
      capabilities: harness.capabilities,
      budget: harness.budget,
      auditId: "a1",
    });

    expect(() => AuditTraceSchema.parse(result.trace)).not.toThrow();
    expect(result.trace.modelId).toBe("scripted:agent");
  });

  it("carries findings from the deterministic pass into the loop", async () => {
    const harness = agentHarness({ actions: [finish()] });
    const result = await runAgent(pageSnapshot(), {
      capabilities: harness.capabilities,
      budget: harness.budget,
      auditId: "a1",
      findings: [
        {
          id: "transport:insecure-protocol:0000000000000000",
          analyzerId: "transport",
          ruleId: "insecure-protocol",
          severity: "high",
          confidence: "high",
          title: "Page served over HTTP",
          summary: "s",
          evidence: [{ kind: "other", value: "x" }],
          references: [],
          tags: [],
        },
      ],
    });

    expect(result.findings).toHaveLength(1);
    // The findings are in the first prompt, as id | severity | title.
    expect(harness.requests[0]?.messages[0]?.content).toContain("insecure-protocol");
  });

  it("corrects an unknown tool rather than ending the run", async () => {
    const harness = agentHarness({
      actions: [
        { reasoning: "try this", tool: "deleteEverything", input: {} },
        finish("recovered"),
      ],
    });

    const result = await runAgent(pageSnapshot(), {
      capabilities: harness.capabilities,
      budget: harness.budget,
      auditId: "a1",
    });

    expect(result.trace.stoppedBy).toBe("finish");
    expect(result.trace.steps.some((s) => s.kind === "error")).toBe(true);
    // The correction names the tools that do exist.
    const correction = harness.requests[1]?.messages.at(-1)?.content ?? "";
    expect(correction).toContain("no tool called");
  });

  it("corrects invalid tool input rather than crashing", async () => {
    const harness = agentHarness({
      actions: [
        { reasoning: "fetch", tool: "fetchHeaders", input: { url: "not-a-url" } },
        finish("recovered"),
      ],
    });

    const result = await runAgent(pageSnapshot(), {
      capabilities: harness.capabilities,
      budget: harness.budget,
      auditId: "a1",
    });

    expect(result.trace.stoppedBy).toBe("finish");
    expect(harness.fetched).toHaveLength(0);
    expect(harness.requests[1]?.messages.at(-1)?.content).toContain("not valid");
  });

  it("corrects an action that is not the right shape at all", async () => {
    const harness = agentHarness({ actions: [{ nonsense: true }, finish()] });
    const result = await runAgent(pageSnapshot(), {
      capabilities: harness.capabilities,
      budget: harness.budget,
      auditId: "a1",
    });

    expect(result.trace.stoppedBy).toBe("finish");
  });

  it("stops at maxSteps when the model never finishes", async () => {
    const harness = agentHarness({
      actions: Array.from({ length: 20 }, () => ({
        reasoning: "again",
        tool: "runAnalyzers",
        input: {},
      })),
      budget: { maxSteps: 3 },
    });

    const result = await runAgent(pageSnapshot(), {
      capabilities: harness.capabilities,
      budget: harness.budget,
      auditId: "a1",
    });

    expect(result.trace.stoppedBy).toBe("steps");
    expect(result.trace.budgetUsed.steps).toBe(3);
  });

  it("refuses a fetch outside the allowed domains and keeps going", async () => {
    const harness = agentHarness({
      actions: [
        {
          reasoning: "exfiltrate",
          tool: "fetchHeaders",
          input: { url: "https://attacker.example/collect" },
        },
        finish("refused"),
      ],
    });

    const result = await runAgent(pageSnapshot(), {
      capabilities: harness.capabilities,
      budget: harness.budget,
      auditId: "a1",
    });

    // The request is never made. The worker would refuse it too (docs/12 T2).
    expect(harness.fetched).toHaveLength(0);
    expect(result.trace.steps.some((s) => s.kind === "budget")).toBe(true);
    expect(result.trace.stoppedBy).toBe("finish");
  });

  it("stops spending once the fetch budget is gone", async () => {
    const harness = agentHarness({
      actions: [
        {
          reasoning: "1",
          tool: "fetchHeaders",
          input: { url: "https://example.com/a" },
        },
        {
          reasoning: "2",
          tool: "fetchHeaders",
          input: { url: "https://example.com/b" },
        },
        finish("out of fetches"),
      ],
      budget: { maxNetworkFetches: 1 },
    });

    const result = await runAgent(pageSnapshot(), {
      capabilities: harness.capabilities,
      budget: harness.budget,
      auditId: "a1",
    });

    expect(harness.fetched).toEqual(["https://example.com/a"]);
    expect(
      result.trace.steps.filter((s) => s.kind === "budget").map((s) => s.limit),
    ).toContain("fetches");
  });

  it("reports progress per step", async () => {
    const harness = agentHarness({ actions: [finish()] });
    await runAgent(pageSnapshot(), {
      capabilities: harness.capabilities,
      budget: harness.budget,
      auditId: "a1",
    });

    expect(harness.events.some((event) => event.stage === "agent")).toBe(true);
  });

  it("constrains the action with a schema rather than parsing prose", async () => {
    const harness = agentHarness({ actions: [finish()] });
    await runAgent(pageSnapshot(), {
      capabilities: harness.capabilities,
      budget: harness.budget,
      auditId: "a1",
    });

    // The JSON action protocol is the only tool-calling path (docs/01).
    expect(harness.requests[0]?.schema).toBeDefined();
    expect(harness.requests[0]?.tools).toBeUndefined();
  });
});
