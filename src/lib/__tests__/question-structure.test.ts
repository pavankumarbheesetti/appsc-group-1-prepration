import { describe, expect, it } from 'vitest';
import {
  classifyStem,
  extractAR,
  extractMatch,
  extractStatements,
  maxStatementRef,
  stemPlainText,
  structuredProblems,
} from '../question-structure';

describe('extractMatch', () => {
  it('reads inline lists keyed by the option codes (initials + decimals stay intact)', () => {
    const r = extractMatch(
      'Match List-I (post) with List-II (2026 incumbent):\n' +
        'List-I: A) Vice-President  B) Chief Election Commissioner  C) RBI Governor  D) ECLGS 5.0 desk\n' +
        'List-II: 1) Om Birla  2) C. P. Radhakrishnan  3) Sanjay Malhotra  4) Gyanesh Kumar',
      ['A-2, B-4, C-3, D-1', 'A-1, B-4, C-3, D-2', 'A-2, B-3, C-4, D-1', 'A-4, B-2, C-3, D-1'],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.question).toBe('Match List-I (post) with List-II (2026 incumbent):');
    expect(r.value.leftTitle).toBe('List-I (post)');
    expect(r.value.rightTitle).toBe('List-II (2026 incumbent)');
    expect(r.value.left.map((e) => e.text)).toEqual([
      'Vice-President',
      'Chief Election Commissioner',
      'RBI Governor',
      'ECLGS 5.0 desk',
    ]);
    expect(r.value.right[1]).toEqual({ key: '2', text: 'C. P. Radhakrishnan' });
    expect(r.options).toBeUndefined();
  });

  it('normalises 1/i keys to A/1 and rewrites the options', () => {
    const r = extractMatch(
      'Match the author (List-I) with the work (List-II):\nList-I: (1) Megasthenes (2) Nagasena\nList-II: (i) Milinda Panha (ii) Indica',
      ['1-ii, 2-i', '1-i, 2-ii'],
    );
    expect(r.ok && r.options).toEqual(['A-2, B-1', 'A-1, B-2']);
    expect(r.ok && r.value.left[0]).toEqual({ key: 'A', text: 'Megasthenes' });
  });

  it('reads a pipe-table match stem and keeps a non-generic trailing prompt', () => {
    const r = extractMatch(
      'Match List I with List II:\n\n| List I (Ruler) | List II (Work) |\n|---|---|\n| A. X | 1. P |\n| B. Y | 2. Q |\nPick the odd pair:',
      ['A-1, B-2', 'A-2, B-1'],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.leftTitle).toBe('List-I (Ruler)');
    expect(r.question).toBe('Match List I with List II:\nPick the odd pair:');
  });

  it('reports an INCOMPLETE list when options reference a missing key', () => {
    const r = extractMatch('Match:\nList-I\nA. a\nB. b\nList-II\n1. x\n2. y', ['A-3, B-1', 'A-1, B-2']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^INCOMPLETE/);
  });
});

describe('extractStatements / extractAR', () => {
  it('splits lead-in, statements and closing prompt', () => {
    const r = extractStatements(
      'Consider the following statements:\n1. ECLGS 5.0 was approved.\n2. Second.\nWhich of the statements is/are correct?',
      ['1 only', '2 only', 'Both 1 and 2', 'Neither 1 nor 2'],
    );
    expect(r.ok && r.value).toEqual(['ECLGS 5.0 was approved.', 'Second.']);
    expect(r.ok && r.question).toBe('Consider the following statements:\nWhich of the statements is/are correct?');
  });

  it('flags options that reference a statement that does not exist', () => {
    const r = extractStatements('Consider:\n1. a\n2. b\nWhich?', ['1 and 3 only', '2 only', '1 only', 'None']);
    expect(r.ok).toBe(false);
  });

  it('extracts assertion and reason with a default lead-in', () => {
    const r = extractAR('Assertion (A): A holds.\nReason (R): R holds.\nChoose the correct option:');
    expect(r.ok && r.value).toEqual({ assertion: 'A holds.', reason: 'R holds.' });
    expect(r.ok && r.question).toBe('Consider the following Assertion (A) and Reason (R):\nChoose the correct option:');
  });

  it('classifies stems and counts statement references', () => {
    expect(classifyStem('Assertion (A): x\nReason (R): y')).toBe('ar');
    expect(classifyStem('Consider:\n1. a\n2. b')).toBe('statements');
    expect(classifyStem('Who wrote Indica?')).toBeNull();
    expect(maxStatementRef(['1, 2 and 4 only', 'Both 1 and 2', '25%'])).toBe(4);
  });
});

describe('structuredProblems / stemPlainText', () => {
  it('reports option keys missing from the lists', () => {
    const problems = structuredProblems({
      question: 'Match:',
      options: ['A-3, B-1', 'A-1, B-2'],
      match: {
        leftTitle: 'List-I',
        rightTitle: 'List-II',
        left: [
          { key: 'A', text: 'a' },
          { key: 'B', text: 'b' },
        ],
        right: [
          { key: '1', text: 'x' },
          { key: '2', text: 'y' },
        ],
      },
    });
    expect(problems).toContain('option references missing List-II key 3');
  });

  it('rebuilds the full stem text for search / flashcards', () => {
    expect(
      stemPlainText({ question: 'Consider:\nWhich?', options: [], statements: ['a', 'b'] }),
    ).toBe('Consider:\n1. a\n2. b\nWhich?');
  });
});
