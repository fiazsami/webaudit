import type { Clause } from "./schema.js";

/**
 * Quote verification (docs/05 stage 6).
 *
 * The single most important check in this pipeline. A model that invents a
 * clause and a page that injects one both produce the same artefact — text
 * claiming to be in the policy that is not — and both are caught here, by
 * looking for the quote in the source and dropping it when it is absent.
 *
 * Matching is done on normalised text, not raw. The source is markdown produced
 * by turndown, which escapes characters and rewraps lines, and a model copying
 * verbatim from it will not reproduce those artefacts. Normalising whitespace,
 * quotation marks, dashes and markdown escapes removes differences that are not
 * about meaning — without loosening the check into "roughly similar", which
 * would let a fabricated quote through.
 */

export function normalizeForMatch(text: string): string {
  return (
    text
      // Markdown escapes turndown adds: 3\. and \- and \*
      .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
      // Typographic punctuation a model may normalise on its way out
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[‐-―−]/g, "-")
      // Non-breaking and narrow no-break spaces, written as escapes because a
      // literal one is invisible in a diff.
      .replace(/[\u00a0\u202f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  );
}

/** Does this quote actually appear in the source? */
export function quoteAppearsIn(quote: string, source: string): boolean {
  const needle = normalizeForMatch(quote);
  if (needle === "") return false;
  return normalizeForMatch(source).includes(needle);
}

export interface VerificationResult {
  verified: Clause[];
  /** Dropped, with the quote that could not be found. */
  rejected: Array<{ clause: Clause; reason: "quote-not-found" | "quote-empty" }>;
}

/**
 * Keep only clauses whose quotes are really in the text they came from.
 *
 * Deliberately not lenient. A near-miss is still a quote the reader would go
 * looking for and not find, and the report's credibility rests on every quote
 * being checkable.
 */
export function verifyClauses(
  clauses: readonly Clause[],
  sourceText: string,
): VerificationResult {
  const verified: Clause[] = [];
  const rejected: VerificationResult["rejected"] = [];

  for (const clause of clauses) {
    if (clause.quote.trim() === "") {
      rejected.push({ clause, reason: "quote-empty" });
    } else if (quoteAppearsIn(clause.quote, sourceText)) {
      verified.push(clause);
    } else {
      rejected.push({ clause, reason: "quote-not-found" });
    }
  }

  return { verified, rejected };
}
