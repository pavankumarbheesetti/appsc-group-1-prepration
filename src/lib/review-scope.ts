/**
 * REVIEW SCOPE for the plan's "Review every wrong or guessed answer" blocks.
 *
 * Each submitted test records which of its questions need a second look:
 * every WRONG answer plus every answer tagged Guess / 50-50 — INCLUDING the
 * correct guesses (a lucky guess is not knowledge, and the notebook never sees
 * it because it only collects wrong answers). The review block then opens just
 * THAT DAY's list instead of the whole notebook.
 *
 * The ids ride along on the finished-test record as two additive fields
 * (`dateISO`, `reviewIds`); older records without them simply contribute
 * nothing. PURE helpers.
 */
import type { TestAttemptRecord } from '../state/store';

/** The additive review fields carried on a finished-test record. */
export interface ReviewFields {
  /** Local `YYYY-MM-DD` the test was submitted. */
  dateISO?: string;
  /** Question ids to review: wrong ∪ guessed (Guess / 50-50), in test order. */
  reviewIds?: string[];
}

/** A finished-test record with the review fields. */
export type ReviewableAttempt = TestAttemptRecord & ReviewFields;

/** Why a question is in the review list. */
export type ReviewReason = 'wrong' | 'guessed-correct';

/**
 * The review ids of one test: every attempted-and-wrong item plus every
 * attempted item tagged `guess` / `fifty` (even when correct). Blanks are not
 * included. PURE.
 */
export function reviewIdsOf(
  items: ReadonlyArray<{ id: string; answerIndex: number }>,
  selected: ReadonlyArray<number | null | undefined>,
  confidences: ReadonlyArray<string | null | undefined> = [],
): string[] {
  const out: string[] = [];
  items.forEach((item, i) => {
    const sel = selected[i];
    if (sel === null || sel === undefined) return;
    const wrong = sel !== item.answerIndex;
    const conf = confidences[i];
    const guessed = conf === 'guess' || conf === 'fifty';
    if (wrong || guessed) out.push(item.id);
  });
  return out;
}

/** Local `YYYY-MM-DD` of an epoch-ms instant. PURE (uses the local zone). */
export function localISO(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The submission day of a record (its stamp, else derived from `at`). PURE. */
export function attemptDay(rec: ReviewableAttempt): string {
  return rec.dateISO ?? localISO(rec.at);
}

/**
 * Every review id from tests submitted on `dateISO`, de-duplicated, earliest
 * test first. Optionally restricted to some runner `kinds`. PURE.
 */
export function dayReviewIds(
  attempts: readonly ReviewableAttempt[],
  dateISO: string,
  kinds?: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rec of attempts) {
    if (attemptDay(rec) !== dateISO) continue;
    if (kinds && !kinds.includes(rec.kind)) continue;
    for (const id of rec.reviewIds ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Whether any test was submitted on `dateISO` (optionally of `kinds`). PURE. */
export function testedOn(attempts: readonly ReviewableAttempt[], dateISO: string, kinds?: readonly string[]): boolean {
  return attempts.some((r) => attemptDay(r) === dateISO && (!kinds || kinds.includes(r.kind)));
}

/** Runner kinds that count as a "mock" for the mock-review block. */
export const MOCK_KINDS: readonly string[] = ['mock', 'full-mock', 'full-mock-omr', 'sectional-mock', 'scoped-mock'];
/** Runner kinds that count as the week test for the week-test-review block. */
export const WEEK_TEST_KINDS: readonly string[] = ['week-test', 'unit-test'];
