import { describe, it, expect } from 'vitest';
import {
  grammarMCQs,
  readingComprehension,
  allRcQuestions,
  paperOverview,
  WRITING_FORMATS,
  GRAMMAR_AREAS,
} from '../english-qualifying';
import { MCQItemSchema } from '../types';

describe('english-qualifying — grammar MCQs', () => {
  it('has 30–40 questions with the expected id pattern', () => {
    expect(grammarMCQs.length).toBeGreaterThanOrEqual(30);
    expect(grammarMCQs.length).toBeLessThanOrEqual(40);
    for (const q of grammarMCQs) expect(q.id).toMatch(/^eng-gram-\d+$/);
  });

  it('every item has 4 options and an in-range answerIndex', () => {
    for (const q of grammarMCQs) {
      expect(q.options.length).toBe(4);
      expect(q.answerIndex).toBeGreaterThanOrEqual(0);
      expect(q.answerIndex).toBeLessThan(q.options.length);
    }
  });

  it('every item passes the runtime MCQItem schema (incl. the answerIndex refine)', () => {
    for (const q of grammarMCQs) {
      expect(MCQItemSchema.safeParse(q).success).toBe(true);
    }
  });

  it('has unique ids across grammar and reading questions', () => {
    const ids = [...grammarMCQs, ...allRcQuestions].map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses varied answer positions (not all the same index)', () => {
    expect(new Set(grammarMCQs.map((q) => q.answerIndex)).size).toBeGreaterThan(1);
  });

  it('tags every item with a known grammar area', () => {
    const known = new Set(GRAMMAR_AREAS.map((a) => a.tag));
    for (const q of grammarMCQs) {
      expect(q.tags && q.tags.length).toBeGreaterThan(0);
      expect(q.tags!.some((t) => known.has(t))).toBe(true);
    }
  });
});

describe('english-qualifying — reading comprehension', () => {
  it('has 1–2 passages, each with 4–5 questions and the id pattern', () => {
    expect(readingComprehension.length).toBeGreaterThanOrEqual(1);
    expect(readingComprehension.length).toBeLessThanOrEqual(2);
    for (const p of readingComprehension) {
      expect(p.questions.length).toBeGreaterThanOrEqual(4);
      expect(p.questions.length).toBeLessThanOrEqual(5);
      for (const q of p.questions) {
        expect(q.id).toMatch(/^eng-rc-\d+$/);
        expect(MCQItemSchema.safeParse(q).success).toBe(true);
      }
    }
  });

  it('flattens all RC questions in passage order', () => {
    expect(allRcQuestions.length).toBe(
      readingComprehension.reduce((n, p) => n + p.questions.length, 0),
    );
  });
});

describe('english-qualifying — paper overview', () => {
  it('question-type marks sum to the stated total (150) and it is qualifying', () => {
    const sum = paperOverview.questionTypes.reduce((n, q) => n + q.marks, 0);
    expect(sum).toBe(paperOverview.totalMarks);
    expect(paperOverview.totalMarks).toBe(150);
    expect(paperOverview.qualifying).toBe(true);
  });
});

describe('english-qualifying — writing formats', () => {
  it('has the seven writing formats, each with unique key + non-empty guidance', () => {
    const keys = WRITING_FORMATS.map((f) => f.key);
    expect(keys.length).toBe(7);
    expect(new Set(keys).size).toBe(7);
    for (const f of WRITING_FORMATS) {
      expect(f.structure.length).toBeGreaterThan(0);
      expect(f.techniques.length).toBeGreaterThan(0);
      expect(f.checklist.length).toBeGreaterThan(0);
      expect(f.model.trim().length).toBeGreaterThan(0);
    }
  });
});
