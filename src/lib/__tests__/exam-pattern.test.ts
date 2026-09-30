import { describe, it, expect } from 'vitest';
import {
  PAPER_I,
  PAPER_II,
  EXAM_PATTERNS,
  patternFor,
  NEGATIVE_MARK,
} from '../exam-pattern';

/**
 * The exam pattern is the single source of truth for the official Screening
 * papers. These assertions pin the VERBATIM notification numbers so a mock can
 * never silently drift from the real exam: Paper-I = 120 Q / 120 min / 120
 * marks in four 30-mark parts; Paper-II = 120 Q / 120 min / 120 marks with a
 * 60 / 30 / 30 split; wrong answers cost 1/3.
 */
describe('exam-pattern — official Screening pattern', () => {
  it('Paper-I is 120 Q / 120 min / 120 marks in four equal 30-mark parts', () => {
    expect(PAPER_I.totalQuestions).toBe(120);
    expect(PAPER_I.durationMin).toBe(120);
    expect(PAPER_I.totalMarks).toBe(120);
    expect(PAPER_I.sections).toHaveLength(4);
    for (const s of PAPER_I.sections) {
      expect(s.count).toBe(30);
      expect(s.marks).toBe(30);
    }
    // Section subjects map to the four Paper-I theory pools.
    expect(PAPER_I.sections.map((s) => s.subjectCode)).toEqual(['HIST', 'POL', 'ECON', 'GEO']);
    // Marks and questions sum to the paper total.
    expect(PAPER_I.sections.reduce((a, s) => a + s.count, 0)).toBe(120);
    expect(PAPER_I.sections.reduce((a, s) => a + s.marks, 0)).toBe(120);
  });

  it('Paper-II is 120 Q / 120 min / 120 marks split 60 / 30 / 30', () => {
    expect(PAPER_II.totalQuestions).toBe(120);
    expect(PAPER_II.durationMin).toBe(120);
    expect(PAPER_II.totalMarks).toBe(120);
    expect(PAPER_II.sections.map((s) => s.count)).toEqual([60, 30, 30]);
    expect(PAPER_II.sections.map((s) => s.subjectCode)).toEqual(['MENT', 'SCI', 'CA']);
    expect(PAPER_II.sections.reduce((a, s) => a + s.count, 0)).toBe(120);
  });

  it('applies the 1/3 negative mark and cites its source', () => {
    expect(NEGATIVE_MARK).toBeCloseTo(1 / 3, 10);
    expect(PAPER_I.negativeMark).toBeCloseTo(1 / 3, 10);
    expect(PAPER_II.negativeMark).toBeCloseTo(1 / 3, 10);
    expect(PAPER_I.sourceRef).toMatch(/Notification 07\/2026/);
    expect(PAPER_II.sourceRef).toMatch(/Notification 07\/2026/);
  });

  it('patternFor + EXAM_PATTERNS resolve both papers in order', () => {
    expect(patternFor('paper1')).toBe(PAPER_I);
    expect(patternFor('paper2')).toBe(PAPER_II);
    expect(EXAM_PATTERNS).toEqual([PAPER_I, PAPER_II]);
  });
});
