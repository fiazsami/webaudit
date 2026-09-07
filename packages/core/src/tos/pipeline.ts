import type { Capabilities } from "../capabilities.js";
import { stableHash } from "../hash.js";
import type { PageSnapshot } from "../snapshot/schema.js";
import { chunkPolicy } from "./chunk.js";
import { discoverPolicies, type DiscoverOptions } from "./discover.js";
import { dedupeClauses, rankClauses, topConcerns } from "./merge.js";
import {
  buildExtractPrompt,
  EXTRACT_SYSTEM_PROMPT,
  extractPromptOverheadTokens,
} from "./prompt.js";
import { z } from "zod";

import {
  ClauseExtractionSchema,
  ClauseSchema,
  type Clause,
  type PolicyChunk,
  type PolicyDocument,
  type TosLimitation,
  type TosReport,
} from "./schema.js";
import { chunkBudget, countTokens } from "./tokens.js";
import { verifyClauses } from "./verify.js";

/**
 * The ToS pipeline (docs/05).
 *
 * discover → fetch → extract-text → chunk → extract-clauses → merge → rank →
 * report. Everything except fetching and DOM work is pure; those two arrive
 * through `Capabilities`.
 */

export interface TosPipelineOptions {
  capabilities: Capabilities;
  /**
   * Reuse a previous extraction of the same text by the same model. On by
   * default: S2 makes re-reading an unchanged policy cost minutes (docs/05).
   */
  useCache?: boolean;
  discover?: DiscoverOptions;
  /**
   * Cap on model calls. S2 measured ~6 s per chunk on the default model, so
   * twenty chunks is two minutes and the user is watching a progress bar.
   */
  maxChunks?: number;
  /** Bytes; a policy page should not be a download. */
  maxBytes?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_CHUNKS = 20;
const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 700;

export async function runTosPipeline(
  snapshot: PageSnapshot,
  options: TosPipelineOptions,
): Promise<TosReport> {
  const { capabilities } = options;
  const limitations = new Set<TosLimitation>();

  const candidates = discoverPolicies(snapshot, options.discover ?? {});
  if (candidates.length === 0) {
    limitations.add("no-policy-found");
    return emptyReport(capabilities.provider.id, limitations);
  }

  // --- fetch and extract ------------------------------------------------
  const documents: PolicyDocument[] = [];
  for (const candidate of candidates) {
    capabilities.progress.emit({
      stage: "tos",
      step: "fetch",
      message: `Fetching ${candidate.url}`,
    });

    const document = await fetchPolicy(candidate.url, options);
    if (document === undefined) {
      limitations.add("fetch-failed");
      continue;
    }
    documents.push(document);
  }

  if (documents.length === 0) {
    return emptyReport(capabilities.provider.id, limitations);
  }

  // --- chunk ------------------------------------------------------------
  const capabilitiesInfo = await capabilities.provider.capabilities();
  const budget = chunkBudget({
    contextTokens: capabilitiesInfo.contextTokens,
    promptOverheadTokens: extractPromptOverheadTokens(countTokens),
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  });

  const useCache = options.useCache !== false;
  const chunked: Array<{ document: PolicyDocument; chunk: PolicyChunk }> = [];
  const collected: Clause[] = [];
  const uncachedDocuments: PolicyDocument[] = [];

  for (const document of documents) {
    if (useCache) {
      const cached = await readCache(document, capabilities);
      if (cached !== undefined) {
        capabilities.progress.emit({
          stage: "tos",
          step: "cache",
          message: `Reusing a previous reading of ${document.url}`,
        });
        collected.push(...cached);
        continue;
      }
    }

    uncachedDocuments.push(document);
    for (const chunk of chunkPolicy(document.markdown, { maxTokens: budget })) {
      chunked.push({ document, chunk });
    }
  }

  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  if (chunked.length > maxChunks) {
    // A truncated read must not look like a complete one (docs/02's rule,
    // applied here).
    limitations.add("chunk-budget-exhausted");
    limitations.add("policy-truncated");
  }
  const work = chunked.slice(0, maxChunks);

  // --- extract clauses (map), serial ------------------------------------
  // One engine handles one request at a time, and a second engine means a
  // second copy of the weights in VRAM (docs/05 stage 6).
  const perDocument = new Map<string, Clause[]>();

  for (const [index, item] of work.entries()) {
    options.signal?.throwIfAborted();
    capabilities.progress.emit({
      stage: "tos",
      step: "extract",
      current: index + 1,
      total: work.length,
      message: `Reading section ${String(index + 1)} of ${String(work.length)}`,
    });

    const clauses = await extractChunk(item.chunk, options);
    if (clauses === undefined) {
      limitations.add("extraction-failed");
      continue;
    }

    // Verified against the chunk it came from, not the whole policy: a quote
    // "found" in a different section is not the quote that was asked for.
    const { verified } = verifyClauses(clauses, item.chunk.text);
    collected.push(...verified);

    const bucket = perDocument.get(item.document.contentHash) ?? [];
    bucket.push(...verified);
    perDocument.set(item.document.contentHash, bucket);
  }

  // Only cache a document that was read in full. A truncated reading stored as
  // if it were complete would be wrong on every later run, silently.
  if (useCache && !limitations.has("chunk-budget-exhausted")) {
    for (const document of uncachedDocuments) {
      await writeCache(
        document,
        perDocument.get(document.contentHash) ?? [],
        capabilities,
      );
    }
  }

  // --- merge, rank, report ----------------------------------------------
  const clauses = rankClauses(dedupeClauses(collected));

  return {
    sources: documents.map((document) => ({
      url: document.url,
      fetchedAt: document.fetchedAt,
      contentHash: document.contentHash,
    })),
    clauses,
    topConcerns: topConcerns(clauses),
    overallSummary: summarise(clauses, documents.length),
    modelId: capabilities.provider.id,
    limitations: [...limitations].sort(),
  };
}

async function readCache(
  document: PolicyDocument,
  capabilities: Capabilities,
): Promise<Clause[] | undefined> {
  try {
    const cached = await capabilities.store.getCachedExtraction({
      contentHash: document.contentHash,
      modelId: capabilities.provider.id,
    });
    if (cached === undefined) return undefined;

    // Straight off storage, so validated like anything else (hard rule 2).
    const parsed = z.array(ClauseSchema).safeParse(cached.clauses);
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    // A cache that cannot be read is a slow run, not a failed one.
    capabilities.logger.warn("tos: could not read the policy cache", error);
    return undefined;
  }
}

async function writeCache(
  document: PolicyDocument,
  clauses: readonly Clause[],
  capabilities: Capabilities,
): Promise<void> {
  try {
    await capabilities.store.putCachedExtraction({
      contentHash: document.contentHash,
      modelId: capabilities.provider.id,
      url: document.url,
      clauses,
      createdAt: capabilities.clock.now(),
    });
  } catch (error) {
    capabilities.logger.warn("tos: could not write the policy cache", error);
  }
}

async function fetchPolicy(
  url: string,
  options: TosPipelineOptions,
): Promise<PolicyDocument | undefined> {
  const { capabilities } = options;

  try {
    const response = await capabilities.http.fetch(url, {
      method: "GET",
      timeoutMs: 15_000,
      redirect: "follow",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    if (response.status < 200 || response.status >= 300) return undefined;
    if (response.body.length > (options.maxBytes ?? DEFAULT_MAX_BYTES)) {
      return undefined;
    }

    const article = capabilities.dom.extractArticle(response.body, response.url);
    if (article === undefined || article.markdown.trim() === "") return undefined;

    return {
      // The URL we landed on, not the one we asked for: a redirect means the
      // policy lives elsewhere and the report should say where.
      url: response.url,
      title: article.title,
      markdown: article.markdown,
      contentHash: stableHash(article.markdown),
      fetchedAt: new Date(capabilities.clock.now()).toISOString(),
    };
  } catch (error) {
    capabilities.logger.warn(`tos: could not fetch ${url}`, error);
    return undefined;
  }
}

async function extractChunk(
  chunk: PolicyChunk,
  options: TosPipelineOptions,
): Promise<Clause[] | undefined> {
  const { capabilities } = options;

  try {
    const response = await capabilities.provider.complete({
      system: EXTRACT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildExtractPrompt(chunk) }],
      schema: ClauseExtractionSchema,
      maxTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      temperature: 0,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    const parsed = ClauseExtractionSchema.safeParse(response.json);
    if (!parsed.success) {
      // A model that cannot produce the shape is a fact worth surfacing, not a
      // quiet empty result — it is the difference between "this section had
      // nothing in it" and "we could not read this section".
      capabilities.logger.warn(
        `tos: chunk ${String(chunk.index)} returned an unusable shape`,
        parsed.error.issues[0]?.message,
      );
      return undefined;
    }

    // The heading path is ours, not the model's. It has no reason to invent one
    // and every reason to get it wrong.
    return parsed.data.clauses.map((clause) => ({
      ...clause,
      headingPath: chunk.headingPath,
    }));
  } catch (error) {
    capabilities.logger.warn(
      `tos: extraction failed for chunk ${String(chunk.index)}`,
      error,
    );
    return undefined;
  }
}

/**
 * A deterministic summary rather than another model call.
 *
 * docs/05 allowed for a synthesis call here. It is not worth one: at 20 tokens
 * a second the user has already waited minutes, and a count of what was found
 * says more than a paragraph of generated prose about it. Revisit if the evals
 * show otherwise.
 */
function summarise(clauses: readonly Clause[], sourceCount: number): string {
  if (clauses.length === 0) {
    return sourceCount === 1
      ? "No notable clauses were extracted from the policy that was read."
      : `No notable clauses were extracted from the ${String(sourceCount)} policies that were read.`;
  }

  const concerning = clauses.filter(
    (clause) => clause.concern === "high" || clause.concern === "medium",
  );
  const categories = new Set(concerning.map((clause) => clause.category));

  if (concerning.length === 0) {
    return `${String(clauses.length)} clauses were extracted, none of which the model flagged as concerning.`;
  }

  return (
    `${String(clauses.length)} clauses were extracted, ${String(concerning.length)} of them ` +
    `flagged as worth attention across ${String(categories.size)} ` +
    `${categories.size === 1 ? "category" : "categories"}: ` +
    `${[...categories].join(", ")}.`
  );
}

function emptyReport(modelId: string, limitations: Set<TosLimitation>): TosReport {
  return {
    sources: [],
    clauses: [],
    topConcerns: [],
    overallSummary: "No policy could be read.",
    modelId,
    limitations: [...limitations].sort(),
  };
}
