import { describe, it, expect } from 'vitest';
import {
  buildClozeCards,
  buildDeck,
  buildFlashcards,
  buildCuratedDeck,
  selectDue,
  selectSession,
  DAILY_SESSION_CAP,
  CLOZE_CARDS_PER_NOTE,
  CLOZE_BLANK,
  type Flashcard,
} from '../flashcards';
import { newCard, review, type SrCard } from '../spaced-repetition';
import type { CardItem, MCQItem, NoteItem } from '../../content/types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

/** Minimal note factory. */
function note(id: string, title: string, keyPoints?: string[]): NoteItem {
  return { id, subjectCode: 'HIST', title, body: '...', keyPoints };
}

/** Minimal curated-card factory. */
function curated(id: string, subtopicId: string): CardItem {
  return { id, subjectCode: 'HIST', subtopicId, front: `Q ${id}?`, back: `A ${id}`, verified: true };
}

describe('flashcards — buildCuratedDeck (content kind `cards`)', () => {
  it('maps each curated CardItem 1:1 to a question→answer Flashcard', () => {
    const deck = buildCuratedDeck([curated('c1', 'sub-a'), curated('c2', 'sub-b')]);
    expect(deck).toEqual([
      { id: 'c1', front: 'Q c1?', back: 'A c1', source: 'card', subtopicId: 'sub-a' },
      { id: 'c2', front: 'Q c2?', back: 'A c2', source: 'card', subtopicId: 'sub-b' },
    ]);
  });

  it('is empty for no curated cards', () => {
    expect(buildCuratedDeck([])).toEqual([]);
  });
});

describe('flashcards — selectSession (daily cap + weakest-first)', () => {
  const NOW = 1_000_000_000_000;
  // 25 fresh curated cards → all due, but a session caps at 20.
  const deck: Flashcard[] = buildCuratedDeck(
    Array.from({ length: 25 }, (_, i) => curated(`c${i}`, 'sub')),
  );

  it('caps the session at DAILY_SESSION_CAP (min(due, 20))', () => {
    expect(DAILY_SESSION_CAP).toBe(20);
    const session = selectSession(deck, {}, NOW);
    expect(session.length).toBe(20);
    // Never more than what is due.
    const dueCount = selectDue(deck, {}, NOW).length;
    expect(session.length).toBe(Math.min(dueCount, 20));
  });

  it('returns exactly the due count when fewer than the cap are due', () => {
    const small = buildCuratedDeck([curated('a', 's'), curated('b', 's')]);
    expect(selectSession(small, {}, NOW).length).toBe(2);
  });

  it('orders weakest (lowest Leitner box) first', () => {
    const small = buildCuratedDeck([curated('c0', 's'), curated('c1', 's'), curated('c2', 's')]);
    // Promote c0 to box 2 but keep it due (past its interval); c1/c2 stay box 1.
    const promoted = review(newCard('c0', NOW), 'correct', NOW);
    const srMap: Record<string, SrCard> = { c0: { ...promoted, due: NOW } };
    const session = selectSession(small, srMap, NOW);
    expect(session.length).toBe(3);
    const posC0 = session.findIndex((c) => c.id === 'c0');
    const posC1 = session.findIndex((c) => c.id === 'c1');
    // c1 (box 1, weaker) must come before the promoted c0 (box 2), which is last.
    expect(posC1).toBeLessThan(posC0);
    expect(session[session.length - 1]!.id).toBe('c0');
  });
});

describe('flashcards — buildFlashcards', () => {
  it('derives one card per key point with stable ids and title-based cues', () => {
    const cards = buildFlashcards([
      note('n1', 'Chronology', ['Point A', 'Point B']),
      note('n2', 'Discovery', ['Only point']),
    ]);
    expect(cards).toHaveLength(3);
    expect(cards[0]).toEqual({
      id: 'fc:n1#0',
      front: 'Chronology — key point 1',
      back: 'Point A',
      source: 'note',
    });
    expect(cards[1]?.id).toBe('fc:n1#1');
    expect(cards[1]?.back).toBe('Point B');
    expect(cards[2]?.id).toBe('fc:n2#0');
  });

  it('emits nothing for notes without key points', () => {
    expect(buildFlashcards([note('n1', 'Empty')])).toEqual([]);
    expect(buildFlashcards([note('n1', 'Empty', [])])).toEqual([]);
  });

  it('optionally derives cards from MCQs (front=question, back=answer + explanation)', () => {
    const mcq: MCQItem = {
      id: 'q1',
      subjectCode: 'HIST',
      tier: 1,
      question: 'Who excavated Harappa?',
      options: ['Sahni', 'Banerjee'],
      answerIndex: 0,
      explanation: 'Daya Ram Sahni, 1920.',
    };
    const cards = buildFlashcards([], [mcq]);
    expect(cards).toEqual([
      { id: 'fc:q1', front: 'Who excavated Harappa?', back: 'Sahni — Daya Ram Sahni, 1920.', source: 'mcq' },
    ]);
  });

  it('is deterministic: notes first (in order), then MCQs', () => {
    const mcq: MCQItem = {
      id: 'q1', subjectCode: 'HIST', tier: 1, question: 'Q?', options: ['a', 'b'], answerIndex: 1,
    };
    const cards = buildFlashcards([note('n1', 'T', ['p1'])], [mcq]);
    expect(cards.map((c) => c.id)).toEqual(['fc:n1#0', 'fc:q1']);
    expect(cards[1]?.back).toBe('b'); // no explanation → answer only
  });
});

describe('flashcards — selectDue (reuses spaced-repetition)', () => {
  const deck: Flashcard[] = buildFlashcards([note('n1', 'T', ['a', 'b', 'c'])]);

  it('treats unseen cards as new and due immediately', () => {
    const due = selectDue(deck, {}, NOW);
    expect(due.map((c) => c.id)).toEqual(['fc:n1#0', 'fc:n1#1', 'fc:n1#2']);
  });

  it('excludes cards scheduled into the future via review()', () => {
    // Mark the first card correct → promoted to box 2, due in 3 days.
    const srMap: Record<string, SrCard> = {
      'fc:n1#0': review(newCard('fc:n1#0', NOW), 'correct', NOW),
    };
    const due = selectDue(deck, srMap, NOW);
    expect(due.map((c) => c.id)).toEqual(['fc:n1#1', 'fc:n1#2']); // #0 not due yet

    // …but it becomes due again once its interval elapses.
    const later = selectDue(deck, srMap, NOW + 3 * DAY);
    expect(later.map((c) => c.id)).toContain('fc:n1#0');
  });

  it('a wrong review keeps the card due now', () => {
    const srMap: Record<string, SrCard> = {
      'fc:n1#0': review(newCard('fc:n1#0', NOW), 'wrong', NOW),
    };
    expect(selectDue(deck, srMap, NOW).map((c) => c.id)).toContain('fc:n1#0');
  });
});

describe('flashcards — buildClozeCards (active recall)', () => {
  it('masks the longest salient token (proper noun) with a blank', () => {
    const cards = buildClozeCards([
      note('n1', 'Peers', ['One of the first civilizations alongside Mesopotamia and Egypt.']),
    ]);
    expect(cards).toHaveLength(1);
    const c = cards[0]!;
    // "Mesopotamia" (11) is the longest capitalized token → chosen over "Egypt"/"One".
    expect(c.front).toBe(`One of the first civilizations alongside ${CLOZE_BLANK} and Egypt.`);
    expect(c.back).toBe(
      'Mesopotamia — One of the first civilizations alongside Mesopotamia and Egypt.',
    );
    expect(c.source).toBe('cloze');
    expect(c.id).toBe('cz:n1#0');
  });

  it('treats a number/date as a maskable salient token', () => {
    const cards = buildClozeCards([note('n1', 'Announce', ['john marshall announced it in 1924.'])]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.front).toBe(`john marshall announced it in ${CLOZE_BLANK}.`);
    expect(cards[0]!.back.startsWith('1924 — ')).toBe(true);
  });

  it('skips a point with no suitable token (all-lowercase, no numbers)', () => {
    const cards = buildClozeCards([
      note('n1', 'Generic', ['this was an early urban culture with planned drainage.']),
    ]);
    expect(cards).toEqual([]);
  });

  it('is deterministic across repeated builds', () => {
    const n = note('n1', 'T', [
      'Flourished c. 3300 BCE across the Indus valley.',
      'Excavated first at Harappa by Daya Ram Sahni.',
    ]);
    expect(buildClozeCards([n])).toEqual(buildClozeCards([n]));
  });

  it('caps cloze cards per note, counting only points that yield a token', () => {
    const many = note('n1', 'Many', [
      'this generic lowercase point has no salient token.', // skipped
      'Harappa was excavated first.', // cz:n1#1
      'Mohenjo-daro sits on the Indus.', // cz:n1#2
      'Lothal had a dockyard.', // beyond the cap
    ]);
    const cards = buildClozeCards([many]);
    expect(cards.length).toBe(CLOZE_CARDS_PER_NOTE);
    expect(cards.map((c) => c.id)).toEqual(['cz:n1#1', 'cz:n1#2']);
    expect(cards.every((c) => c.source === 'cloze')).toBe(true);
  });

  it('emits unique, stable ids indexed by key-point position', () => {
    const cards = buildClozeCards([
      note('n1', 'A', ['Mesopotamia was a peer.', 'Egypt was another peer.']),
      note('n2', 'B', ['Harappa was excavated first.']),
    ]);
    const ids = cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    expect(ids).toEqual(['cz:n1#0', 'cz:n1#1', 'cz:n2#0']);
  });

  it('emits nothing for notes without key points', () => {
    expect(buildClozeCards([note('n1', 'Empty')])).toEqual([]);
    expect(buildClozeCards([note('n1', 'Empty', [])])).toEqual([]);
  });
});

describe('flashcards — buildDeck (key-point + cloze + mcq)', () => {
  it('combines key-point cards, then cloze cards, then MCQ cards', () => {
    const mcq: MCQItem = {
      id: 'q1', subjectCode: 'HIST', tier: 1, question: 'Q?', options: ['a', 'b'], answerIndex: 0,
    };
    const notes = [note('n1', 'T', ['Harappa was excavated first.'])];
    const deck = buildDeck(notes, [mcq]);
    expect(deck.map((c) => c.source)).toEqual(['note', 'mcq', 'cloze']);
    expect(deck.map((c) => c.id)).toEqual(['fc:n1#0', 'fc:q1', 'cz:n1#0']);
  });

  it('key-point and cloze ids never collide (fc: vs cz: prefixes)', () => {
    const deck = buildDeck([note('n1', 'T', ['Mesopotamia was a peer.'])]);
    const ids = deck.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cloze cards are scheduled by the same SR as the rest of the deck', () => {
    const deck = buildDeck([note('n1', 'T', ['Harappa was excavated first in 1920.'])]);
    const cloze = deck.find((c) => c.source === 'cloze')!;
    // Freshly promoted → not due now, due again after its interval.
    const srMap: Record<string, SrCard> = {
      [cloze.id]: review(newCard(cloze.id, NOW), 'correct', NOW),
    };
    expect(selectDue(deck, srMap, NOW).map((c) => c.id)).not.toContain(cloze.id);
    expect(selectDue(deck, srMap, NOW + 3 * DAY).map((c) => c.id)).toContain(cloze.id);
  });
});
