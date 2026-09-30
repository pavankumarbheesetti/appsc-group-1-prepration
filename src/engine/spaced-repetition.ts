/**
 * Spaced-repetition scheduler — PURE functions only (no DOM, no storage).
 *
 * Implements a classic Leitner-box scheduler. A card lives in one of five
 * boxes; a correct answer promotes it to the next box (longer interval before
 * it is due again), a wrong answer demotes it all the way back to box 1 and
 * records a lapse. All timestamps are epoch milliseconds so the module stays
 * trivially testable with an injected `now`.
 */

/** A scheduled review card for a single MCQ. */
export interface SrCard {
  /** MCQ id this card tracks. */
  id: string;
  /** Current Leitner box, 1..5 (higher = better retained, longer interval). */
  box: number;
  /** Epoch ms when the card next becomes due for review. */
  due: number;
  /** How many times the card has been answered wrong (reset to box 1). */
  lapses: number;
}

/** A review grade — the only two outcomes the notebook/drill produce. */
export type Grade = 'correct' | 'wrong';

/**
 * Review interval (in DAYS) for each Leitner box, indexed by box number.
 *
 * Index 0 is unused (boxes are 1-based). A freshly promoted card in box N
 * becomes due `BOX_INTERVALS_DAYS[N]` days later. The sequence grows so that
 * well-known cards resurface progressively less often:
 *   box 1 → 1 day, box 2 → 3 days, box 3 → 7 days, box 4 → 16 days, box 5 → 35 days.
 */
export const BOX_INTERVALS_DAYS = [0, 1, 3, 7, 16, 35] as const;

/** Highest Leitner box; a correct answer in this box keeps the card here. */
export const MAX_BOX = 5;

/** Lowest Leitner box; a wrong answer always resets a card to this box. */
export const MIN_BOX = 1;

/** Milliseconds in a day, used to convert box intervals to `due` timestamps. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Create a fresh card for `id`, due immediately (`now`) in box 1 with no lapses.
 */
export function newCard(id: string, now: number): SrCard {
  return { id, box: MIN_BOX, due: now, lapses: 0 };
}

/**
 * Apply a review outcome and return the NEXT card (input is never mutated).
 *
 * - correct: promote one box (capped at {@link MAX_BOX}) and schedule the next
 *   review `BOX_INTERVALS_DAYS[newBox]` days out; lapses unchanged.
 * - wrong: reset to box 1, increment lapses, and make the card due right now
 *   so it comes back around in the current session.
 */
export function review(card: SrCard, grade: Grade, now: number): SrCard {
  if (grade === 'correct') {
    const box = Math.min(card.box + 1, MAX_BOX);
    const intervalDays = BOX_INTERVALS_DAYS[box] ?? 0;
    return { ...card, box, due: now + intervalDays * DAY_MS };
  }
  // Wrong: demote to box 1, count a lapse, resurface immediately.
  return { ...card, box: MIN_BOX, lapses: card.lapses + 1, due: now };
}

/** True when the card is at/after its due time and should be reviewed. */
export function isDue(card: SrCard, now: number): boolean {
  return card.due <= now;
}

/**
 * Return the cards that are due at `now`, sorted by due time ascending
 * (most overdue first). Input array is not mutated.
 */
export function nextDueList(cards: readonly SrCard[], now: number): SrCard[] {
  return cards.filter((c) => isDue(c, now)).sort((a, b) => a.due - b.due);
}
