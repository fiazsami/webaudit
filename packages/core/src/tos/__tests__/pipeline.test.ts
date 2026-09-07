import { describe, expect, it, vi } from "vitest";

import type {
  Capabilities,
  ExtractedArticle,
  ProgressEvent,
} from "../../capabilities.js";
import { silentLogger } from "../../logger.js";
import type { CompletionRequest, ModelProvider } from "../../providers/types.js";
import { snapshotWith } from "../../analyzers/__tests__/snapshot-factory.js";
import { runTosPipeline } from "../pipeline.js";
import { TosReportSchema } from "../schema.js";

const POLICY_HTML = `<article><h1>Privacy Policy</h1>
<h2>3. Your Content</h2>
<p>By submitting content you grant us a worldwide, irrevocable, perpetual,
royalty-free licence to reproduce, modify and distribute that content.</p>
<h2>7. Disputes</h2>
<p>Any dispute shall be resolved by binding individual arbitration. You waive
any right to a jury trial.</p></article>`;

const POLICY_MARKDOWN = `# Privacy Policy

## 3. Your Content

By submitting content you grant us a worldwide, irrevocable, perpetual, royalty-free licence to reproduce, modify and distribute that content.

## 7. Disputes

Any dispute shall be resolved by binding individual arbitration. You waive any right to a jury trial.`;

interface Harness {
  capabilities: Capabilities;
  events: ProgressEvent[];
  requests: CompletionRequest[];
  fetched: string[];
}

/** An in-memory policy cache, standing in for IndexedDB or the filesystem. */
function memoryStore(): Capabilities["store"] & { writes: number } {
  const entries = new Map<string, unknown>();
  const store = {
    writes: 0,
    putAudit: () => Promise.resolve(),
    getAudit: () => Promise.resolve(undefined),
    listAudits: () => Promise.resolve([]),
    getCachedExtraction: (key: { contentHash: string; modelId: string }) =>
      Promise.resolve(entries.get(`${key.contentHash}:${key.modelId}`) as never),
    putCachedExtraction: (entry: { contentHash: string; modelId: string }) => {
      store.writes += 1;
      entries.set(`${entry.contentHash}:${entry.modelId}`, entry);
      return Promise.resolve();
    },
  };
  return store;
}

function harness(
  options: {
    reply?: (request: CompletionRequest) => unknown;
    status?: number;
    article?: ExtractedArticle | undefined;
    store?: Capabilities["store"];
  } = {},
): Harness {
  const events: ProgressEvent[] = [];
  const requests: CompletionRequest[] = [];
  const fetched: string[] = [];

  const provider: ModelProvider = {
    id: "replay:test-model",
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
      const json = options.reply?.(request) ?? { clauses: [] };
      return Promise.resolve({ json, usage: { inputTokens: 100, outputTokens: 20 } });
    },
  };

  const capabilities = {
    provider,
    logger: silentLogger,
    clock: { now: () => 1_700_000_000_000 },
    progress: { emit: (event: ProgressEvent) => events.push(event) },
    http: {
      fetch: (url: string) => {
        fetched.push(url);
        return Promise.resolve({
          url,
          status: options.status ?? 200,
          headers: {},
          body: POLICY_HTML,
        });
      },
    },
    dom: {
      parse: () => {
        throw new Error("not used");
      },
      extractArticle: () =>
        "article" in options
          ? options.article
          : { title: "Privacy Policy", markdown: POLICY_MARKDOWN },
    },
    store: options.store ?? {
      get getCachedExtraction() {
        throw new Error("cache not available in this test");
      },
    },
  } as unknown as Capabilities;

  return { capabilities, events, requests, fetched };
}

/** Swap what the host's extractor returns, without spreading Capabilities. */
function setArticle(capabilities: Capabilities, article: ExtractedArticle): void {
  (
    capabilities.dom as unknown as { extractArticle: () => ExtractedArticle }
  ).extractArticle = () => article;
}

const snapshot = snapshotWith({
  url: "https://example.com/",
  links: [
    { href: "https://example.com/privacy", text: "Privacy", policyHint: "privacy" },
  ],
});

/** A model that quotes the policy correctly. */
const honest = () => ({
  clauses: [
    {
      category: "user-content-licence",
      quote: "you grant us a worldwide, irrevocable, perpetual, royalty-free licence",
      headingPath: "ignored",
      summary: "They take a broad licence over what you post.",
      concern: "high",
      concernReason: "It is perpetual and irrevocable.",
    },
  ],
});

describe("runTosPipeline", () => {
  it("produces a report that validates against the schema", async () => {
    const { capabilities } = harness({ reply: honest });
    const report = await runTosPipeline(snapshot, {
      capabilities,
      discover: { limit: 1 },
    });

    expect(() => TosReportSchema.parse(report)).not.toThrow();
    expect(report.modelId).toBe("replay:test-model");
  });

  it("extracts clauses whose quotes verify against the source", async () => {
    const { capabilities } = harness({ reply: honest });
    const report = await runTosPipeline(snapshot, {
      capabilities,
      discover: { limit: 1 },
    });

    expect(report.clauses.length).toBeGreaterThan(0);
    expect(report.clauses[0]?.category).toBe("user-content-licence");
    expect(report.topConcerns[0]?.concern).toBe("high");
  });

  it("drops a clause the model invented", async () => {
    const { capabilities } = harness({
      reply: () => ({
        clauses: [
          {
            category: "data-sharing",
            quote: "We sell your personal data to data brokers.",
            headingPath: "x",
            summary: "They sell your data.",
            concern: "high",
          },
        ],
      }),
    });

    const report = await runTosPipeline(snapshot, {
      capabilities,
      discover: { limit: 1 },
    });

    // The quote is not in the policy, so it does not reach the report — the same
    // check that stops a page injecting a clause (docs/05, docs/12 T1).
    expect(report.clauses).toEqual([]);
  });

  it("puts the policy text inside a delimited block announced as untrusted", async () => {
    const { capabilities, requests } = harness({ reply: honest });
    await runTosPipeline(snapshot, { capabilities, discover: { limit: 1 } });

    const prompt = requests[0]?.messages[0]?.content ?? "";
    expect(prompt).toContain("<document>");
    expect(prompt).toContain("</document>");
    expect(requests[0]?.system).toMatch(/UNTRUSTED\s+DATA/);
  });

  it("uses our heading path, not whatever the model returned", async () => {
    const { capabilities } = harness({ reply: honest });
    const report = await runTosPipeline(snapshot, {
      capabilities,
      discover: { limit: 1 },
    });

    expect(report.clauses[0]?.headingPath).not.toBe("ignored");
    expect(report.clauses[0]?.headingPath).toContain("Your Content");
  });

  it("constrains extraction with a schema", async () => {
    const { capabilities, requests } = harness({ reply: honest });
    await runTosPipeline(snapshot, { capabilities, discover: { limit: 1 } });

    expect(requests[0]?.schema).toBeDefined();
    expect(requests[0]?.temperature).toBe(0);
  });

  it("says so when it found no policy at all", async () => {
    const { capabilities } = harness();
    const bare = snapshotWith({ url: "not a url", links: [] });
    const report = await runTosPipeline(bare, { capabilities });

    expect(report.limitations).toContain("no-policy-found");
    expect(report.clauses).toEqual([]);
  });

  it("says so when the fetch failed rather than reporting an empty policy", async () => {
    const { capabilities } = harness({ status: 404 });
    const report = await runTosPipeline(snapshot, {
      capabilities,
      discover: { limit: 1 },
    });

    expect(report.limitations).toContain("fetch-failed");
  });

  it("says so when there was no readable article", async () => {
    const { capabilities } = harness({ article: undefined });
    const report = await runTosPipeline(snapshot, {
      capabilities,
      discover: { limit: 1 },
    });

    expect(report.limitations).toContain("fetch-failed");
  });

  it("declares truncation rather than quietly reading less", async () => {
    const long = `# Terms\n\n${"A clause sentence about your rights here. ".repeat(2000)}`;
    const { capabilities } = harness({ reply: () => ({ clauses: [] }) });
    setArticle(capabilities, { title: "Terms", markdown: long });

    const report = await runTosPipeline(snapshot, {
      capabilities,
      discover: { limit: 1 },
      maxChunks: 2,
    });

    expect(report.limitations).toContain("chunk-budget-exhausted");
    expect(report.limitations).toContain("policy-truncated");
  });

  it("reports progress per chunk, because the user is watching a bar", async () => {
    const { capabilities, events } = harness({ reply: honest });
    await runTosPipeline(snapshot, { capabilities, discover: { limit: 1 } });

    const extract = events.filter((event) => event.step === "extract");
    expect(extract.length).toBeGreaterThan(0);
    expect(extract[0]?.total).toBeGreaterThan(0);
  });

  it("records the URL it landed on, not the one it asked for", async () => {
    const { capabilities } = harness({ reply: honest });
    const report = await runTosPipeline(snapshot, {
      capabilities,
      discover: { limit: 1 },
    });

    expect(report.sources[0]?.url).toBe("https://example.com/privacy");
    expect(report.sources[0]?.contentHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    const { capabilities } = harness({
      reply: () => {
        controller.abort();
        return { clauses: [] };
      },
    });
    setArticle(capabilities, {
      title: "Terms",
      markdown: `# Terms\n\n${"A clause about your rights. ".repeat(2000)}`,
    });

    await expect(
      runTosPipeline(snapshot, {
        capabilities,
        discover: { limit: 1 },
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("reuses a cached reading instead of calling the model again", async () => {
    const store = memoryStore();
    const first = harness({ reply: honest, store });
    await runTosPipeline(snapshot, {
      capabilities: first.capabilities,
      discover: { limit: 1 },
    });
    expect(first.requests.length).toBeGreaterThan(0);
    expect(store.writes).toBe(1);

    // Same policy, same model: S2 makes re-reading it cost minutes (docs/05).
    const second = harness({ reply: honest, store });
    const report = await runTosPipeline(snapshot, {
      capabilities: second.capabilities,
      discover: { limit: 1 },
    });

    expect(second.requests).toHaveLength(0);
    expect(report.clauses.length).toBeGreaterThan(0);
  });

  it("does not cache a reading that was truncated", async () => {
    const store = memoryStore();
    const { capabilities } = harness({ reply: honest, store });
    setArticle(capabilities, {
      title: "Terms",
      markdown: `# Terms\n\n${"A clause about your rights. ".repeat(2000)}`,
    });

    await runTosPipeline(snapshot, {
      capabilities,
      discover: { limit: 1 },
      maxChunks: 1,
    });

    // Storing a partial reading as if it were complete would be wrong on every
    // later run, silently.
    expect(store.writes).toBe(0);
  });

  it("can be told not to use the cache", async () => {
    const store = memoryStore();
    const first = harness({ reply: honest, store });
    await runTosPipeline(snapshot, {
      capabilities: first.capabilities,
      discover: { limit: 1 },
    });

    const second = harness({ reply: honest, store });
    await runTosPipeline(snapshot, {
      capabilities: second.capabilities,
      discover: { limit: 1 },
      useCache: false,
    });

    expect(second.requests.length).toBeGreaterThan(0);
  });

  it("survives a model that returns an unusable shape", async () => {
    const warn = vi.fn();
    const { capabilities } = harness({ reply: () => ({ nonsense: true }) });
    // Assigned rather than spread: spreading would invoke the `store` getter,
    // which throws by design so a test cannot lean on a capability it should
    // not be using.
    (capabilities as { logger: typeof silentLogger }).logger = {
      ...silentLogger,
      warn,
    };

    const report = await runTosPipeline(snapshot, {
      capabilities,
      discover: { limit: 1 },
    });

    expect(report.limitations).toContain("extraction-failed");
    expect(warn).toHaveBeenCalled();
    expect(() => TosReportSchema.parse(report)).not.toThrow();
  });
});
