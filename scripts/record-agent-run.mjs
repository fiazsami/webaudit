#!/usr/bin/env node
/**
 * Record an agent run so the loop can be replayed without a model (docs/06).
 *
 * The model here is scripted, not real: it follows a fixed plan. That is
 * deliberate for a fixture — it makes "the tool sequence changed" mean the loop
 * changed, rather than that a model felt differently today. Swapping the
 * scripted provider for a live WebLLM engine is how a real recording gets made,
 * and that has to happen in a browser (docs/01).
 *
 * Only *model* calls are recorded. Network calls still happen on replay, so a
 * recording made against a live site needs that site reachable to replay. The
 * hermetic fixture used in CI stubs `http` instead.
 *
 *   node scripts/record-agent-run.mjs <snapshot.json> --out <recording.json> \
 *     --allow <domain> [--offline]
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { audit, createRecordingProvider, PageSnapshotSchema } from "core";

import { createNodeCapabilities } from "../packages/cli/dist/capabilities/index.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    allow: { type: "string", multiple: true, default: [] },
    /** Stub http, for a fixture that replays with no network. */
    offline: { type: "boolean", default: false },
  },
});

const snapshotPath = positionals[0];
if (snapshotPath === undefined || values.out === undefined) {
  throw new Error(
    "usage: record-agent-run.mjs <snapshot.json> --out <file> --allow <domain>",
  );
}

const snapshot = PageSnapshotSchema.parse(
  JSON.parse(await readFile(snapshotPath, "utf8")),
);

const plan = [
  {
    reasoning: "response headers cannot be seen from inside the page",
    tool: "fetchHeaders",
    input: { url: snapshot.url },
  },
  { reasoning: "re-run now that the headers exist", tool: "runAnalyzers", input: {} },
  { reasoning: "find the policies", tool: "discoverPolicies", input: {} },
  { reasoning: "read them", tool: "analyzePolicies", input: {} },
  {
    reasoning: "explain the worst finding",
    tool: "explainFinding",
    input: { findingId: "PLACEHOLDER" },
  },
  {
    reasoning: "that is enough",
    tool: "finish",
    input: { summary: `Audited ${snapshot.url}.` },
  },
];
let step = 0;

const scripted = {
  id: "webllm:Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  capabilities: async () => ({
    contextTokens: 4096,
    supportsJsonSchema: true,
    supportsToolCalls: false,
    supportsStreaming: true,
  }),
  countTokens: (text) => Math.ceil(text.length / 4),
  complete: async (request) => {
    if (request.system.includes("explain website security findings")) {
      const rule = /Rule: (\S+)/.exec(request.messages[0].content)?.[1] ?? "unknown";
      return {
        json: {
          explanation: `In plain terms, ${rule} affects how safely a visitor's browser treats this page.`,
          suggestedAction: "Review this setting.",
        },
        usage: { inputTokens: 300, outputTokens: 40 },
      };
    }

    if (request.system.includes("policy document")) {
      // Quote a real sentence out of the chunk, so verification has something
      // genuine to verify rather than passing vacuously.
      const body = request.messages[0].content;
      const doc = body
        .slice(body.indexOf("<document>") + 10, body.indexOf("</document>"))
        .trim();
      const sentence = doc
        .split(/(?<=[.;])\s+/)
        .find((s) => s.length > 80 && s.length < 380);
      return {
        json: {
          clauses: sentence
            ? [
                {
                  category: "data-collection",
                  quote: sentence.trim(),
                  headingPath: "x",
                  summary: "Describes data handling.",
                  concern: "low",
                },
              ]
            : [],
        },
        usage: { inputTokens: 900, outputTokens: 60 },
      };
    }

    const action = { ...plan[Math.min(step, plan.length - 1)] };
    step += 1;
    if (action.tool === "explainFinding") {
      const listed = request.messages.map((m) => m.content).join("\n");
      action.input = {
        findingId: /^(\S+) \| (?:critical|high|medium) \|/m.exec(listed)?.[1] ?? "none",
      };
    }
    return { json: action, usage: { inputTokens: 400, outputTokens: 35 } };
  },
};

let tick = 0;
const clock = { now: () => (tick += 200) };
const recorder = createRecordingProvider(scripted, clock);
await recorder.capabilities();

const base = createNodeCapabilities();
const capabilities = {
  ...base,
  provider: recorder,
  clock,
  ...(values.offline
    ? {
        http: {
          fetch: async (url) => ({
            url,
            status: 200,
            body: "<html><body>no policy here</body></html>",
            headers: {
              "content-type": "text/html; charset=utf-8",
              "x-frame-options": "DENY",
            },
          }),
        },
      }
    : {}),
};

const result = await audit(snapshot, {
  capabilities,
  budget: {
    maxSteps: 10,
    maxNetworkFetches: 5,
    maxInputTokens: 60_000,
    maxWallMs: 900_000,
    allowedDomains:
      values.allow.length > 0 ? values.allow : [new URL(snapshot.url).hostname],
  },
});

await writeFile(
  values.out,
  `${JSON.stringify(recorder.recording(), null, 2)}\n`,
  "utf8",
);

const tools = result.trace.steps.filter((s) => s.kind === "tool").map((s) => s.name);
process.stderr.write(
  [
    `tools: ${tools.join(" → ")}`,
    `stopped by ${result.trace.stoppedBy}, budget ${JSON.stringify(result.trace.budgetUsed)}`,
    `${String(result.findings.length)} findings, ${String(result.findings.filter((f) => f.explanation).length)} explained`,
    `${String(result.tosReport?.clauses.length ?? 0)} clauses from ${String(result.tosReport?.sources.length ?? 0)} policies`,
    `wrote ${String(recorder.recording().exchanges.length)} exchanges to ${values.out}`,
  ].join("\n") + "\n",
);
