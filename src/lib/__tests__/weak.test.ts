import { describe, it, expect } from 'vitest';
import { rankWeakAreas, type WeakSubtopicInput } from '../weak';
import type { ProgressEntry } from '../../state/store';

/**
 * Weak-area ranking tests — pure. Ranks ATTEMPTED subtopics weakest-first
 * (accuracy, then wrong count, then mastery) and separates NOT-STARTED gaps.
 */
const inputs: WeakSubtopicInput[] = [
  { subtopicId: 'a', name: 'Alpha', band: 'A', mcqIds: ['a1', 'a2', 'a3', 'a4'] },
  { subtopicId: 'b', name: 'Bravo', band: 'B', mcqIds: ['b1', 'b2', 'b3', 'b4'] },
  { subtopicId: 'c', name: 'Charlie', mcqIds: ['c1', 'c2'] },
];

function p(seen: number, correct: number, wrong: number): ProgressEntry {
  return { seen, correct, wrong };
}

describe('rankWeakAreas', () => {
  it('ranks attempted subtopics by ascending accuracy (weakest first)', () => {
    const progress: Record<string, ProgressEntry> = {
      // Alpha: 2/4 attempts correct → 50% accuracy.
      a1: p(1, 1, 0),
      a2: p(1, 0, 1),
      a3: p(1, 1, 0),
      a4: p(1, 0, 1),
      // Bravo: 1/4 attempts correct → 25% accuracy (weaker).
      b1: p(1, 0, 1),
      b2: p(1, 0, 1),
      b3: p(1, 1, 0),
      b4: p(1, 0, 1),
    };
    const { weak, gaps } = rankWeakAreas(inputs, progress);
    expect(weak.map((r) => r.subtopicId)).toEqual(['b', 'a']);
    // Charlie was never attempted → a gap, not a weak row.
    expect(gaps.map((r) => r.subtopicId)).toEqual(['c']);
  });

  it('computes real accuracy, wrong count, attempted and mastery', () => {
    const progress: Record<string, ProgressEntry> = {
      a1: p(2, 1, 1),
      a2: p(1, 0, 1),
    };
    const { weak } = rankWeakAreas(inputs, progress);
    const alpha = weak.find((r) => r.subtopicId === 'a')!;
    expect(alpha.attempted).toBe(2); // a1, a2 seen
    expect(alpha.seen).toBe(3); // 2 + 1 attempts
    expect(alpha.correct).toBe(1);
    expect(alpha.wrong).toBe(2);
    expect(alpha.accuracy).toBeCloseTo(1 / 3);
    expect(alpha.total).toBe(4);
    // Mastery = correct-once / total = 1 correct of 4 authored = 25%.
    expect(alpha.mastery).toBe(25);
  });

  it('breaks accuracy ties by higher wrong count', () => {
    const progress: Record<string, ProgressEntry> = {
      // Alpha & Bravo both 0% accuracy; Bravo has more wrong attempts.
      a1: p(1, 0, 1),
      b1: p(3, 0, 3),
    };
    const { weak } = rankWeakAreas(inputs, progress);
    expect(weak.map((r) => r.subtopicId)).toEqual(['b', 'a']);
  });

  it('surfaces weak question ids for the scoped "Drill these" action', () => {
    const progress: Record<string, ProgressEntry> = {
      a1: p(1, 0, 1), // wrong → weak
      a2: p(2, 2, 0), // mastered → not weak
      a3: p(1, 1, 0), // clean → not weak
    };
    const { weak } = rankWeakAreas(inputs, progress);
    const alpha = weak.find((r) => r.subtopicId === 'a')!;
    expect(alpha.wrongQuestionIds).toEqual(['a1']);
  });

  it('returns everything as gaps when nothing is attempted', () => {
    const { weak, gaps } = rankWeakAreas(inputs, {});
    expect(weak).toHaveLength(0);
    expect(gaps.map((r) => r.subtopicId)).toEqual(['a', 'b', 'c']);
  });
});
