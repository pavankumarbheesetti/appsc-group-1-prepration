import { describe, it, expect } from 'vitest';
import {
  BOX_INTERVALS_DAYS,
  MAX_BOX,
  isDue,
  newCard,
  nextDueList,
  review,
  type SrCard,
} from '../spaced-repetition';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

describe('spaced-repetition', () => {
  it('creates a fresh card in box 1 due immediately', () => {
    const card = newCard('q1', NOW);
    expect(card).toEqual({ id: 'q1', box: 1, due: NOW, lapses: 0 });
    expect(isDue(card, NOW)).toBe(true);
  });

  it('promotes a box and schedules the documented interval on correct', () => {
    const c1 = newCard('q1', NOW); // box 1
    const c2 = review(c1, 'correct', NOW); // → box 2
    expect(c2.box).toBe(2);
    expect(c2.due).toBe(NOW + BOX_INTERVALS_DAYS[2] * DAY); // 3 days
    expect(c2.lapses).toBe(0);

    const c3 = review(c2, 'correct', NOW); // → box 3
    expect(c3.box).toBe(3);
    expect(c3.due).toBe(NOW + BOX_INTERVALS_DAYS[3] * DAY); // 7 days
  });

  it('caps promotion at MAX_BOX', () => {
    let card: SrCard = { id: 'q', box: MAX_BOX, due: NOW, lapses: 0 };
    card = review(card, 'correct', NOW);
    expect(card.box).toBe(MAX_BOX);
    expect(card.due).toBe(NOW + BOX_INTERVALS_DAYS[MAX_BOX] * DAY); // 35 days
  });

  it('resets to box 1, counts a lapse, and is due now on wrong', () => {
    const promoted: SrCard = { id: 'q', box: 4, due: NOW + 10 * DAY, lapses: 1 };
    const reset = review(promoted, 'wrong', NOW);
    expect(reset.box).toBe(1);
    expect(reset.lapses).toBe(2);
    expect(reset.due).toBe(NOW);
    expect(isDue(reset, NOW)).toBe(true);
  });

  it('does not mutate the input card', () => {
    const card = newCard('q', NOW);
    const copy = { ...card };
    review(card, 'correct', NOW);
    expect(card).toEqual(copy);
  });

  it('isDue is inclusive of the due instant', () => {
    const card: SrCard = { id: 'q', box: 2, due: NOW, lapses: 0 };
    expect(isDue(card, NOW - 1)).toBe(false);
    expect(isDue(card, NOW)).toBe(true);
    expect(isDue(card, NOW + 1)).toBe(true);
  });

  it('nextDueList returns only due cards, sorted by due ascending', () => {
    const cards: SrCard[] = [
      { id: 'later', box: 3, due: NOW + 5 * DAY, lapses: 0 }, // not due
      { id: 'overdue', box: 1, due: NOW - 2 * DAY, lapses: 0 }, // due
      { id: 'now', box: 1, due: NOW, lapses: 0 }, // due
    ];
    const due = nextDueList(cards, NOW);
    expect(due.map((c) => c.id)).toEqual(['overdue', 'now']);
  });
});
