import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { audit, PageSnapshotSchema, type Budget, type Capabilities } from "core";
import { describe, expect, it } from "vitest";

import { createNodeCapabilities } from "../capabilities/index.js";
import { loadReplayProvider } from "../replay.js";

/**
 * M6's definition of done, minus the live-site half: the full loop runs from a
 * recorded session on a machine with no GPU, and reproduces exactly.
 */

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const RECORDING = `${ROOT}fixtures/recordings/agent-http-only.json`;
const SNAPSHOT = `${ROOT}fixtures/snapshots/http-only_synthetic.json`;

const BUDGET: Budget = {
  maxSteps: 10,
  maxNetworkFetches: 5,
  maxInputTokens: 60_000,
  maxWallMs: 900_000,
  allowedDomains: ["legacy-shop.example"],
};

async function snapshot() {
  return PageSnapshotSchema.parse(JSON.parse(await readFile(SNAPSHOT, "utf8")));
}

/** The same fixed headers the recording was made against. */
async function capabilities(): Promise<Capabilities> {
  const provider = await loadReplayProvider(RECORDING);
  let tick = 0;
  return {
    ...createNodeCapabilities(),
    provider,
    clock: { now: () => (tick += 200) },
    http: {
      fetch: (url: string) =>
        Promise.resolve({
          url,
          status: 200,
          body: "<html><body>no policy here</body></html>",
          headers: {
            "content-type": "text/html; charset=utf-8",
            "x-frame-options": "DENY",
          },
        }),
    },
  };
}

async function run() {
  return audit(await snapshot(), {
    capabilities: await capabilities(),
    budget: BUDGET,
  });
}

describe("replaying a recorded agent run", () => {
  it("completes within budget with no model present", async () => {
    const result = await run();

    expect(result.trace?.stoppedBy).toBe("finish");
    expect(result.trace?.budgetUsed.steps).toBeLessThanOrEqual(BUDGET.maxSteps);
    expect(result.trace?.budgetUsed.fetches).toBeLessThanOrEqual(
      BUDGET.maxNetworkFetches,
    );
  });

  it("reproduces the same tool sequence every time", async () => {
    const sequence = async () =>
      (await run()).trace?.steps
        .filter((step) => step.kind === "tool")
        .map((step) => (step.kind === "tool" ? step.name : ""));

    const first = await sequence();
    expect(first).toEqual([
      "fetchHeaders",
      "runAnalyzers",
      "discoverPolicies",
      "analyzePolicies",
      "explainFinding",
      "finish",
    ]);
    expect(await sequence()).toEqual(first);
  });

  it("actually did the work, not just the motions", async () => {
    const result = await run();

    // fetchHeaders enabled the header and CSP analyzers, which reported
    // themselves skipped on the first pass.
    const rules = result.findings.map((finding) => finding.ruleId);
    expect(rules).toContain("csp-missing");
    expect(rules).toContain("referrer-policy-missing");

    // And their "checks skipped" notes are gone, rather than sitting alongside
    // the findings they said had not run.
    const skipped = result.findings.filter((f) => f.ruleId === "analyzer-skipped");
    expect(skipped.map((f) => f.title)).not.toContain("Checks skipped: headers");
    expect(skipped.map((f) => f.title)).not.toContain("Checks skipped: csp");

    // And one finding came back explained.
    expect(result.findings.filter((f) => f.explanation !== undefined)).toHaveLength(1);
  });

  it("produces a trace that validates and records what it spent", async () => {
    const result = await run();

    expect(result.trace?.modelId).toContain("replay:");
    expect(result.trace?.budgetUsed.inputTokens).toBeGreaterThan(0);
    expect(result.summary).toContain("legacy-shop.example");
  });
});
