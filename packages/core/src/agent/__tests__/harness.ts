import { snapshotWith } from "../../analyzers/__tests__/snapshot-factory.js";
import type { Capabilities, ProgressEvent } from "../../capabilities.js";
import { silentLogger } from "../../logger.js";
import type { CompletionRequest, ModelProvider } from "../../providers/types.js";
import type { PageSnapshot } from "../../snapshot/schema.js";
import { defaultBudget, type Budget } from "../budget.js";

/**
 * A scripted orchestrator, for testing the loop rather than a model.
 *
 * Actions are handed out in order, so a test states the decisions it wants and
 * asserts what the loop did with them. What the model *would* choose is the
 * evals' question (M7); this is about whether the loop handles the choice
 * correctly.
 */

export interface AgentHarness {
  capabilities: Capabilities;
  budget: Budget;
  /** Every request the loop sent to the model, for inspecting the prompt. */
  requests: CompletionRequest[];
  events: ProgressEvent[];
  fetched: string[];
  bodies: Map<string, string>;
}

export interface HarnessOptions {
  actions: unknown[];
  /** Body served for any URL not in `bodies`. */
  defaultBody?: string;
  bodies?: Record<string, string>;
  headers?: Record<string, string>;
  budget?: Partial<Budget>;
}

export function agentHarness(options: HarnessOptions): AgentHarness {
  const requests: CompletionRequest[] = [];
  const events: ProgressEvent[] = [];
  const fetched: string[] = [];
  const bodies = new Map(Object.entries(options.bodies ?? {}));
  const queue = [...options.actions];

  let tick = 1_000;

  const provider: ModelProvider = {
    id: "scripted:agent",
    capabilities: () =>
      Promise.resolve({
        contextTokens: 4096,
        supportsJsonSchema: true,
        supportsToolCalls: false,
        supportsStreaming: false,
      }),
    countTokens: (text) => Math.ceil(text.length / 4),
    complete: (request) => {
      requests.push(request);
      // A request carrying a clause schema is the ToS pipeline, not the loop.
      const isExtraction = JSON.stringify(request.system).includes("policy document");
      if (isExtraction) {
        return Promise.resolve({
          json: { clauses: [] },
          usage: { inputTokens: 100, outputTokens: 10 },
        });
      }
      const next = queue.shift() ?? {
        reasoning: "done",
        tool: "finish",
        input: { summary: "ran out of scripted actions" },
      };
      return Promise.resolve({
        json: next,
        usage: { inputTokens: 200, outputTokens: 30 },
      });
    },
  };

  const capabilities = {
    provider,
    logger: silentLogger,
    clock: {
      now: () => {
        tick += 10;
        return tick;
      },
    },
    progress: { emit: (event: ProgressEvent) => events.push(event) },
    http: {
      fetch: (url: string) => {
        fetched.push(url);
        return Promise.resolve({
          url,
          status: 200,
          headers: options.headers ?? { "content-type": "text/html" },
          body: bodies.get(url) ?? options.defaultBody ?? "<html><body>x</body></html>",
        });
      },
    },
    dom: {
      parse: () => {
        throw new Error("dom.parse not used in these tests");
      },
      extractArticle: (html: string) => ({ title: "Policy", markdown: html }),
    },
    store: {
      putAudit: () => Promise.resolve(),
      getAudit: () => Promise.resolve(undefined),
      listAudits: () => Promise.resolve([]),
      getCachedExtraction: () => Promise.resolve(undefined),
      putCachedExtraction: () => Promise.resolve(),
    },
  } as unknown as Capabilities;

  const budget: Budget = {
    ...defaultBudget({
      capabilities: {
        contextTokens: 4096,
        supportsJsonSchema: true,
        supportsToolCalls: false,
        supportsStreaming: false,
      },
      allowedDomains: ["example.com"],
    }),
    ...options.budget,
  };

  return { capabilities, budget, requests, events, fetched, bodies };
}

export function pageSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return snapshotWith({
    url: "https://example.com/account",
    links: [
      { href: "https://example.com/privacy", text: "Privacy", policyHint: "privacy" },
    ],
    ...overrides,
  });
}
