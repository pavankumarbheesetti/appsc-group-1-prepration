import { describe, it, expect } from 'vitest';
import { dailyCap, flashcardDue, flashcardTodayLine, gradeFlashcard, lastReviewedAt, reviewedOnDay, todaysSession, startOfLocalDay } from '../due';
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

  it('a fresh deck introduces at most 15 new cards a day', () => {
    const d = flashcardDue(deck(45), {}, MORNING);
    expect(d.newWaiting).toBe(45);
    expect(d.due).toBe(15);
    expect(d.today).toBe(15);
    expect(flashcardTodayLine(d)).toBe('15 cards for today');
    expect(flashcardDue(deck(7), {}, MORNING).today).toBe(7);
  });

  it('does NOT refill after the day\u2019s session — and "due tomorrow" counts only real reviews', () => {
    const cards = deck(45);
    const sr: Record<string, SrCard> = {};
    for (const c of todaysSession(cards, sr, MORNING)) sr[c.id] = gradeFlashcard(sr[c.id], c.id, 'correct', MORNING);
    const later = MORNING + 2 * HOUR;
    const d = flashcardDue(cards, sr, later);
    expect(d.reviewedToday).toBe(15);
    expect(d.newToday).toBe(15);
    expect(d.today).toBe(0);
    expect(d.doneForToday).toBe(true);
    expect(d.dueTomorrow).toBe(0); // 30 unseen cards are NOT "due tomorrow"
    expect(todaysSession(cards, sr, later)).toHaveLength(0);
    expect(flashcardTodayLine(d)).toBe('Done for today');
    expect(todaysSession(cards, sr, later, true)).toHaveLength(20);
    expect(flashcardDue(cards, sr, MORNING + 24 * HOUR).today).toBe(15);
  });

  it('reviews come first; new cards only fill what is left of the cap', () => {
    const cards = deck(60);
    const sr: Record<string, SrCard> = {};
    const past = MORNING - 5 * 24 * HOUR;
    for (const c of cards.slice(0, 18)) sr[c.id] = { id: c.id, box: 2, due: past, lapses: 0 };
    const d = flashcardDue(cards, sr, MORNING);
    expect(d.scheduled).toBe(18);
    expect(d.cap).toBe(20);
    expect(d.today).toBe(20); // 18 reviews + 2 new
    const s = todaysSession(cards, sr, MORNING);
    expect(s.slice(0, 18).every((c) => sr[c.id])).toBe(true);
    expect(s.slice(18).every((c) => !sr[c.id])).toBe(true);
  });

  it('cap = max(20, ceil(backlog/5)) up to 40 weekdays / 60 Sundays', () => {
    const tue = new Date(2026, 9, 13, 10).getTime();
    const sun = new Date(2026, 9, 18, 10).getTime();
    expect(dailyCap(50, tue)).toBe(20);
    expect(dailyCap(150, tue)).toBe(30);
    expect(dailyCap(400, tue)).toBe(40);
    expect(dailyCap(400, sun)).toBe(60);
    expect(dailyCap(250, sun)).toBe(50);
  });

  it('a partly finished session only offers what is left', () => {
    const cards = deck(30);
    const sr: Record<string, SrCard> = {};
    for (const c of cards.slice(0, 8)) sr[c.id] = gradeFlashcard(undefined, c.id, 'correct', MORNING);
    expect(flashcardDue(cards, sr, MORNING + HOUR).today).toBe(7);
  });

  it('scheduled = reviewed-before cards that came due (Today\u2019s early-revise threshold)', () => {
    const cards = deck(3);
    const yesterday = MORNING - 24 * HOUR;
    const sr: Record<string, SrCard> = { c0: review(newCard('c0', yesterday), 'correct', yesterday - 2 * HOUR) };
    const d = flashcardDue(cards, sr, MORNING);
    expect(d.scheduled).toBe(0); // box 2 → due in 3 days
    expect(d.newWaiting).toBe(2);
  });
});

describe('flashcard backlog simulation (N5) — 30 days, typical learner', () => {
  /** Deterministic PRNG. */
  const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  it('the review backlog stays bounded (< 60) while topics keep adding cards', () => {
    const rand = rng(7);
    const all: Flashcard[] = [];
    const sr: Record<string, SrCard> = {};
    let topic = 0;
    const start = new Date(2026, 9, 10, 0, 0, 0).getTime();
    const backlogs: number[] = [];
    const leftovers: number[] = [];
    for (let day = 0; day < 30; day += 1) {
      const morning = new Date(2026, 9, 10 + day, 9, 0, 0).getTime();
      expect(morning).toBeGreaterThan(start - 1);
      // ~1.5 topics a day (13 cards each): 2 on odd days, 1 on even days.
      for (let t = 0; t < (day % 2 ? 2 : 1); t += 1, topic += 1)
        for (let k = 0; k < 13; k += 1) all.push({ id: `t${topic}c${k}`, front: 'F', back: 'B', source: 'card', subtopicId: `t${topic}` });
      const before = flashcardDue(all, sr, morning);
      backlogs.push(before.scheduled);
      // The learner finishes today's session; Again re-queues until Good (85% Good).
      const queue = todaysSession(all, sr, morning);
      let t = morning;
      while (queue.length > 0) {
        const c = queue.shift()!;
        t += 30_000;
        const g = rand() < 0.85 ? 'correct' : 'wrong';
        sr[c.id] = gradeFlashcard(sr[c.id], c.id, g, t);
        if (g === 'wrong') queue.push(c);
      }
      const after = flashcardDue(all, sr, t + 1000);
      expect(after.today).toBe(0);
      leftovers.push(after.scheduled);
    }
    expect(Math.max(...backlogs)).toBeLessThan(60);
    // Whatever is left after a session is a small carry-over, never a growing pile.
    expect(Math.max(...leftovers)).toBeLessThan(40);
    expect(leftovers.slice(-5).every((n) => n < 40)).toBe(true);
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
