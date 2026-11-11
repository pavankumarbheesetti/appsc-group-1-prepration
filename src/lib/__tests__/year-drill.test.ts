import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '../../content/timeline-types';
import { dueYearEvents, gapPhrase, maskYears, yearCardId, yearOptions } from '../year-drill';
import { mulberry32 } from '../timeline';

const ev = (id: string, year: number): TimelineEvent => ({
  id, title: id, date: { year }, era: 'company-rule', lane: 'north-india', kind: 'event', summary: 's', detail: 'd',
  subtopicIds: [], relatedMcqIds: [], apSpecific: false, importance: 1, source: 'x',
});

describe('yearOptions', () => {
  it('gives the right year plus the nearest other years, shuffled', () => {
    const opts = yearOptions(1764, [1757, 1764, 1765, 1766, 1799], mulberry32(1));
    expect(opts).toHaveLength(4);
    expect(new Set(opts).size).toBe(4);
    expect(opts).toContain(1764);
    expect([...opts].sort()).toEqual([1757, 1764, 1765, 1766]);
  });

  it('tops up with nearby years when the pool is small, never using year 0', () => {
    expect([...yearOptions(1757, [1757], mulberry32(2))].sort()).toEqual([1756, 1757, 1758, 1759]);
    const nearZero = yearOptions(1, [], mulberry32(3));
    expect(nearZero).not.toContain(0);
    expect(nearZero).toHaveLength(4);
  });
});

describe('maskYears / gapPhrase', () => {
  it('hides years in titles', () => {
    expect(maskYears('Charter Act of 1793 and 326 BCE')).toBe('Charter Act of ____ and ____ BCE');
    expect(maskYears('Treaty of Salbai')).toBe('Treaty of Salbai');
  });

  it('describes the gap between two years', () => {
    expect(gapPhrase(1757, 1764)).toBe('7 years after');
    expect(gapPhrase(1765, 1764)).toBe('1 year before');
    expect(gapPhrase(1765, 1765)).toBe('the same year as');
    expect(gapPhrase(-2, 2)).toBe('3 years after');
  });
});

describe('dueYearEvents', () => {
  it('splits events into due (oldest first) and never drilled', () => {
    const now = 1_000_000;
    const sr = {
      [yearCardId('a')]: { id: yearCardId('a'), box: 1, due: now - 10, lapses: 0 },
      [yearCardId('b')]: { id: yearCardId('b'), box: 2, due: now + 99_999_999, lapses: 0 },
      [yearCardId('c')]: { id: yearCardId('c'), box: 1, due: now - 50, lapses: 1 },
    };
    const { due, fresh } = dueYearEvents([ev('a', 1), ev('b', 2), ev('c', 3), ev('d', 4)], sr, now);
    expect(due.map((e) => e.id)).toEqual(['c', 'a']);
    expect(fresh.map((e) => e.id)).toEqual(['d']);
  });
});
