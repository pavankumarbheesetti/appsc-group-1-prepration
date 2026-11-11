/**
 * Pure helpers behind the Year explorer: everything recorded for one year.
 * Years: negative = BCE, positive = CE, never 0.
 */
import type { TimelineEvent, TimelinePeriod } from '../content/timeline-types';
import { activeSpan, type Office, type OfficeHolder, type Person } from '../content/chronicle-types';

export interface ChronicleData {
  events: readonly TimelineEvent[];
  periods: readonly TimelinePeriod[];
  people: readonly Person[];
  offices: readonly Office[];
}

export interface HolderInYear {
  office: Office;
  holder: OfficeHolder;
}

/** A fact dated to this year that lives on another event or person. */
export interface EchoFact {
  text: string;
  event?: TimelineEvent;
  person?: Person;
}

export interface YearSnapshot {
  year: number;
  /** Events that start in this year. */
  events: TimelineEvent[];
  /** Multi-year events that started earlier and are still running. */
  ongoing: TimelineEvent[];
  /** Dynasty / era bars covering this year. */
  periods: TimelinePeriod[];
  /** Office holders in post during this year, grouped by office group (insertion order kept). */
  holders: Map<string, HolderInYear[]>;
  people: Person[];
  /** "Also in this year": dated facts carried by events/people of other years. */
  echoes: EchoFact[];
}

const byImportanceThenTitle = (a: { importance: number; title?: string; name?: string }, b: typeof a): number =>
  b.importance - a.importance || (a.title ?? a.name ?? '').localeCompare(b.title ?? b.name ?? '');

export function yearSnapshot(year: number, data: ChronicleData): YearSnapshot {
  const events: TimelineEvent[] = [];
  const ongoing: TimelineEvent[] = [];
  for (const ev of data.events) {
    if (ev.date.year === year) events.push(ev);
    else if (ev.date.endYear !== undefined && ev.date.year < year && ev.date.endYear >= year) ongoing.push(ev);
  }
  events.sort((a, b) => (a.date.month ?? 13) - (b.date.month ?? 13) || (a.date.day ?? 32) - (b.date.day ?? 32) || byImportanceThenTitle(a, b));
  ongoing.sort(byImportanceThenTitle);

  const periods = data.periods
    .filter((p) => p.startYear <= year && p.endYear >= year)
    .sort((a, b) => a.startYear - b.startYear);

  const holders = new Map<string, HolderInYear[]>();
  for (const office of data.offices) {
    for (const holder of office.holders) {
      if (holder.from <= year && holder.to >= year) {
        const list = holders.get(office.group) ?? [];
        list.push({ office, holder });
        holders.set(office.group, list);
      }
    }
  }

  const people = data.people
    .filter((p) => {
      const span = activeSpan(p);
      return span.from <= year && span.to >= year;
    })
    .sort(byImportanceThenTitle);

  const echoes: EchoFact[] = [];
  for (const ev of data.events) for (const f of ev.alsoOn ?? []) if (f.year === year) echoes.push({ text: f.text, event: ev });
  for (const p of data.people) for (const f of p.alsoOn ?? []) if (f.year === year) echoes.push({ text: f.text, person: p });

  return { year, events, ongoing, periods, holders, people, echoes };
}

/**
 * People tied to this year: in an event of the year, holding a post now,
 * born/died this year, or carrying a dated fact for it. Others are merely active.
 */
export function splitPeople(snap: YearSnapshot, people: readonly Person[]): { focus: Person[]; others: Person[] } {
  const ids = new Set<string>();
  for (const e of snap.events) for (const id of e.personIds ?? []) ids.add(id);
  for (const rows of snap.holders.values()) for (const { holder } of rows) if (holder.personId) ids.add(holder.personId);
  for (const f of snap.echoes) if (f.person) ids.add(f.person.id);
  for (const p of people) {
    if (p.born === snap.year || p.died === snap.year) ids.add(p.id);
    if (p.roles?.some((r) => r.from === snap.year)) ids.add(p.id);
  }
  const byId = new Map(people.map((p) => [p.id, p]));
  const focus = [...ids].map((id) => byId.get(id)).filter((p): p is Person => p !== undefined)
    .sort((a, b) => b.importance - a.importance || a.name.localeCompare(b.name));
  return { focus, others: snap.people.filter((p) => !ids.has(p.id)) };
}

/** The year in `years` closest to `year` (ties go to the earlier year). */
export function nearestYear(years: readonly number[], year: number): number | null {
  let best: number | null = null;
  for (const y of years) if (best === null || Math.abs(y - year) < Math.abs(best - year)) best = y;
  return best;
}

/** Every year that has at least one starting event, a holder change or a person's birth/death — ascending. */
export function yearsWithEntries(data: ChronicleData): number[] {
  const set = new Set<number>();
  for (const ev of data.events) set.add(ev.date.year);
  for (const o of data.offices) for (const h of o.holders) set.add(h.from);
  for (const p of data.people) {
    if (p.born !== undefined) set.add(p.born);
    if (p.died !== undefined) set.add(p.died);
    for (const f of p.alsoOn ?? []) set.add(f.year);
  }
  for (const ev of data.events) for (const f of ev.alsoOn ?? []) set.add(f.year);
  set.delete(0);
  return [...set].sort((a, b) => a - b);
}

/** The nearest year in `years` strictly after (`dir` 1) or before (`dir` -1) `year`, or null. */
export function stepYear(years: readonly number[], year: number, dir: 1 | -1): number | null {
  if (dir === 1) {
    for (const y of years) if (y > year) return y;
    return null;
  }
  for (let i = years.length - 1; i >= 0; i--) if (years[i]! < year) return years[i]!;
  return null;
}

/** Move one calendar year, skipping year 0. */
export function plusYears(year: number, delta: number): number {
  let y = year + delta;
  if (y === 0 || (year < 0 && y > 0) || (year > 0 && y < 0)) y += delta > 0 ? 1 : -1;
  return y;
}

/** Parse "1784", "1784 CE", "326 BC", "-326", "c. 563 BCE" into a sort-key year; null if invalid. */
export function parseYear(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/^c\.?\s*/, '').replace(/,/g, '');
  const m = /^(-?\d{1,7})\s*(bce|bc|b\.c\.|ce|ad|a\.d\.)?$/.exec(s);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n) || n === 0) return null;
  const era = m[2];
  if (era && era.startsWith('b')) n = -Math.abs(n);
  return n;
}

/** People whose name, aka or titles contain `query` (case-insensitive). */
export function searchPeople(people: readonly Person[], query: string): Person[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  return people
    .filter((p) => [p.name, ...(p.aka ?? []), ...(p.titles ?? [])].some((s) => s.toLowerCase().includes(q)))
    .sort(byImportanceThenTitle);
}

/** Events whose title, place, parties or signatories contain `query`. */
export function searchChronicleEvents(events: readonly TimelineEvent[], query: string): TimelineEvent[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  return events
    .filter((e) =>
      [e.title, e.place ?? '', ...(e.parties ?? []), ...(e.signatories ?? [])].some((s) => s.toLowerCase().includes(q)),
    )
    .sort((a, b) => a.date.year - b.date.year);
}
