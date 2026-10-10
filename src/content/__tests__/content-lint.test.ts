import { describe, it, expect } from 'vitest';
import { lintText, lintAllContent, type LintRule } from '../validate';

/**
 * Content-formatting lint — each rule gets a POSITIVE (fires) and a NEGATIVE
 * (stays quiet) case, plus a sanity check that the disk walk returns findings
 * in the stable shape the baseline report + CLI depend on.
 */
const rules = (text: string): LintRule[] => lintText(text).map((f) => f.rule);

describe('lint — jargon tokens', () => {
  it('flags textbook shorthand', () => {
    expect(rules('co-prime iff HCF = 1')).toContain('jargon');
    expect(rules('A ⇔ B')).toContain('jargon');
    expect(rules('x > 0 w.r.t. y')).toContain('jargon');
    expect(rules('choose n s.t. n is prime')).toContain('jargon');
  });

  it('does not flag ordinary prose (no false positive on "diff")', () => {
    expect(rules('the difference is small')).not.toContain('jargon');
    expect(rules('if and only if, spelled out')).not.toContain('jargon');
  });
});

describe('lint — bare carets', () => {
  it('flags an exponent written without braces', () => {
    expect(rules('2^80 trailing zeros')).toContain('bare-caret');
    expect(rules('10^-4 is small')).toContain('bare-caret');
  });

  it('does not flag a braced exponent', () => {
    expect(rules('p^{a+1} is fine')).not.toContain('bare-caret');
  });
});

describe('lint — table shape', () => {
  it('flags a separator / row whose cell count differs from the header', () => {
    const bad = ['| Symbol | Members | Note |', '|---|---|---|---|', '| N | 1,2,3 |'].join('\n');
    const hits = lintText(bad).filter((f) => f.rule === 'table-shape');
    // One for the 4-col separator, one for the 2-col row.
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('does not flag a well-formed table', () => {
    const good = ['| A | B |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |'].join('\n');
    expect(rules(good)).not.toContain('table-shape');
  });
});

describe('lint — obvious typos', () => {
  it('flags misspellings (case-insensitive)', () => {
    expect(rules('this occured untill now')).toContain('typo');
    expect(rules('Teh answer')).toContain('typo');
  });

  it('does not flag correct spelling', () => {
    expect(rules('this occurred until now and received')).not.toContain('typo');
  });
});

describe('lint — disk walk', () => {
  it('returns findings with the full location shape', () => {
    const findings = lintAllContent();
    expect(Array.isArray(findings)).toBe(true);
    for (const f of findings.slice(0, 5)) {
      expect(typeof f.file).toBe('string');
      expect(typeof f.itemId).toBe('string');
      expect(typeof f.field).toBe('string');
      expect(typeof f.snippet).toBe('string');
      expect(['jargon', 'bare-caret', 'table-shape', 'typo']).toContain(f.rule);
    }
  });
});
