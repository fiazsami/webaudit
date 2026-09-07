import type { Clause, ClauseCategory } from "./schema.js";
import { normalizeForMatch } from "./verify.js";

/**
 * Stages 6 and 7: deduplicate, then rank (docs/05).
 *
 * Ranking is deterministic. The model assesses how concerning a single clause
 * is; it does not decide what matters most overall. That split is what keeps
 * the ordering reproducible and stops a persuasive page from arguing its way to
 * the top or the bottom of the list.
 */

/** Overlap above which two clauses in the same category are the same clause. */
const DUPLICATE_OVERLAP = 0.6;

/**
 * How much a category matters before concern is taken into account.
 *
 * These are a judgement, and worth arguing with. The reasoning: rights you give
 * away permanently (a content licence) and rights you give up (arbitration)
 * outrank things you can change your mind about later.
 */
const CATEGORY_WEIGHT: Record<ClauseCategory, number> = {
  "user-content-licence": 10,
  arbitration: 10,
  "data-sharing": 9,
  "unilateral-changes": 7,
  "auto-renewal": 7,
  "data-retention": 6,
  "data-collection": 5,
  liability: 5,
  termination: 4,
  jurisdiction: 3,
  "age-restriction": 2,
  "other-notable": 2,
};

const CONCERN_WEIGHT = { none: 0, low: 1, medium: 2.5, high: 4 } as const;

/**
 * Collapse clauses the overlap between chunks produced twice.
 *
 * Same category and substantially the same quote means one clause seen from two
 * sides. The longer quote is kept, on the grounds that it is the one with more
 * of the clause in it.
 */
export function dedupeClauses(clauses: readonly Clause[]): Clause[] {
  const kept: Clause[] = [];

  for (const clause of clauses) {
    const existingIndex = kept.findIndex(
      (other) =>
        other.category === clause.category && quotesOverlap(other.quote, clause.quote),
    );

    if (existingIndex === -1) {
      kept.push(clause);
      continue;
    }

    const existing = kept[existingIndex];
    if (existing !== undefined && clause.quote.length > existing.quote.length) {
      kept[existingIndex] = clause;
    }
  }

  return kept;
}

function quotesOverlap(a: string, b: string): boolean {
  const left = normalizeForMatch(a);
  const right = normalizeForMatch(b);
  if (left === "" || right === "") return false;
  if (left === right) return true;
  // Containment is the common case: an overlapping chunk sees the same clause
  // with a little more or less of its surroundings.
  if (left.includes(right) || right.includes(left)) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = shorter === left ? right : left;
  const window = Math.floor(shorter.length * DUPLICATE_OVERLAP);
  if (window < 20) return false;
  return longer.includes(shorter.slice(0, window));
}

export function scoreClause(clause: Clause): number {
  return CATEGORY_WEIGHT[clause.category] * CONCERN_WEIGHT[clause.concern];
}

/**
 * Most concerning first. Ties break on category weight and then on quote, so
 * two runs over the same clauses produce the same order.
 */
export function rankClauses(clauses: readonly Clause[]): Clause[] {
  return [...clauses].sort((a, b) => {
    const byScore = scoreClause(b) - scoreClause(a);
    if (byScore !== 0) return byScore;
    const byCategory = CATEGORY_WEIGHT[b.category] - CATEGORY_WEIGHT[a.category];
    if (byCategory !== 0) return byCategory;
    return a.quote.localeCompare(b.quote);
  });
}

/**
 * The handful worth putting at the top of the report.
 *
 * Nothing scoring zero is included: a clause the model called "none" is not a
 * top concern just because the list was short.
 */
export function topConcerns(clauses: readonly Clause[], limit = 5): Clause[] {
  return rankClauses(clauses)
    .filter((clause) => scoreClause(clause) > 0)
    .slice(0, limit);
}

export function groupByCategory(
  clauses: readonly Clause[],
): Array<{ category: ClauseCategory; clauses: Clause[] }> {
  const groups = new Map<ClauseCategory, Clause[]>();
  for (const clause of rankClauses(clauses)) {
    const bucket = groups.get(clause.category);
    if (bucket === undefined) groups.set(clause.category, [clause]);
    else bucket.push(clause);
  }

  return [...groups.entries()]
    .map(([category, list]) => ({ category, clauses: list }))
    .sort((a, b) => CATEGORY_WEIGHT[b.category] - CATEGORY_WEIGHT[a.category]);
}

export { CATEGORY_WEIGHT };
