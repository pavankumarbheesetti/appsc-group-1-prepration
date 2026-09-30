/**
 * English module PURE helpers (no DOM, no I/O) — small, deterministic functions
 * the English view uses for its self-evaluation checklists and grammar-area
 * filtering, kept here so they are trivially unit-testable.
 *
 * Word counting reuses {@link countWords} from `lib/mains` (the single
 * implementation shared by both writing trainers) — re-exported for the view's
 * convenience so it has one import site.
 */
import type { MCQItem } from '../content/types';
import { countWords } from './mains';

export { countWords };

/* -------------------------------------------------------------------------- */
/* checklistTally                                                              */
/* -------------------------------------------------------------------------- */

/** A writing-checklist tally: how many criteria are ticked out of the total. */
export interface ChecklistTally {
  /** Number of criteria the learner has ticked (clamped to 0..total). */
  checked: number;
  /** Total number of criteria. */
  total: number;
  /** Whole-number percentage 0–100 (0 when there is nothing to check). */
  pct: number;
  /** True only when every criterion is ticked (and there is at least one). */
  complete: boolean;
}

/**
 * Tally a checklist from the learner's `checks` against a known criterion
 * `total`.
 *
 * Robust to a stale/short/long `checks` array (e.g. after a checklist changes
 * length): only the first `total` flags count, extra `true`s never push
 * `checked` above `total`, and non-boolean/`undefined` slots count as unticked.
 */
export function checklistTally(checks: readonly boolean[], total: number): ChecklistTally {
  const safeTotal = Math.max(0, Math.floor(total));
  let checked = 0;
  for (let i = 0; i < safeTotal; i += 1) {
    if (checks[i] === true) checked += 1;
  }
  const pct = safeTotal === 0 ? 0 : Math.round((checked / safeTotal) * 100);
  return { checked, total: safeTotal, pct, complete: safeTotal > 0 && checked === safeTotal };
}

/* -------------------------------------------------------------------------- */
/* filterByArea                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Filter grammar MCQs by an area `tag`. An empty/`undefined` tag returns the
 * list unchanged (the "All areas" case); otherwise keeps items whose `tags`
 * include the tag. Never mutates the input array.
 */
export function filterByArea(items: readonly MCQItem[], tag?: string): MCQItem[] {
  if (!tag) return [...items];
  return items.filter((it) => it.tags?.includes(tag));
}
