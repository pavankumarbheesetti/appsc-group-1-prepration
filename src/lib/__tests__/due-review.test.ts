import { describe, it, expect } from 'vitest';
import { flashcardDue, flashcardTodayLine, lastReviewedAt, reviewedOnDay, todaysSession, startOfLocalDay } from '../due';
import { reviewIdsOf, dayReviewIds, attemptDay, type ReviewableAttempt } from '../review-scope';
import { newCard, review } from '../../engine/spaced-repetition';
import type { Flashcard } from '../../engine/flashcards';
import type { SrCard } from '../../engine/spaced-repetition';

const deck = (n: number): Flashcard[] =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, front: `F${i}`, back: `B${i}`, source: 'card' as const, subtopicId: 's' }));

/** 10:00 local on a fixed day. */
const MORNING = new Date(2026, 9, 13, 10, 0, 0).getTime();
const HOUR = 3_600_000;

describe('due model (D13) — one count for Today / Revise / Progress / Drill', () => {
  it('reconstructs the review day from the Leitner rule (Good and Again)', () => {
    const good = review(newCard('a', MORNING), 'correct', MORNING);
    const again = review(newCard('b', MORNING), 'wrong', MORNING);
    // Exact instant or the start of that local day (if the scheduler anchors
    // due dates to local midnight) — either way the same local day.
    expect(startOfLocalDay(lastReviewedAt(good))).toBe(startOfLocalDay(MORNING));
    expect(startOfLocalDay(lastReviewedAt(again))).toBe(startOfLocalDay(MORNING));
    expect(reviewedOnDay(good, MORNING + 5 * HOUR)).toBe(true);
    expect(reviewedOnDay(good, startOfLocalDay(MORNING) + 25 * HOUR)).toBe(false);
  });

  it('"N cards for today" = min(due, 20) for a fresh deck', () => {
    const d = flashcardDue(deck(45), {}, MORNING);
    expect(d.due).toBe(45);
    expect(d.today).toBe(20);
    expect(flashcardTodayLine(d)).toBe('20 cards for today');
    expect(flashcardDue(deck(7), {}, MORNING).today).toBe(7);
  });

  it('does NOT refill after the day\u2019s 20 are finished — "Done for today — N more due tomorrow"', () => {
    const cards = deck(45);
    const sr: Record<string, SrCard> = {};
    // Review today's session (all Good).
    for (const c of todaysSession(cards, sr, MORNING)) sr[c.id] = review(newCard(c.id, MORNING), 'correct', MORNING);
    const later = MORNING + 2 * HOUR;
    const d = flashcardDue(cards, sr, later);
    expect(d.reviewedToday).toBe(20);
    expect(d.due).toBe(25); // still due…
    expect(d.today).toBe(0); // …but today's session is done
    expect(d.doneForToday).toBe(true);
    expect(todaysSession(cards, sr, later)).toHaveLength(0);
    expect(flashcardTodayLine(d)).toBe('Done for today \u2014 25 more due tomorrow');
    // "Keep going" ignores the daily cap.
    expect(todaysSession(cards, sr, later, true)).toHaveLength(20);
    // Next morning a fresh 20 is offered.
    expect(flashcardDue(cards, sr, MORNING + 24 * HOUR).today).toBe(20);
  });

  it('a partly finished session only offers what is left of the cap', () => {
    const cards = deck(30);
    const sr: Record<string, SrCard> = {};
    for (const c of cards.slice(0, 8)) sr[c.id] = review(newCard(c.id, MORNING), 'correct', MORNING);
    expect(flashcardDue(cards, sr, MORNING + HOUR).today).toBe(12);
  });

  it('scheduled = reviewed-before cards that came due (Today\u2019s early-revise threshold)', () => {
    const cards = deck(3);
    const yesterday = MORNING - 24 * HOUR;
    const sr: Record<string, SrCard> = { c0: review(newCard('c0', yesterday), 'correct', yesterday - 2 * HOUR) };
    const d = flashcardDue(cards, sr, MORNING);
    expect(d.scheduled).toBe(0); // box 2 → due in 3 days
    expect(d.due).toBe(2);
  });
});

describe('review scope (M5) — wrong + guessed, correct guesses kept', () => {
  const items = [
    { id: 'q1', answerIndex: 0 },
    { id: 'q2', answerIndex: 1 },
    { id: 'q3', answerIndex: 2 },
    { id: 'q4', answerIndex: 3 },
    { id: 'q5', answerIndex: 0 },
  ];

  it('lists wrong answers and Guess/50-50 answers even when correct; skips blanks and sure-correct', () => {
    const ids = reviewIdsOf(items, [0, 0, 2, 3, null], ['sure', null, 'guess', 'fifty', 'guess']);
    expect(ids).toEqual(['q2', 'q3', 'q4']);
  });

  it('scopes to one day\u2019s tests of the given kinds, de-duplicated', () => {
    const base = { total: 5, attempted: 3, correct: 1, wrong: 2, skipped: 2, net: 0, guessAttempted: 0, guessCorrect: 0, marksLostToWrong: 0 };
    const attempts: ReviewableAttempt[] = [
      { ...base, at: 1, kind: 'week-test', dateISO: '2026-10-17', reviewIds: ['a', 'b'] },
      { ...base, at: 2, kind: 'full-mock', dateISO: '2026-10-17', reviewIds: ['m'] },
      { ...base, at: 3, kind: 'week-test', dateISO: '2026-10-17', reviewIds: ['b', 'c'] },
      { ...base, at: 4, kind: 'week-test', dateISO: '2026-10-10', reviewIds: ['old'] },
      { ...base, at: 5, kind: 'week-test' }, // legacy record: no ids
    ];
    expect(dayReviewIds(attempts, '2026-10-17', ['week-test'])).toEqual(['a', 'b', 'c']);
    expect(dayReviewIds(attempts, '2026-10-17')).toEqual(['a', 'b', 'm', 'c']);
    expect(attemptDay(attempts[4]!)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
