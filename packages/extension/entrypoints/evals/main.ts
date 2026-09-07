import {
  chunkBudget,
  chunkPolicy,
  ClauseExtractionSchema,
  countPolicyTokens,
  EXTRACT_SYSTEM_PROMPT,
  buildExtractPrompt,
  dedupeClauses,
  PolicyLabelsSchema,
  scoreExtraction,
  verifyClauses,
  type Clause,
  type EvalFixtureResult,
  type EvalModelResult,
} from "core";

import { createVerifiedAppConfig } from "../../lib/model-integrity.js";
import { createWebLlmProvider } from "../../lib/webllm-provider.js";

/**
 * The evals runner (docs/05, docs/11 M7).
 *
 * A separate extension page that creates its own engine, because Node cannot
 * drive WebGPU and the workbench deliberately loads no engine at all (docs/09).
 * This is the only place a real model comparison can happen, which is why
 * docs/05 calls it the project's central research output: with only local
 * models available, choosing the model is the only lever left.
 *
 * Everything is exposed on `window.__evals` so a CDP driver can run it
 * unattended.
 */

const logEl = document.getElementById("log");

function log(message: string): void {
  if (logEl !== null) logEl.textContent += `${message}\n`;
  console.info(message);
}

interface Fixture {
  name: string;
  markdown: string;
  labels: ReturnType<typeof PolicyLabelsSchema.parse>;
}

async function loadFixtures(): Promise<Fixture[]> {
  const index = (await (await fetch(asset("fixtures/index.json"))).json()) as {
    policies: string[];
  };

  const fixtures: Fixture[] = [];
  for (const name of index.policies) {
    const markdown = await (await fetch(asset(`fixtures/${name}/policy.md`))).text();
    const labels = PolicyLabelsSchema.parse(
      await (await fetch(asset(`fixtures/${name}/labels.json`))).json(),
    );
    fixtures.push({ name, markdown, labels });
  }
  return fixtures;
}

/**
 * Resolve a staged fixture.
 *
 * The driver serves the built output over localhost, because Chrome refuses
 * automated navigation to `chrome-extension://` pages (see
 * `entrypoints/spike-s2/README.md`). There `browser.runtime` does not exist, so
 * the same relative path is used — the files sit at the same place under both
 * origins.
 */
function asset(path: string): string {
  const runtime = (globalThis as { browser?: { runtime?: { getURL?: unknown } } })
    .browser?.runtime;
  if (typeof runtime?.getURL === "function") {
    return (runtime.getURL as (p: string) => string)(`/${path}`);
  }
  return `/${path}`;
}

/**
 * Run one model over every fixture.
 *
 * The chunking, verification and scoring are core's — the same code the real
 * pipeline uses. If the eval used its own, it would be measuring something the
 * product does not do.
 */
async function runModel(modelId: string): Promise<EvalModelResult> {
  const provider = createWebLlmProvider({
    modelId,
    appConfig: createVerifiedAppConfig(),
    onProgress: (report) => {
      if (report.progress === 1 || report.text.includes("Finish"))
        log(`  ${report.text}`);
    },
  });

  log(`\n=== ${modelId} ===`);
  const loadStarted = performance.now();
  // Force the engine up before timing anything else, so load time is load time.
  const capabilities = await provider.capabilities();
  await provider.complete({
    system: "You reply with JSON.",
    messages: [{ role: "user", content: "Reply with {}" }],
    maxTokens: 8,
    temperature: 0,
  });
  const loadMs = Math.round(performance.now() - loadStarted);
  log(`  loaded in ${String(Math.round(loadMs / 1000))}s`);

  const fixtures = await loadFixtures();
  const results: EvalFixtureResult[] = [];

  for (const fixture of fixtures) {
    log(`  ${fixture.name}…`);
    try {
      results.push(await runFixture(provider, capabilities.contextTokens, fixture));
    } catch (error) {
      results.push({
        fixture: fixture.name,
        metrics: {
          recall: 0,
          quoteAccuracy: 0,
          schemaAdherence: 0,
          falseAlarms: 0,
          clausesExtracted: 0,
          clausesDropped: 0,
          chunks: 0,
          inputTokens: 0,
          outputTokens: 0,
          wallMs: 0,
        },
        missed: fixture.labels.expected.map((label) => ({
          category: label.category,
          substring: label.substring,
        })),
        error: error instanceof Error ? error.message : String(error),
      });
      log(`    failed: ${String(error)}`);
    }
  }

  await provider.unload();
  return { modelId, loadMs, fixtures: results };
}

async function runFixture(
  provider: ReturnType<typeof createWebLlmProvider>,
  contextTokens: number,
  fixture: Fixture,
): Promise<EvalFixtureResult> {
  const budget = chunkBudget({
    contextTokens,
    promptOverheadTokens: countPolicyTokens(EXTRACT_SYSTEM_PROMPT) + 120,
    maxOutputTokens: 700,
  });
  const chunks = chunkPolicy(fixture.markdown, { maxTokens: budget });

  const extracted: Clause[] = [];
  const dropped: Clause[] = [];
  let chunksValid = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const started = performance.now();

  for (const chunk of chunks) {
    let parsed;
    try {
      const response = await provider.complete({
        system: EXTRACT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildExtractPrompt(chunk) }],
        schema: ClauseExtractionSchema,
        maxTokens: 700,
        temperature: 0,
      });
      inputTokens += response.usage.inputTokens;
      outputTokens += response.usage.outputTokens;
      parsed = ClauseExtractionSchema.safeParse(response.json);
    } catch {
      // A refusal, a timeout, or output the grammar could not hold to. Counts
      // against schema adherence, which is one of the things being measured.
      continue;
    }

    if (!parsed.success) continue;
    chunksValid += 1;

    const withPath = parsed.data.clauses.map((clause) => ({
      ...clause,
      headingPath: chunk.headingPath,
    }));
    const { verified, rejected } = verifyClauses(withPath, chunk.text);
    extracted.push(...verified);
    dropped.push(...rejected.map((entry) => entry.clause));
  }

  const wallMs = Math.round(performance.now() - started);
  const merged = dedupeClauses(extracted);

  const { metrics, missed } = scoreExtraction({
    extracted: merged,
    dropped,
    labels: fixture.labels,
    sourceText: fixture.markdown,
    chunks: chunks.length,
    chunksValid,
    inputTokens,
    outputTokens,
    wallMs,
  });

  log(
    `    recall ${(metrics.recall * 100).toFixed(0)}% · quotes ${(metrics.quoteAccuracy * 100).toFixed(0)}% · schema ${(metrics.schemaAdherence * 100).toFixed(0)}% · ${String(Math.round(wallMs / 1000))}s`,
  );

  return { fixture: fixture.name, metrics, missed };
}

const api = { runModel, loadFixtures, log };
(window as unknown as { __evals: typeof api }).__evals = api;
log("evals ready");
