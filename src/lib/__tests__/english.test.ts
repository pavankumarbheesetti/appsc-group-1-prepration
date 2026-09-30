import { describe, it, expect } from 'vitest';
import { checklistTally, filterByArea, countWords } from '../english';
import { grammarMCQs } from '../../content/english-qualifying';

describe('checklistTally', () => {
  it('counts ticked criteria and reports completion', () => {
    expect(checklistTally([true, false, true, false, false], 5)).toEqual({
      checked: 2,
      total: 5,
      pct: 40,
      complete: false,
    });
    expect(checklistTally([true, true, true], 3)).toEqual({
      checked: 3,
      total: 3,
      pct: 100,
      complete: true,
    });
  });

  it('treats an empty checklist as 0/0, not complete', () => {
    expect(checklistTally([], 0)).toEqual({ checked: 0, total: 0, pct: 0, complete: false });
  });

  it('is robust to a stale short/long checks array', () => {
    // Extra trailing true beyond `total` must not inflate the count.
    expect(checklistTally([true, true, true, true], 2).checked).toBe(2);
    // A short array counts the missing slots as unticked.
    expect(checklistTally([true], 3)).toEqual({ checked: 1, total: 3, pct: 33, complete: false });
  });
});

describe('filterByArea', () => {
  it('returns a copy of all items when no tag is given', () => {
    const all = filterByArea(grammarMCQs);
    expect(all.length).toBe(grammarMCQs.length);
    expect(all).not.toBe(grammarMCQs); // a copy, not the same reference
  });

  it('keeps only items tagged with the area', () => {
    const tenses = filterByArea(grammarMCQs, 'tenses');
    expect(tenses.length).toBeGreaterThan(0);
    expect(tenses.every((q) => q.tags?.includes('tenses'))).toBe(true);
  });

  it('returns an empty list for an unknown area', () => {
    expect(filterByArea(grammarMCQs, 'no-such-area')).toEqual([]);
  });
});

describe('countWords (re-exported)', () => {
  it('counts whitespace-delimited words', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('   ')).toBe(0);
  });
});
