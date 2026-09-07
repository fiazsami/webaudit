import type { PolicyChunk } from "./schema.js";
import { countTokens } from "./tokens.js";

/**
 * Stage 4: split a policy into pieces one model call can read (docs/05).
 *
 * Headings first, because a policy's own structure is the best boundary signal
 * available and because every chunk needs a heading path to tell the model —
 * and later the reader — where a clause came from. Only when a section is still
 * too large does this fall back to paragraphs, and then to sentences.
 */

export interface ChunkOptions {
  /** From `chunkBudget()`. */
  maxTokens: number;
  /** Overlap between adjacent chunks, so a clause split across a boundary survives. */
  overlapRatio?: number;
}

interface Section {
  headingPath: string;
  text: string;
}

export function chunkPolicy(markdown: string, options: ChunkOptions): PolicyChunk[] {
  const sections = splitIntoSections(markdown);
  const chunks: PolicyChunk[] = [];
  const overlapRatio = options.overlapRatio ?? 0.1;

  for (const section of sections) {
    for (const text of splitToBudget(section.text, options.maxTokens, overlapRatio)) {
      const trimmed = text.trim();
      if (trimmed === "") continue;
      chunks.push({
        index: chunks.length,
        headingPath: section.headingPath,
        text: trimmed,
        approxTokens: countTokens(trimmed),
      });
    }
  }

  return chunks;
}

/**
 * Walk the markdown, keeping a stack of headings so each block knows its full
 * path — "3. Your Content > 3.2 Licence" rather than just "3.2 Licence", which
 * on its own says nothing.
 */
function splitIntoSections(markdown: string): Section[] {
  const sections: Section[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  let current: string[] = [];

  const flush = (): void => {
    const text = current.join("\n").trim();
    if (text !== "") {
      sections.push({ headingPath: pathOf(stack), text });
    }
    current = [];
  };

  for (const line of markdown.split("\n")) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading === null) {
      current.push(line);
      continue;
    }

    flush();
    const level = heading[1]?.length ?? 1;
    // Turndown escapes "3." as "3\." so it is not read as a list; that escape
    // has no business in a heading path a person will read.
    const title = (heading[2] ?? "").replace(/\\([.\-*_])/g, "$1").trim();

    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
      stack.pop();
    }
    stack.push({ level, title });
  }

  flush();
  return sections;
}

function pathOf(stack: ReadonlyArray<{ title: string }>): string {
  return stack.map((entry) => entry.title).join(" > ");
}

/**
 * Cut a section down to size, preferring paragraph boundaries and falling back
 * to sentences. Overlap is carried from the tail of the previous piece.
 */
function splitToBudget(
  text: string,
  maxTokens: number,
  overlapRatio: number,
): string[] {
  if (countTokens(text) <= maxTokens) return [text];

  const units = splitUnits(text, maxTokens);
  const pieces: string[] = [];
  let buffer: string[] = [];
  let bufferTokens = 0;

  for (const unit of units) {
    const unitTokens = countTokens(unit);

    if (bufferTokens + unitTokens > maxTokens && buffer.length > 0) {
      const piece = buffer.join("\n\n");
      pieces.push(piece);
      // Start the next piece with the tail of this one, so a clause that
      // straddles the boundary is whole in at least one of them.
      const overlap = tailWithin(piece, Math.floor(maxTokens * overlapRatio));
      buffer = overlap === "" ? [] : [overlap];
      bufferTokens = overlap === "" ? 0 : countTokens(overlap);
    }

    buffer.push(unit);
    bufferTokens += unitTokens;
  }

  if (buffer.length > 0) pieces.push(buffer.join("\n\n"));
  return pieces;
}

/** Paragraphs, unless a paragraph is itself too big — then sentences. */
function splitUnits(text: string, maxTokens: number): string[] {
  const units: string[] = [];

  for (const paragraph of text.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (trimmed === "") continue;

    if (countTokens(trimmed) <= maxTokens) {
      units.push(trimmed);
      continue;
    }

    // A single paragraph over budget: a wall-of-text legal clause, which is
    // exactly the shape policies come in.
    let sentence = "";
    for (const part of trimmed.split(/(?<=[.;])\s+/)) {
      const candidate = sentence === "" ? part : `${sentence} ${part}`;
      if (countTokens(candidate) > maxTokens && sentence !== "") {
        units.push(sentence);
        sentence = part;
      } else {
        sentence = candidate;
      }
    }
    if (sentence !== "") units.push(sentence);
  }

  return units;
}

/** The last whole paragraphs of `text` that fit in `budget` tokens. */
function tailWithin(text: string, budget: number): string {
  if (budget <= 0) return "";
  const paragraphs = text.split(/\n{2,}/);
  const kept: string[] = [];
  let total = 0;

  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const paragraph = paragraphs[index] ?? "";
    const tokens = countTokens(paragraph);
    if (total + tokens > budget) break;
    kept.unshift(paragraph);
    total += tokens;
  }

  return kept.join("\n\n");
}
