import { describe, expect, it } from 'vitest';
import type { TimelineEvent, TimelinePeriod } from '../../content/timeline-types';
import type { Office, Person } from '../../content/chronicle-types';
import { activeSpan } from '../../content/chronicle-types';
import {
  nearestYear,
  parseYear,
  plusYears,
  searchChronicleEvents,
  searchPeople,
  splitPeople,
  stepYear,
  yearSnapshot,
  yearsWithEntries,
  type ChronicleData,
} from '../year-snapshot';

const ev = (id: string, year: number, extra: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id, title: id, date: { year }, era: 'company-rule', lane: 'north-india', kind: 'event',
  summary: 's', detail: 'd', subtopicIds: [], relatedMcqIds: [], apSpecific: false, importance: 2, source: 'x',
  ...extra,
});
const person = (id: string, extra: Partial<Person> = {}): Person => ({
  id, name: id, category: 'administrator', era: 'company-rule', lane: 'north-india',
  summary: 's', facts: ['f'], subtopicIds: [], apSpecific: false, importance: 2, source: 'x',
  ...extra,
});
const period: TimelinePeriod = { id: 'per', label: 'Company', lane: 'north-india', startYear: 1757, endYear: 1858, subtopicIds: [] };
const office: Office = {
  id: 'off', label: 'GG', group: 'British India', lane: 'north-india',
  holders: [
    { name: 'A', personId: 'pa', from: 1773, to: 1785 },
    { name: 'B', from: 1786, to: 1793 },
  ],
};

const data: ChronicleData = {
  events: [
    ev('e1', 1784, { importance: 3, personIds: ['pa'] }),
    ev('e2', 1784, { date: { year: 1784, month: 2 } }),
    ev('war', 1780, { date: { year: 1780, endYear: 1784 } }),
    ev('ivc', -2600, { alsoOn: [{ year: 1921, text: 'Harappa dug' }] }),
  ],
  periods: [period],
  people: [
    person('pa', { born: 1732, died: 1818 }),
    person('pb', { activeFrom: 1780, activeTo: 1790, importance: 3, aka: ['Lord B'] }),
    person('pc', { born: 1784, died: 1850 }),
    person('pd', { born: 1800, died: 1860, alsoOn: [{ year: 1784, text: 'x' }] }),
  ],
  offices: [office],
};

describe('yearSnapshot', () => {
  it('collects events, ongoing spans, periods, holders, people and echoes', () => {
    const s = yearSnapshot(1784, data);
    expect(s.events.map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(s.ongoing.map((e) => e.id)).toEqual(['war']);
    expect(s.periods).toEqual([period]);
    expect(s.holders.get('British India')?.map((h) => h.holder.name)).toEqual(['A']);
    expect(s.people.map((p) => p.id)).toEqual(['pb', 'pa', 'pc']);
    expect(s.echoes.map((e) => e.person?.id)).toEqual(['pd']);
  });

  it('shows dated facts under their own year', () => {
    const s = yearSnapshot(1921, data);
    expect(s.echoes).toHaveLength(1);
    expect(s.echoes[0]!.event?.id).toBe('ivc');
    expect(s.echoes[0]!.text).toBe('Harappa dug');
  });

  it('orders same-month events by importance then title', () => {
    const s = yearSnapshot(5, { ...data, events: [ev('b', 5, { importance: 1 }), ev('a', 5, { importance: 1 }), ev('c', 5, { importance: 3 })] });
    expect(s.events.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('splitPeople', () => {
  it('separates people tied to the year from those merely active', () => {
    const s = yearSnapshot(1784, data);
    const { focus, others } = splitPeople(s, data.people);
    expect(focus.map((p) => p.id).sort()).toEqual(['pa', 'pc', 'pd']);
    expect(others.map((p) => p.id)).toEqual(['pb']);
  });

  it('includes a person whose role starts that year and skips unknown ids', () => {
    const p = person('pr', { roles: [{ title: 'GG', from: 1790, to: 1795 }] });
    const d: ChronicleData = { ...data, events: [ev('x', 1790, { personIds: ['missing'] })], people: [p] };
    const { focus } = splitPeople(yearSnapshot(1790, d), d.people);
    expect(focus.map((x) => x.id)).toEqual(['pr']);
  });
});

describe('year navigation', () => {
  const years = yearsWithEntries(data);

  it('lists only years with entries, ascending', () => {
    expect(years).toEqual([-2600, 1732, 1773, 1780, 1784, 1786, 1800, 1818, 1850, 1860, 1921]);
  });

  it('steps to the next / previous entry and stops at the ends', () => {
    expect(stepYear(years, 1784, 1)).toBe(1786);
    expect(stepYear(years, 1784, -1)).toBe(1780);
    expect(stepYear(years, 1921, 1)).toBeNull();
    expect(stepYear(years, -2600, -1)).toBeNull();
  });

  it('snaps to the nearest entry year', () => {
    expect(nearestYear(years, 1783)).toBe(1784);
    expect(nearestYear(years, 1782)).toBe(1780);
    expect(nearestYear([], 5)).toBeNull();
  });

  it('skips year 0 when adding years', () => {
    expect(plusYears(-1, 1)).toBe(1);
    expect(plusYears(1, -1)).toBe(-1);
    expect(plusYears(-2, 5)).toBe(4);
    expect(plusYears(3, -5)).toBe(-3);
    expect(plusYears(1784, 10)).toBe(1794);
  });
});

describe('parseYear', () => {
  it.each([
    ['1784', 1784],
    ['1784 CE', 1784],
    ['326 BCE', -326],
    ['326 bc', -326],
    ['-326', -326],
    ['c. 563 BCE', -563],
    ['1,857', 1857],
    ['78 AD', 78],
  ])('parses %s', (input, out) => {
    expect(parseYear(input)).toBe(out);
  });

  it.each(['', 'abc', '0', '12.5'])('rejects %s', (input) => {
    expect(parseYear(input)).toBeNull();
  });
});

describe('search', () => {
  it('finds people by name, aka or title', () => {
    expect(searchPeople(data.people, 'lord b').map((p) => p.id)).toEqual(['pb']);
    expect(searchPeople(data.people, '  ')).toEqual([]);
    const titled = [person('t', { titles: ['Iron Man'] })];
    expect(searchPeople(titled, 'iron')).toHaveLength(1);
  });

  it('finds events by title, place, parties or signers', () => {
    const evs = [
      ev('z', 1782, { title: 'Treaty of Salbai', signatories: ['Mahadji Scindia'] }),
      ev('y', 1757, { title: 'Plassey', place: 'Bengal', parties: ['Siraj'] }),
    ];
    expect(searchChronicleEvents(evs, 'scindia').map((e) => e.id)).toEqual(['z']);
    expect(searchChronicleEvents(evs, 'bengal').map((e) => e.id)).toEqual(['y']);
    expect(searchChronicleEvents(evs, 'siraj').map((e) => e.id)).toEqual(['y']);
    expect(searchChronicleEvents(evs, 'a').map((e) => e.id)).toEqual(['y', 'z']);
    expect(searchChronicleEvents(evs, '')).toEqual([]);
  });
});

describe('activeSpan', () => {
  it('prefers explicit span, then born–died, then roles', () => {
    expect(activeSpan(person('a', { activeFrom: 10, activeTo: 20, born: 1, died: 90 }))).toEqual({ from: 10, to: 20 });
    expect(activeSpan(person('b', { born: 1, died: 90 }))).toEqual({ from: 1, to: 90 });
    expect(activeSpan(person('c', { roles: [{ title: 't', from: 5, to: 8 }, { title: 'u', from: 2, to: 3 }] }))).toEqual({ from: 2, to: 8 });
    expect(activeSpan(person('d', { born: 50 }))).toEqual({ from: 50, to: 50 });
  });
});
