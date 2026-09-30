import { describe, it, expect } from 'vitest';
import {
  GRADUATION_THRESHOLD,
  activeEntries,
  isActive,
  recordAnswer,
  selectReviewItems,
  type NotebookEntry,
} from '../notebook';
import type { MCQItem } from '../../content/types';

const NOW = 1_000;

/** Minimal valid MCQ item for selection tests. */
function mcq(id: string): MCQItem {
  return { id, subjectCode: 'HIST', tier: 1, question: `${id}?`, options: ['a', 'b'], answerIndex: 0 };
}

describe('notebook', () => {
  it('adds a fresh entry on a wrong answer for an untracked question', () => {
    const entry = recordAnswer('q1', undefined, 'wrong', NOW);
    expect(entry).toEqual({ id: 'q1', addedAt: NOW, consecutiveCorrect: 0, graduated: false });
    expect(entry && isActive(entry)).toBe(true);
  });

  it('ignores a correct answer for an untracked question', () => {
    expect(recordAnswer('q1', undefined, 'correct', NOW)).toBeUndefined();
  });

  it('graduates after exactly 2 consecutive corrects', () => {
    let entry = recordAnswer('q1', undefined, 'wrong', NOW);
    expect(entry?.graduated).toBe(false);

    entry = recordAnswer('q1', entry, 'correct', NOW + 1); // streak 1
    expect(entry?.consecutiveCorrect).toBe(1);
    expect(entry?.graduated).toBe(false);

    entry = recordAnswer('q1', entry, 'correct', NOW + 2); // streak 2 → graduate
    expect(entry?.consecutiveCorrect).toBe(GRADUATION_THRESHOLD);
    expect(entry?.graduated).toBe(true);
    expect(entry && isActive(entry)).toBe(false);
  });

  it('resets the streak on a wrong answer and preserves addedAt', () => {
    let entry = recordAnswer('q1', undefined, 'wrong', NOW);
    entry = recordAnswer('q1', entry, 'correct', NOW + 1); // streak 1
    expect(entry?.consecutiveCorrect).toBe(1);

    entry = recordAnswer('q1', entry, 'wrong', NOW + 2); // reset
    expect(entry?.consecutiveCorrect).toBe(0);
    expect(entry?.graduated).toBe(false);
    expect(entry?.addedAt).toBe(NOW); // original add time kept
  });

  it('needs two IN A ROW: wrong between corrects prevents graduation', () => {
    let entry = recordAnswer('q1', undefined, 'wrong', NOW);
    entry = recordAnswer('q1', entry, 'correct', NOW + 1); // streak 1
    entry = recordAnswer('q1', entry, 'wrong', NOW + 2); // reset to 0
    entry = recordAnswer('q1', entry, 'correct', NOW + 3); // streak 1 again
    expect(entry?.graduated).toBe(false);
  });

  it('activeEntries returns only non-graduated entries', () => {
    const map: Record<string, NotebookEntry> = {
      a: { id: 'a', addedAt: NOW, consecutiveCorrect: 0, graduated: false },
      b: { id: 'b', addedAt: NOW, consecutiveCorrect: 2, graduated: true },
      c: { id: 'c', addedAt: NOW, consecutiveCorrect: 1, graduated: false },
    };
    expect(activeEntries(map).map((e) => e.id).sort()).toEqual(['a', 'c']);
  });
});

describe('notebook review selection', () => {
  it('selects all active entries regardless of SR schedule, skipping graduated ones', () => {
    const map: Record<string, NotebookEntry> = {
      a: { id: 'a', addedAt: NOW, consecutiveCorrect: 1, graduated: false },
      b: { id: 'b', addedAt: NOW, consecutiveCorrect: 2, graduated: true },
    };
    const byId = new Map([['a', mcq('a')], ['b', mcq('b')]]);
    // Note: selectReviewItems takes NO SR/`now` argument — selection is driven
    // purely by notebook activeness, so due timing cannot hide an active item.
    expect(selectReviewItems(map, byId).map((i) => i.id)).toEqual(['a']);
  });

  it('skips active entries that have no matching MCQ', () => {
    const map: Record<string, NotebookEntry> = {
      a: { id: 'a', addedAt: NOW, consecutiveCorrect: 0, graduated: false },
      gone: { id: 'gone', addedAt: NOW, consecutiveCorrect: 0, graduated: false },
    };
    const byId = new Map([['a', mcq('a')]]);
    expect(selectReviewItems(map, byId).map((i) => i.id)).toEqual(['a']);
  });

  it('an active entry graduates via two corrects across passes in ONE session (no SR dependency)', () => {
    const byId = new Map([['a', mcq('a')]]);

    // First wrong answer adds the entry to the notebook.
    let entry = recordAnswer('a', undefined, 'wrong', NOW);
    let map: Record<string, NotebookEntry> = { a: entry! };

    // Pass 1: the item is selectable because it is active.
    expect(selectReviewItems(map, byId).map((i) => i.id)).toEqual(['a']);
    entry = recordAnswer('a', map.a, 'correct', NOW + 1); // streak 1, still active
    map = { a: entry! };
    expect(entry?.graduated).toBe(false);

    // Pass 2 in the SAME session: still selectable purely by activeness — an
    // SR-due filter would have hidden it here after the first correct.
    expect(selectReviewItems(map, byId).map((i) => i.id)).toEqual(['a']);
    entry = recordAnswer('a', map.a, 'correct', NOW + 2); // streak 2 → graduate
    map = { a: entry! };
    expect(entry?.consecutiveCorrect).toBe(GRADUATION_THRESHOLD);
    expect(entry?.graduated).toBe(true);

    // Once graduated it drops out of the review selection.
    expect(selectReviewItems(map, byId)).toEqual([]);
  });
});
