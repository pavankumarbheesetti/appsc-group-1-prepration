import { describe, expect, it } from 'vitest';
import {
  askedPapers,
  meanwhile,
  meanwhileWindow,
  nearestPeg,
  neighbours,
  relLabel,
  resolvePegs,
  seededShuffle,
  shortPaper,
  splitPaperTag,
  spread,
  yearsBetween,
} from '../chronology';
import type { TimelineEvent } from '../../content/timeline-types';

const ev = (id: string, year: number, extra: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id, title: id, date: { year }, kind: 'event', lane: 'andhra', summary: 's', detail: 'd',
  subtopicIds: [], relatedMcqIds: [], apSpecific: true, importance: 3, source: 'x', ...extra,
} as TimelineEvent);

describe('chronology helpers', () => {
  it('counts years across BCE/CE with no year zero', () => {
    expect(yearsBetween(-230, -200)).toBe(30);
    expect(yearsBetween(-1, 1)).toBe(1);
    expect(yearsBetween(1, -1)).toBe(-1);
    expect(yearsBetween(-230, 106)).toBe(335);
    expect(relLabel(1757, 1764)).toBe('+7 yrs');
    expect(relLabel(1764, 1757)).toBe('-7 yrs');
    expect(relLabel(1764, 1764)).toBe('same year');
    expect(relLabel(1, 2)).toBe('+1 yr');
  });

  it('splits the paper tag off a fact and shortens the paper name', () => {
    expect(splitPaperTag('Kubiraka ruled Bhattiprolu (APPSC Group-II 2018 key).')).toEqual({ text: 'Kubiraka ruled Bhattiprolu.', paper: 'G-II 2018' });
    expect(splitPaperTag('Plain fact.')).toEqual({ text: 'Plain fact.' });
    expect(shortPaper('Group-1')).toBe('G-I');
    expect(shortPaper('Group-II Screening 2018')).toBe('G-II Screening 2018');
  });

  it('collects every paper that asked about an event, from facts and exam points', () => {
    const e = ev('a', 100, {
      facts: ['x (APPSC Group-II 2018 key).', 'y (APPSC Group-II 2018 key).', 'z'],
      examAngle: [{ point: 'p', context: 'c', asked: ['G-II 2025', 'NCERT'] }],
    });
    expect(askedPapers(e)).toEqual(['G-II 2018', 'G-II 2025', 'NCERT']);
  });

  it('resolves pegs, drops unknown ids, and finds the nearest earlier peg', () => {
    const events = [ev('s', -230), ev('i', 225), ev('c', 624)];
    const pegs = resolvePegs([{ eventId: 'c', hook: 'h3' }, { eventId: 's', hook: 'h1' }, { eventId: 'nope', hook: 'x' }], events);
    expect(pegs.map((p) => p.eventId)).toEqual(['s', 'c']);
    expect(nearestPeg(106, pegs)?.eventId).toBe('s');
    expect(nearestPeg(700, pegs)?.eventId).toBe('c');
    expect(nearestPeg(-1000, pegs)?.eventId).toBe('s');
    expect(nearestPeg(5, [])).toBeUndefined();
  });

  it('takes up to k neighbours on each side', () => {
    expect(neighbours([1, 2, 3, 4, 5], 0)).toEqual({ before: [], after: [2, 3] });
    expect(neighbours([1, 2, 3, 4, 5], 2)).toEqual({ before: [1, 2], after: [4, 5] });
    expect(neighbours([1, 2, 3, 4, 5], 4, 1)).toEqual({ before: [4], after: [] });
  });

  it('finds big events close in time, nearest first, shown in year order', () => {
    const me = ev('me', 1163);
    const pool = [ev('far', 1300), ev('b', 1192), ev('a', 1150), ev('small', 1160, { importance: 2 }), me];
    expect(meanwhile(me, pool, 40).map((e) => e.id)).toEqual(['a', 'b']);
    expect(meanwhileWindow(-74000)).toBeGreaterThan(meanwhileWindow(-200));
    expect(meanwhileWindow(1900)).toBe(10);
  });

  it('shuffles the same way for the same seed and keeps every item', () => {
    const a = seededShuffle([1, 2, 3, 4, 5, 6], 42);
    expect(seededShuffle([1, 2, 3, 4, 5, 6], 42)).toEqual(a);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('spreads picks evenly and keeps the first and last', () => {
    expect(spread([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 6)).toEqual([1, 3, 5, 7, 9, 11]);
    expect(spread([1, 2], 6)).toEqual([1, 2]);
  });
});
