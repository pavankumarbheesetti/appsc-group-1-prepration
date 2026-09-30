/**
 * Pure state mapping for the numbered question navigator used by the shared
 * quiz runner.
 *
 * Given the session length, the currently displayed index, and a map of the
 * answered questions (index → correct?), it produces one {@link NavCell} per
 * question describing how its numbered chip should render:
 *
 *  - `correct`    — answered, and answered correctly (green chip);
 *  - `wrong`      — answered, but answered incorrectly (red chip);
 *  - `current`    — the question on screen that has NOT been answered yet;
 *  - `unanswered` — not answered and not current (neutral chip).
 *
 * `current` is a separate boolean so an ALREADY-ANSWERED question that is also
 * the one on screen keeps its correct/wrong colour AND gains the "current" ring.
 * This module is intentionally DOM-free so it can be unit-tested in isolation.
 */

/** The visual state of a single numbered navigator chip. */
export type NavState = 'correct' | 'wrong' | 'current' | 'unanswered';

/** One numbered chip in the navigator. */
export interface NavCell {
  /** Zero-based question index. */
  index: number;
  /** 1-based label shown on the chip. */
  label: string;
  /** Colour/emphasis state (see {@link NavState}). */
  state: NavState;
  /** Whether this is the question currently on screen. */
  current: boolean;
}

/**
 * Build the navigator cells for a session.
 *
 * @param total       number of questions in the session
 * @param currentIdx  index of the question currently on screen
 * @param results     answered questions mapped to their correctness
 */
export function computeNavCells(
  total: number,
  currentIdx: number,
  results: ReadonlyMap<number, boolean>,
): NavCell[] {
  const cells: NavCell[] = [];
  for (let i = 0; i < total; i += 1) {
    const current = i === currentIdx;
    let state: NavState;
    if (results.has(i)) {
      state = results.get(i) ? 'correct' : 'wrong';
    } else if (current) {
      state = 'current';
    } else {
      state = 'unanswered';
    }
    cells.push({ index: i, label: String(i + 1), state, current });
  }
  return cells;
}
