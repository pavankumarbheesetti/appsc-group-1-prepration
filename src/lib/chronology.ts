/**
 * Helpers that place an event in time relative to things the learner already
 * knows: a few fixed "year pegs", the events just before and after it in the
 * lesson, and what was happening elsewhere at the same moment.
 */
import type { TimelineEvent } from '../content/timeline-types';

/** Signed years from `from` to `to`, with no year zero (1 BCE -> 1 CE is one year). */
export function yearsBetween(from: number, to: number): number {
  let gap = to - from;
  if (from < 0 && to > 0) gap -= 1;
  else if (from > 0 && to < 0) gap += 1;
  return gap;
}

/** "+30 yrs", "-12 yrs", "same year". */
export function relLabel(from: number, to: number): string {
  const g = yearsBetween(from, to);
  if (g === 0) return 'same year';
  const n = Math.abs(g);
  return `${g > 0 ? '+' : '-'}${n.toLocaleString('en-IN')} yr${n === 1 ? '' : 's'}`;
}

const PAPER_RE = /\s*\(APPSC ([^()]*?) key\)\.?$/;

/** Shorten "Group-II Screening 2018" to "G-II Screening 2018", "Group-1" to "G-I". */
export function shortPaper(name: string): string {
  return name.replace(/Group-?(II|2)\b/i, 'G-II').replace(/Group-?(I|1)\b/i, 'G-I').trim();
}

/** Split a fact like "X (APPSC Group-II 2018 key)." into its text and the paper that asked it. */
export function splitPaperTag(fact: string): { text: string; paper?: string } {
  const m = PAPER_RE.exec(fact);
  if (!m) return { text: fact };
  const text = fact.slice(0, m.index).trim();
  return { text: /[.!?]$/.test(text) ? text : `${text}.`, paper: shortPaper(m[1]!) };
}

/** Every distinct paper that asked something about this event. */
export function askedPapers(ev: TimelineEvent): string[] {
  const out = new Set<string>();
  for (const f of ev.facts ?? []) {
    const p = splitPaperTag(f).paper;
    if (p) out.add(p);
  }
  for (const x of ev.examAngle ?? []) for (const p of x.asked ?? []) out.add(p);
  return [...out].sort();
}

export interface Peg {
  eventId: string;
  year: number;
  title: string;
  hook: string;
}

/** Resolve chapter pegs against the events; unknown ids are dropped. Sorted by year. */
export function resolvePegs(pegs: readonly { eventId: string; hook: string }[], events: readonly TimelineEvent[]): Peg[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  return pegs
    .flatMap((p) => {
      const e = byId.get(p.eventId);
      return e ? [{ eventId: e.id, year: e.date.year, title: e.title, hook: p.hook }] : [];
    })
    .sort((a, b) => a.year - b.year);
}

/** The latest peg at or before `year`; the first peg if `year` is before them all. */
export function nearestPeg(year: number, pegs: readonly Peg[]): Peg | undefined {
  let best: Peg | undefined;
  for (const p of pegs) if (p.year <= year) best = p;
  return best ?? pegs[0];
}

/** Up to `k` lesson events on each side of index `i` (the events must already be in time order). */
export function neighbours<T>(list: readonly T[], i: number, k = 2): { before: T[]; after: T[] } {
  return { before: list.slice(Math.max(0, i - k), i), after: list.slice(i + 1, i + 1 + k) };
}

/**
 * Big events from outside this lesson close in time — "meanwhile elsewhere".
 * Picks importance-3 events within `window` years, nearest first.
 */
export function meanwhile(ev: TimelineEvent, pool: readonly TimelineEvent[], window: number, n = 3): TimelineEvent[] {
  return pool
    .filter((e) => e.id !== ev.id && e.importance === 3 && Math.abs(yearsBetween(ev.date.year, e.date.year)) <= window)
    .sort((a, b) => Math.abs(a.date.year - ev.date.year) - Math.abs(b.date.year - ev.date.year) || a.date.year - b.date.year)
    .slice(0, n)
    .sort((a, b) => a.date.year - b.date.year);
}

/** How wide "the same time" is: wider in the deep past, where dates are rough. */
export function meanwhileWindow(year: number): number {
  if (year < -1000) return 500;
  if (year < 0) return 60;
  if (year < 1200) return 40;
  if (year < 1800) return 25;
  return 10;
}

/** A seeded shuffle (mulberry32) so a lesson's ordering game is stable between visits. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const rand = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Pick `n` events spread evenly through a time-ordered list (first and last included). */
export function spread<T>(list: readonly T[], n: number): T[] {
  if (list.length <= n) return [...list];
  const out: T[] = [];
  for (let k = 0; k < n; k++) out.push(list[Math.round((k * (list.length - 1)) / (n - 1))]!);
  return [...new Set(out)];
}
