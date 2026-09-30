import { describe, it, expect } from 'vitest';
import {
  parseQuestion,
  parseStatementQuestion,
  parseMatchQuestion,
} from '../question-format';

/**
 * Pure question-stem parser: splitting run-on STATEMENT-BASED and MATCH-THE-
 * FOLLOWING stems into readable structure, being robust to marker variants and
 * space-separated (no-newline) stems, and degrading gracefully when a stem is
 * ordinary (→ plain) or a match cannot be paired (→ separate-line fallback).
 */
describe('parseStatementQuestion', () => {
  it('splits intro / statements / prompt for a 4-statement stem', () => {
    const stem =
      'Consider the following statements about the Harappan economy:\n' +
      '1. Wheat and barley were the principal food crops.\n' +
      '2. Trade was carried on with the Persian Gulf.\n' +
      '3. Lapis lazuli was imported from Afghanistan.\n' +
      '4. Iron tools were in everyday use.\n' +
      'Which of the statements are correct?';
    const q = parseStatementQuestion(stem)!;
    expect(q).not.toBeNull();
    expect(q.kind).toBe('statements');
    expect(q.intro).toBe('Consider the following statements about the Harappan economy:');
    expect(q.statements).toHaveLength(4);
    expect(q.statements[0]).toBe('Wheat and barley were the principal food crops.');
    expect(q.statements[3]).toBe('Iron tools were in everyday use.');
    expect(q.prompt).toBe('Which of the statements are correct?');
  });

  it('handles 2 statements (minimum)', () => {
    const q = parseStatementQuestion(
      'Consider the following:\n1. First.\n2. Second.\nWhich is correct?',
    )!;
    expect(q.statements).toHaveLength(2);
    expect(q.prompt).toBe('Which is correct?');
  });

  it('handles 5 statements', () => {
    const q = parseStatementQuestion(
      'Statements follow:\n1. A\n2. B\n3. C\n4. D\n5. E\nHow many of the above are correct?',
    )!;
    expect(q.statements).toHaveLength(5);
    expect(q.statements[4]).toBe('E');
    expect(q.prompt).toBe('How many of the above are correct?');
  });

  it('parses space-separated statements with no newlines', () => {
    const q = parseStatementQuestion(
      'Consider the following statements: 1. Alpha is true. 2. Beta is false. 3. Gamma is maybe. Which of the statements are correct?',
    )!;
    expect(q.intro).toBe('Consider the following statements:');
    expect(q.statements).toEqual(['Alpha is true.', 'Beta is false.', 'Gamma is maybe.']);
    expect(q.prompt).toBe('Which of the statements are correct?');
  });

  it('is robust to "1)" markers', () => {
    const q = parseStatementQuestion(
      'Consider the following:\n1) First point\n2) Second point\nWhich of the above is correct?',
    )!;
    expect(q.statements).toEqual(['First point', 'Second point']);
  });

  it('is robust to "(1)" markers', () => {
    const q = parseStatementQuestion(
      'Consider the following:\n(1) First point\n(2) Second point\nWhich of the above is correct?',
    )!;
    expect(q.statements).toEqual(['First point', 'Second point']);
  });

  it('is robust to roman "i." markers', () => {
    const q = parseStatementQuestion(
      'Arrange the following:\ni. Earliest\nii. Middle\niii. Latest\nWhich order is correct?',
    )!;
    expect(q.statements).toEqual(['Earliest', 'Middle', 'Latest']);
  });

  it('returns null for an ordinary single-line question', () => {
    expect(
      parseStatementQuestion('The Great Bath has been found at which site?'),
    ).toBeNull();
  });

  it('does not treat a stray number in prose as a statement list', () => {
    expect(
      parseStatementQuestion('In 1921, which site was first excavated by Daya Ram Sahni?'),
    ).toBeNull();
  });

  it('requires an intro lead-in (no orphan lists)', () => {
    expect(parseStatementQuestion('1. Alpha 2. Beta')).toBeNull();
  });

  it('leaves the prompt null when none is present', () => {
    const q = parseStatementQuestion('Facts:\n1. Alpha\n2. Beta')!;
    expect(q.statements).toEqual(['Alpha', 'Beta']);
    expect(q.prompt).toBeNull();
  });
});

describe('parseMatchQuestion', () => {
  it('parses the separated List-I / List-II form into aligned rows + labels', () => {
    const stem =
      'Match the site (List-I) with its signature find (List-II) and choose the correct answer:\n' +
      'List-I: (1) Mohenjo-daro (2) Lothal (3) Kalibangan (4) Dholavira\n' +
      'List-II: (i) Tidal dockyard (ii) Great Bath (iii) Cascading stone reservoirs (iv) Ploughed field';
    const q = parseMatchQuestion(stem)!;
    expect(q).not.toBeNull();
    expect(q.kind).toBe('match');
    expect(q.leftLabel).toBe('Site');
    expect(q.rightLabel).toBe('Signature find');
    expect(q.rows).toHaveLength(4);
    expect(q.rows[0]).toEqual({ left: '1. Mohenjo-daro', right: 'i. Tidal dockyard' });
    expect(q.rows[3]).toEqual({ left: '4. Dholavira', right: 'iv. Ploughed field' });
  });

  it('parses the interleaved "A. x 1. y" form (variant markers)', () => {
    const stem =
      'Match the following: List-I (Site) List-II (Finding) ' +
      'A. Lothal 1. Dockyard B. Kalibangan 2. Ploughed field C. Dholavira 3. Reservoirs';
    const q = parseMatchQuestion(stem)!;
    expect(q.leftLabel).toBe('Site');
    expect(q.rightLabel).toBe('Finding');
    expect(q.rows).toHaveLength(3);
    expect(q.rows[0]).toEqual({ left: 'A. Lothal', right: '1. Dockyard' });
    expect(q.rows[2]).toEqual({ left: 'C. Dholavira', right: '3. Reservoirs' });
  });

  it('defaults column labels to "List I" / "List II" when no caption exists', () => {
    const stem =
      'Match them:\nList-I: (1) Alpha (2) Beta\nList-II: (i) One (ii) Two';
    const q = parseMatchQuestion(stem)!;
    expect(q.leftLabel).toBe('List I');
    expect(q.rightLabel).toBe('List II');
    expect(q.rows).toHaveLength(2);
  });

  it('degrades to the separate-line fallback when the lists cannot be paired', () => {
    const stem = 'Match the columns: List-I: (1) OnlyOne List-II: (i) OnlyTwo';
    const q = parseMatchQuestion(stem)!;
    expect(q.kind).toBe('match');
    expect(q.rows).toHaveLength(0); // uncertain → no run-on blob, separate lines
    expect(q.leftRaw).toContain('OnlyOne');
    expect(q.rightRaw).toContain('OnlyTwo');
  });

  it('returns null for a non-match question', () => {
    expect(parseMatchQuestion('Which is the sole port town of the IVC?')).toBeNull();
  });
});

describe('parseQuestion (classifier)', () => {
  it('classifies a match stem as match (not statements, despite its numbers)', () => {
    const q = parseQuestion(
      'Match:\nList-I: (1) Alpha (2) Beta\nList-II: (i) One (ii) Two',
    );
    expect(q.kind).toBe('match');
  });

  it('classifies a statement stem as statements', () => {
    const q = parseQuestion('Consider:\n1. Alpha\n2. Beta\nWhich is correct?');
    expect(q.kind).toBe('statements');
  });

  it('classifies an ordinary question as plain', () => {
    const q = parseQuestion('Who founded the Mauryan empire?');
    expect(q.kind).toBe('plain');
  });
});
