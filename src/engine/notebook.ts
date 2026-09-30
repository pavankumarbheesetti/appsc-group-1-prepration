/**
 * Wrong-answer notebook — PURE functions only (no DOM, no storage).
 *
 * Mirrors the old app's pedagogy: a question you get WRONG is added to a
 * notebook and must be answered correctly TWICE IN A ROW to "graduate" out of
 * it. Any wrong answer resets that streak, so a shaky question keeps coming
 * back until it is genuinely retained.
 */
import type { MCQItem } from '../content/types';

/** A single tracked question in the wrong-answer notebook. */
export interface NotebookEntry {
  /** MCQ id this entry tracks. */
  id: string;
  /** Epoch ms when the entry was first added (on the first wrong answer). */
  addedAt: number;
  /** Consecutive correct answers since the last wrong answer (streak). */
  consecutiveCorrect: number;
  /** True once the entry has graduated (2 consecutive corrects). */
  graduated: boolean;
}

/**
 * Consecutive correct answers required to graduate an entry out of the
 * active notebook. Kept as a named const because it is the core rule.
 */
export const GRADUATION_THRESHOLD = 2;

/**
 * Fold a single answer into a notebook entry and return the next entry state
 * (inputs are never mutated).
 *
 * NOTE: an explicit `id` is required because a WRONG answer on a not-yet-tracked
 * question must be able to create a brand-new entry (the illustrative
 * "entryOrUndefined" signature has no id to fall back on otherwise).
 *
 * - wrong: create the entry if missing (preserving original `addedAt` when it
 *   already existed), reset the streak to 0, and mark it active again.
 * - correct + tracked: increment the streak; graduate once it reaches
 *   {@link GRADUATION_THRESHOLD}.
 * - correct + untracked: return `undefined` — nothing to record.
 */
export function recordAnswer(
  id: string,
  entry: NotebookEntry | undefined,
  result: 'correct' | 'wrong',
  now: number,
): NotebookEntry | undefined {
  if (result === 'wrong') {
    // A wrong answer (re)activates the entry and resets the streak.
    return {
      id,
      addedAt: entry?.addedAt ?? now,
      consecutiveCorrect: 0,
      graduated: false,
    };
  }
  // Correct answer only matters for questions already in the notebook.
  if (!entry) return undefined;
  const consecutiveCorrect = entry.consecutiveCorrect + 1;
  return {
    ...entry,
    consecutiveCorrect,
    // Graduate once the streak reaches the threshold; stays graduated after.
    graduated: entry.graduated || consecutiveCorrect >= GRADUATION_THRESHOLD,
  };
}

/** True when the entry is still being actively drilled (not yet graduated). */
export function isActive(entry: NotebookEntry): boolean {
  return !entry.graduated;
}

/** Return the active (non-graduated) entries from a notebook map. */
export function activeEntries(
  map: Readonly<Record<string, NotebookEntry>>,
): NotebookEntry[] {
  return Object.values(map).filter(isActive);
}

/**
 * Select the MCQ items to quiz in a Notebook review pass.
 *
 * Notebook review is driven by notebook ACTIVENESS, not the spaced-repetition
 * schedule: every non-graduated entry that has a matching MCQ is included,
 * regardless of its SR due date. This is what lets a learner answer an item
 * correctly twice across consecutive passes in a single session and graduate
 * it — an SR-due-based selection would hide the item after the first correct
 * pushed its card days out, making in-session graduation impossible.
 *
 * Pure: inputs are never mutated; entries without a matching MCQ are skipped.
 */
export function selectReviewItems(
  map: Readonly<Record<string, NotebookEntry>>,
  itemsById: ReadonlyMap<string, MCQItem>,
): MCQItem[] {
  const out: MCQItem[] = [];
  for (const entry of activeEntries(map)) {
    const item = itemsById.get(entry.id);
    if (item) out.push(item);
  }
  return out;
}
