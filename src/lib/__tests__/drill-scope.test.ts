import { describe, it, expect } from 'vitest';
import { subtopicDrillOptions, type SubtopicLike } from '../drill-scope';

/**
 * The Subtopic selector on the Drill page must offer ONLY subtopics that have
 * MCQs, each labelled `Name (N)` with its real MCQ count, in the given
 * (taxonomy) order. These tests pin that pure derivation.
 */
describe('subtopicDrillOptions', () => {
  const subtopics: SubtopicLike[] = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Bravo' },
    { id: 'c', name: 'Charlie' },
    { id: 'd', name: 'Delta' },
  ];

  it('keeps only subtopics with MCQs and labels them "Name (N)"', () => {
    const counts: Record<string, number> = { a: 5, b: 0, c: 12, d: 0 };
    const opts = subtopicDrillOptions(subtopics, (id) => counts[id] ?? 0);
    expect(opts).toEqual([
      { id: 'a', name: 'Alpha', mcqCount: 5, label: 'Alpha (5)' },
      { id: 'c', name: 'Charlie', mcqCount: 12, label: 'Charlie (12)' },
    ]);
  });

  it('preserves input order (taxonomy order)', () => {
    const counts: Record<string, number> = { a: 1, b: 2, c: 3, d: 4 };
    expect(subtopicDrillOptions(subtopics, (id) => counts[id] ?? 0).map((o) => o.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('returns [] when no subtopic has MCQs', () => {
    expect(subtopicDrillOptions(subtopics, () => 0)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = subtopics.slice();
    subtopicDrillOptions(input, () => 1);
    expect(input).toEqual(subtopics);
  });
});
