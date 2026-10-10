import { describe, it, expect } from 'vitest';
import {
  lintNoteStructure,
  auditAllStructure,
  type StructureFlag,
} from '../validate';

/**
 * Explanation-structure lint — every rule gets a POSITIVE (fires) and a
 * NEGATIVE (stays quiet) fixture, plus a sanity check that the disk walk
 * returns findings in the stable shape the baseline report + CLI depend on.
 */
const flags = (note: Parameters<typeof lintNoteStructure>[0]): StructureFlag[] =>
  lintNoteStructure(note).map((f) => f.flag);

/** A full, well-formed MENT `### ` section with all seven bold sub-headings and >= 220 words. */
const filler = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const goodMentSection = [
  '### Counting multiples in a range',
  '**The idea in one sentence** count to the end minus count to just before the start.',
  '**Do it the slow way first** list them out and count by hand before any formula.',
  '**What the symbols mean** ⌊ ⌋ means round down and keep the whole-number part.',
  '**The formula** count = floor(b / k) minus floor((a - 1) / k).',
  '**Exam-level example** a fully worked APPSC-style question checked the slow way.',
  '**Common traps** off-by-one on the lower bound; forgetting to round down.',
  '**TL;DR** subtract the two counts and you are done.',
  filler(230),
].join('\n');

describe('structure — rule 1: MENT', () => {
  it('THIN_RULE: fires on a bare rule (no ### section, has formula chars)', () => {
    expect(flags({ subjectCode: 'MENT', body: 'count = ⌊b ÷ k⌋ − ⌊(a−1) ÷ k⌋' })).toContain(
      'THIN_RULE',
    );
  });

  it('THIN_RULE: stays quiet with no formula chars and no section', () => {
    expect(flags({ subjectCode: 'MENT', body: 'just a sentence of prose, no symbols.' })).not.toContain(
      'THIN_RULE',
    );
  });

  it('MISSING_SUBHEADING: fires when a section lacks a required bold sub-heading', () => {
    const body = ['### Rule', '**The idea in one sentence** x.', filler(230)].join('\n');
    expect(flags({ subjectCode: 'MENT', body })).toContain('MISSING_SUBHEADING');
  });

  it('SHORT_SECTION: fires when a section is under 220 words', () => {
    const short = goodMentSection.replace(filler(230), filler(20));
    expect(flags({ subjectCode: 'MENT', body: short })).toContain('SHORT_SECTION');
  });

  it('clean MENT section raises none of the MENT flags', () => {
    const f = flags({ subjectCode: 'MENT', body: goodMentSection });
    expect(f).not.toContain('THIN_RULE');
    expect(f).not.toContain('MISSING_SUBHEADING');
    expect(f).not.toContain('SHORT_SECTION');
  });

  it('excludes items tagged mains', () => {
    expect(
      flags({ subjectCode: 'MENT', body: 'count = ⌊b ÷ k⌋', tags: ['mains'] }),
    ).not.toContain('THIN_RULE');
  });
});

describe('structure — rule 2: theory notes', () => {
  const complete = [
    '**In one line** the empire rose and fell.',
    '**The story** cause, event, result.',
    '**TL;DR** three bullets.',
  ].join('\n');

  it('MISSING_STRUCTURE: fires when In one line / TL;DR / story-or-terms are absent', () => {
    expect(flags({ subjectCode: 'HIST', body: 'a plain paragraph of history.' })).toContain(
      'MISSING_STRUCTURE',
    );
  });

  it('stays quiet when all three required pieces are present', () => {
    expect(flags({ subjectCode: 'POL', body: complete })).not.toContain('MISSING_STRUCTURE');
  });

  it('Terms explained satisfies the "one of" requirement', () => {
    const body = '**In one line** x.\n**Terms explained** y.\n**TL;DR** z.';
    expect(flags({ subjectCode: 'ECON', body })).not.toContain('MISSING_STRUCTURE');
  });

  it('excludes items tagged mains', () => {
    expect(flags({ subjectCode: 'HIST', body: 'plain', tags: ['mains'] })).not.toContain(
      'MISSING_STRUCTURE',
    );
  });
});

describe('structure — rule 3: unexplained symbols', () => {
  it('UNEXPLAINED_SYMBOL: fires when a symbol has no "means" in the same section', () => {
    const body = '### Rule\nuse ∑ over the terms and ⌊x⌋ to round.';
    expect(flags({ subjectCode: 'MENT', body })).toContain('UNEXPLAINED_SYMBOL');
  });

  it('stays quiet when the symbol is explained with "means" in the same section', () => {
    const body = '### Rule\n∑ means add up every term in the list.';
    expect(flags({ subjectCode: 'SCI', body })).not.toContain('UNEXPLAINED_SYMBOL');
  });

  it('fires on the word "mod" used without explanation', () => {
    const body = '### Clocks\ntake the remainder with 12 mod arithmetic here.';
    expect(flags({ subjectCode: 'MENT', body })).toContain('UNEXPLAINED_SYMBOL');
  });
});

describe('structure — disk walk', () => {
  it('returns findings with the full location shape', () => {
    const findings = auditAllStructure();
    expect(Array.isArray(findings)).toBe(true);
    for (const f of findings.slice(0, 5)) {
      expect(typeof f.file).toBe('string');
      expect(typeof f.itemId).toBe('string');
      expect(typeof f.subjectCode).toBe('string');
      expect(typeof f.detail).toBe('string');
      expect([
        'THIN_RULE',
        'MISSING_SUBHEADING',
        'SHORT_SECTION',
        'MISSING_STRUCTURE',
        'UNEXPLAINED_SYMBOL',
      ]).toContain(f.flag);
    }
  });
});
