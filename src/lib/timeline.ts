/**
 * Timeline LOGIC — pure, DOM-free helpers backing the interactive Timeline view.
 *
 * Everything the view needs that can be reasoned about without a browser lives
 * here so it is trivially unit-tested: the time SCALE (linear + a non-linear
 * "emphasis" scale that compresses ancient centuries and expands modern
 * decades), overlap-avoiding lane ROW layout, event FILTERING/SEARCH, the axis
 * tick + era-band geometry, and the three learning-mode helpers (chronology
 * challenge scoring, "guess the year" distance, "which came first").
 *
 * The data model (events, periods, eras, lanes, kinds) is owned by
 * {@link ../content/timeline-types.ts}; this module only imports its TYPES and
 * the pure {@link groupEventsByEra} grouping helper. It never touches the store,
 * the loader, or the DOM.
 */
import {
  ERA_IDS,
  LANE_IDS,
  groupEventsByEra,
  type EraId,
  type Kind,
  type Lane,
  type TimelineDate,
  type TimelineEvent,
} from '../content/timeline-types';
import type { SubjectCode } from '../content/types';

/* -------------------------------------------------------------------------- */
/* Presentation metadata (labels, ordering, marker shapes)                     */
/* -------------------------------------------------------------------------- */

/** Human label + teaching-order range caption for every era, keyed by id. */
export const ERA_META: Record<EraId, { label: string; range: string }> = {
  prehistoric: { label: 'Prehistory & Stone Age', range: 'up to c. 3000 BCE' },
  ivc: { label: 'Indus Valley', range: 'c. 3300–1300 BCE' },
  vedic: { label: 'Vedic Age', range: 'c. 1500–600 BCE' },
  mahajanapada: { label: 'Mahajanapadas', range: 'c. 600–345 BCE' },
  mauryan: { label: 'Mauryan Empire', range: 'c. 326–185 BCE' },
  'post-mauryan': { label: 'Post-Mauryan', range: 'c. 230 BCE–300 CE' },
  sangam: { label: 'Sangam Age', range: 'c. 300 BCE–300 CE' },
  gupta: { label: 'Gupta Empire', range: 'c. 320–550 CE' },
  'post-gupta': { label: 'Post-Gupta / Harsha', range: 'c. 543–750 CE' },
  'early-medieval': { label: 'Early Medieval', range: 'c. 750–1200 CE' },
  sultanate: { label: 'Delhi Sultanate', range: 'c. 1206–1526 CE' },
  'vijayanagara-bahmani': { label: 'Vijayanagara & Bahmani', range: 'c. 1336–1646 CE' },
  mughal: { label: 'Mughal Empire', range: 'c. 1526–1857 CE' },
  european: { label: 'European Arrival', range: 'c. 1498–1757 CE' },
  'company-rule': { label: 'Company Rule', range: 'c. 1757–1858 CE' },
  'freedom-struggle': { label: 'Freedom Struggle', range: 'c. 1857–1947 CE' },
  'post-independence': { label: 'Post-Independence', range: '1947–onwards' },
  'andhra-movement': { label: 'Andhra Movement', range: '1913–1956' },
  'ap-2014-onwards': { label: 'AP (2014–)', range: '2014–onwards' },
  contemporary: { label: 'Contemporary', range: 'recent years' },
};

/** Human label for every lane, keyed by id. */
export const LANE_META: Record<Lane, { label: string; short: string }> = {
  'north-india': { label: 'North India', short: 'North' },
  'south-india': { label: 'South India', short: 'South' },
  deccan: { label: 'Deccan', short: 'Deccan' },
  andhra: { label: 'Andhra', short: 'Andhra' },
  world: { label: 'World', short: 'World' },
  'polity-constitution': { label: 'Polity & Constitution', short: 'Polity' },
  economy: { label: 'Economy', short: 'Economy' },
  'science-tech': { label: 'Science & Tech', short: 'Sci/Tech' },
};

/** The four marker shapes the view can draw. */
export type MarkerShape = 'circle' | 'square' | 'diamond' | 'triangle';

/** Human label for each kind, keyed by id. */
export const KIND_META: Record<Kind, { label: string; shape: MarkerShape }> = {
  battle: { label: 'Battle', shape: 'diamond' },
  'dynasty-start': { label: 'Dynasty begins', shape: 'triangle' },
  'dynasty-end': { label: 'Dynasty ends', shape: 'triangle' },
  ruler: { label: 'Ruler', shape: 'circle' },
  treaty: { label: 'Treaty', shape: 'square' },
  act: { label: 'Act / law', shape: 'square' },
  movement: { label: 'Movement', shape: 'diamond' },
  institution: { label: 'Institution', shape: 'square' },
  culture: { label: 'Culture', shape: 'circle' },
  discovery: { label: 'Discovery', shape: 'diamond' },
  scheme: { label: 'Scheme', shape: 'square' },
  mission: { label: 'Mission', shape: 'triangle' },
  event: { label: 'Event', shape: 'circle' },
};

/** Marker radius (px, at scale 1) by importance 1..3. */
export function markerRadius(importance: 1 | 2 | 3): number {
  return importance === 3 ? 8 : importance === 2 ? 6 : 4.5;
}

/* -------------------------------------------------------------------------- */
/* Date formatting + ordering                                                  */
/* -------------------------------------------------------------------------- */

/** Short month names for modern (CE) dates that carry a month. @internal */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format one endpoint year as `1565 CE` / `2600 BCE`. @internal */
function formatEndpoint(year: number): string {
  return `${Math.abs(year)} ${year < 0 ? 'BCE' : 'CE'}`;
}

/**
 * Human-readable date string. Handles BCE/CE, an optional `c.` prefix for
 * approximate dates, a `year – endYear` span, and a `15 Aug 1947`-style day for
 * modern CE dates that carry month/day.
 */
export function formatYear(date: TimelineDate): string {
  const prefix = date.approx ? 'c. ' : '';
  // A precise modern (CE) day reads best as "15 Aug 1947".
  if (date.year > 0 && date.month !== undefined) {
    const mon = MONTHS[date.month - 1] ?? '';
    const day = date.day !== undefined ? `${date.day} ` : '';
    const base = `${prefix}${day}${mon} ${date.year} CE`.replace(/\s+/g, ' ').trim();
    return date.endYear !== undefined && date.endYear !== date.year
      ? `${base} – ${formatEndpoint(date.endYear)}`
      : base;
  }
  const base = `${prefix}${formatEndpoint(date.year)}`;
  return date.endYear !== undefined && date.endYear !== date.year
    ? `${base} – ${formatEndpoint(date.endYear)}`
    : base;
}

/** Ascending comparator by sort-key year (BCE before CE). */
export function byYear(a: TimelineEvent, b: TimelineEvent): number {
  return a.date.year - b.date.year;
}

/** Re-export the pure era grouping so the view has one import surface. */
export { groupEventsByEra };

/* -------------------------------------------------------------------------- */
/* Time scale                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A monotonic mapping between a YEAR domain and an X-pixel range, invertible so
 * the view can pan/zoom around a point and drive a minimap. `toX`/`fromX` clamp
 * to the domain/range so out-of-range input never produces NaN.
 */
export interface TimeScale {
  readonly width: number;
  readonly minYear: number;
  readonly maxYear: number;
  toX(year: number): number;
  fromX(x: number): number;
}

/**
 * A general piecewise-linear scale over strictly-increasing `domain` (years)
 * and matching strictly-increasing `range` (pixels). This is the primitive both
 * the linear and non-linear scales are built from. Requires `domain.length ===
 * range.length >= 2`.
 */
export function piecewiseScale(domain: readonly number[], range: readonly number[]): TimeScale {
  if (domain.length < 2 || domain.length !== range.length) {
    throw new Error('piecewiseScale: need matching domain/range of length >= 2');
  }
  const n = domain.length;
  const minYear = domain[0]!;
  const maxYear = domain[n - 1]!;
  const width = range[n - 1]!;

  const toX = (year: number): number => {
    if (year <= minYear) return range[0]!;
    if (year >= maxYear) return range[n - 1]!;
    // Locate the segment [domain[i], domain[i+1]] containing `year`.
    let i = 0;
    while (i < n - 1 && !(year >= domain[i]! && year <= domain[i + 1]!)) i += 1;
    const d0 = domain[i]!;
    const d1 = domain[i + 1]!;
    const r0 = range[i]!;
    const r1 = range[i + 1]!;
    const span = d1 - d0;
    const t = span === 0 ? 0 : (year - d0) / span;
    return r0 + t * (r1 - r0);
  };

  const fromX = (x: number): number => {
    if (x <= range[0]!) return minYear;
    if (x >= range[n - 1]!) return maxYear;
    let i = 0;
    while (i < n - 1 && !(x >= range[i]! && x <= range[i + 1]!)) i += 1;
    const r0 = range[i]!;
    const r1 = range[i + 1]!;
    const d0 = domain[i]!;
    const d1 = domain[i + 1]!;
    const span = r1 - r0;
    const t = span === 0 ? 0 : (x - r0) / span;
    return d0 + t * (d1 - d0);
  };

  return { width, minYear, maxYear, toX, fromX };
}

/** A data-derived era span (min/max year of the era's events). */
export interface EraSpan {
  era: EraId;
  startYear: number;
  endYear: number;
}

/** Which scale flavour to build. */
export type ScaleMode = 'linear' | 'nonlinear';

/**
 * Derive one {@link EraSpan} per era that actually has events, in the canonical
 * {@link ERA_IDS} teaching order. `startYear` is the era's earliest event year;
 * `endYear` is the latest event year OR span end. Empty eras are omitted. PURE.
 */
export function eraSpansFromEvents(events: readonly TimelineEvent[]): EraSpan[] {
  const min = new Map<EraId, number>();
  const max = new Map<EraId, number>();
  for (const ev of events) {
    const end = ev.date.endYear ?? ev.date.year;
    const lo = Math.min(ev.date.year, end);
    const hi = Math.max(ev.date.year, end);
    min.set(ev.era, Math.min(min.get(ev.era) ?? lo, lo));
    max.set(ev.era, Math.max(max.get(ev.era) ?? hi, hi));
  }
  const out: EraSpan[] = [];
  for (const era of ERA_IDS) {
    if (!min.has(era)) continue;
    out.push({ era, startYear: min.get(era)!, endYear: max.get(era)! });
  }
  return out;
}

/**
 * Build a {@link TimeScale} of the given pixel `width` from era spans.
 *
 * - `'linear'`: each era segment gets pixel width proportional to its YEAR span
 *   (so the whole axis is an ordinary linear year→pixel scale).
 * - `'nonlinear'`: every era segment gets EQUAL pixel width, so a 500,000-year
 *   prehistoric span and a 12-year modern span occupy the same width — ancient
 *   is compressed, modern is expanded (the exam-useful emphasis).
 *
 * Domain boundaries are the sorted unique era start years plus a final boundary
 * at the maximum end year, guaranteeing a strictly-increasing, invertible scale.
 */
export function buildTimeScale(
  spans: readonly EraSpan[],
  width: number,
  mode: ScaleMode,
): TimeScale {
  if (spans.length === 0) {
    // Degenerate fallback: a unit scale so callers never crash on empty data.
    return piecewiseScale([0, 1], [0, Math.max(1, width)]);
  }
  const sorted = [...spans].sort((a, b) => a.startYear - b.startYear);
  // Strictly-increasing domain boundaries from unique start years.
  const starts: number[] = [];
  for (const s of sorted) {
    if (starts.length === 0 || s.startYear > starts[starts.length - 1]!) starts.push(s.startYear);
  }
  const maxEnd = Math.max(...sorted.map((s) => s.endYear));
  const lastStart = starts[starts.length - 1]!;
  const domainMax = maxEnd > lastStart ? maxEnd : lastStart + 1;
  const domain = [...starts, domainMax];

  // Per-segment weights → cumulative pixel range.
  const segCount = domain.length - 1;
  const weights: number[] = [];
  for (let i = 0; i < segCount; i += 1) {
    weights.push(mode === 'nonlinear' ? 1 : Math.max(1, domain[i + 1]! - domain[i]!));
  }
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const range: number[] = [0];
  let cum = 0;
  for (let i = 0; i < segCount; i += 1) {
    cum += (weights[i]! / totalWeight) * width;
    range.push(cum);
  }
  return piecewiseScale(domain, range);
}

/** A positioned era band (behind the lanes), in pixel space. */
export interface EraBand {
  era: EraId;
  x1: number;
  x2: number;
}

/**
 * Compute the shaded era band geometry for a scale built from `spans`. Each band
 * spans from its era's start to the next era's start (the last band runs to the
 * scale's max year). PURE. @param spans same spans the scale was built from.
 */
export function eraBands(spans: readonly EraSpan[], scale: TimeScale): EraBand[] {
  const sorted = [...spans].sort((a, b) => a.startYear - b.startYear);
  const bands: EraBand[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const start = sorted[i]!.startYear;
    const nextStart = i + 1 < sorted.length ? sorted[i + 1]!.startYear : scale.maxYear;
    bands.push({ era: sorted[i]!.era, x1: scale.toX(start), x2: scale.toX(nextStart) });
  }
  return bands;
}

/**
 * Candidate "milestone" tick years spanning prehistory → present. The axis
 * builder keeps only those inside the scale domain and drops any that would sit
 * too close to a neighbour, so a non-linear scale never shows crowded ticks.
 */
export const TICK_YEARS: readonly number[] = [
  -500000, -10000, -3000, -1500, -600, -300, -100, 1, 300, 600, 900, 1200, 1400,
  1500, 1600, 1700, 1800, 1850, 1900, 1947, 1975, 2000, 2014, 2025,
];

/** A positioned axis tick. */
export interface AxisTick {
  year: number;
  x: number;
  label: string;
}

/**
 * Place axis ticks for `scale`, keeping only candidate years within the domain
 * and enforcing a `minGap` (px) between adjacent ticks so labels never collide.
 * PURE.
 */
export function axisTicks(scale: TimeScale, minGap = 46, candidates: readonly number[] = TICK_YEARS): AxisTick[] {
  const out: AxisTick[] = [];
  let lastX = -Infinity;
  for (const year of candidates) {
    if (year < scale.minYear || year > scale.maxYear) continue;
    const x = scale.toX(year);
    if (x - lastX < minGap) continue;
    out.push({ year, x, label: formatEndpoint(year) });
    lastX = x;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Lane row layout (overlap avoidance)                                         */
/* -------------------------------------------------------------------------- */

/** A horizontal box to be packed into rows: `x`..`x+w`. */
export interface RowItem {
  id: string;
  x: number;
  w: number;
}

/**
 * Greedy first-fit row packing: sort items by `x`, then drop each into the first
 * row whose last box ends (plus `gap`) at or before this box's start; otherwise
 * open a new row. Guarantees NO two items sharing a row overlap. Returns a map
 * from item id → row index (0-based). PURE.
 */
export function assignRows(items: readonly RowItem[], gap = 6): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.x - b.x || a.w - b.w);
  const rowEnds: number[] = []; // rowEnds[r] = right edge of the last box in row r
  const out = new Map<string, number>();
  for (const it of sorted) {
    let placed = false;
    for (let r = 0; r < rowEnds.length; r += 1) {
      if (it.x >= rowEnds[r]! + gap) {
        rowEnds[r] = it.x + it.w;
        out.set(it.id, r);
        placed = true;
        break;
      }
    }
    if (!placed) {
      out.set(it.id, rowEnds.length);
      rowEnds.push(it.x + it.w);
    }
  }
  return out;
}

/** The number of rows an {@link assignRows} result used. */
export function rowCount(rows: ReadonlyMap<string, number>): number {
  let max = -1;
  for (const r of rows.values()) if (r > max) max = r;
  return max + 1;
}

/* -------------------------------------------------------------------------- */
/* Filtering + search                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The live filter state. `lanes`/`eras`/`kinds` are SELECTION sets (membership =
 * shown); the view seeds them with every id so nothing is hidden by default.
 */
export interface TimelineFilter {
  lanes: ReadonlySet<Lane>;
  eras: ReadonlySet<EraId>;
  kinds: ReadonlySet<Kind>;
  /** A single subject code, or `'all'` for no subject restriction. */
  subject: SubjectCode | 'all';
  apOnly: boolean;
  /** Minimum importance to show (1 = all, 3 = must-know only). */
  minImportance: 1 | 2 | 3;
}

/** A default filter that shows everything. */
export function defaultFilter(): TimelineFilter {
  return {
    lanes: new Set(LANE_IDS),
    eras: new Set(ERA_IDS),
    kinds: new Set(Object.keys(KIND_META) as Kind[]),
    subject: 'all',
    apOnly: false,
    minImportance: 1,
  };
}

/** Resolves the subject code(s) an event belongs to (injected by the view). */
export type SubjectResolver = (ev: TimelineEvent) => readonly SubjectCode[];

/**
 * Apply `filter` to `events`. Subject filtering is delegated to `subjectsOf` so
 * this module stays free of the content loader. PURE.
 */
export function filterEvents(
  events: readonly TimelineEvent[],
  filter: TimelineFilter,
  subjectsOf: SubjectResolver = () => [],
): TimelineEvent[] {
  return events.filter((ev) => {
    if (!filter.lanes.has(ev.lane)) return false;
    if (!filter.eras.has(ev.era)) return false;
    if (!filter.kinds.has(ev.kind)) return false;
    if (ev.importance < filter.minImportance) return false;
    if (filter.apOnly && !ev.apSpecific) return false;
    if (filter.subject !== 'all' && !subjectsOf(ev).includes(filter.subject)) return false;
    return true;
  });
}

/**
 * Case-insensitive substring search over an event's title + summary. Matches
 * where the TITLE contains the query rank ahead of summary-only matches; within
 * each group results are ascending by year, so "pan to first match" is both
 * deterministic and intuitive. An empty/whitespace query returns []. PURE.
 */
export function searchEvents(events: readonly TimelineEvent[], query: string): TimelineEvent[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const matches = events.filter(
    (ev) => ev.title.toLowerCase().includes(q) || ev.summary.toLowerCase().includes(q),
  );
  return matches.sort((a, b) => {
    const at = a.title.toLowerCase().includes(q) ? 0 : 1;
    const bt = b.title.toLowerCase().includes(q) ? 0 : 1;
    return at - bt || a.date.year - b.date.year;
  });
}

/* -------------------------------------------------------------------------- */
/* Learning modes                                                              */
/* -------------------------------------------------------------------------- */

/** A small, fast, deterministic PRNG (mulberry32) for seeded game picks. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle using `rng`; returns a new array. @internal */
function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/**
 * Pick `n` events for a chronology challenge, PREFERRING distinct years so the
 * "correct order" is unambiguous. Falls back to allowing repeated years only if
 * there are not enough distinct-year events. Uses `rng` for reproducibility.
 * PURE. Returns fewer than `n` only when the pool is smaller than `n`.
 */
export function pickChronology(
  events: readonly TimelineEvent[],
  n: number,
  rng: () => number = Math.random,
): TimelineEvent[] {
  const seenYear = new Set<number>();
  const distinct: TimelineEvent[] = [];
  for (const ev of shuffle(events, rng)) {
    if (!seenYear.has(ev.date.year)) {
      seenYear.add(ev.date.year);
      distinct.push(ev);
    }
  }
  const pool = distinct.length >= n ? distinct : shuffle(events, rng);
  return pool.slice(0, Math.min(n, pool.length));
}

/** The result of scoring a chronology-challenge attempt. */
export interface ChronologyScore {
  /** How many events the learner placed in their correct chronological slot. */
  correctPositions: number;
  total: number;
  perfect: boolean;
  /** The events in the correct ascending-year order (for the reveal). */
  correctOrder: TimelineEvent[];
}

/**
 * Score a learner's ordering (`orderedIds`) of a chronology set against the true
 * ascending-year order. A slot counts as correct when the id the learner placed
 * there equals the id in the sorted order at that index. PURE.
 */
export function scoreChronology(
  orderedIds: readonly string[],
  events: readonly TimelineEvent[],
): ChronologyScore {
  const correctOrder = [...events].sort(byYear);
  const correctIds = correctOrder.map((e) => e.id);
  let correctPositions = 0;
  for (let i = 0; i < orderedIds.length; i += 1) {
    if (orderedIds[i] === correctIds[i]) correctPositions += 1;
  }
  const total = orderedIds.length;
  return { correctPositions, total, perfect: total > 0 && correctPositions === total, correctOrder };
}

/**
 * Absolute distance in years between a guess and an event's actual year, used by
 * the "Guess the year" flash mode. BCE/CE are already encoded in the sign, so a
 * simple absolute difference is correct. PURE.
 */
export function yearDistance(guess: number, actual: number): number {
  return Math.abs(guess - actual);
}

/**
 * "Which came first": returns `-1` when `a` is earlier, `1` when `b` is earlier,
 * and `0` when they share a year. PURE.
 */
export function whichCameFirst(a: TimelineEvent, b: TimelineEvent): -1 | 0 | 1 {
  if (a.date.year < b.date.year) return -1;
  if (a.date.year > b.date.year) return 1;
  return 0;
}

/**
 * Pick a random pair of DISTINCT-year events for a "which came first" round.
 * Returns `null` when fewer than two distinct-year events exist. PURE.
 */
export function pickPair(
  events: readonly TimelineEvent[],
  rng: () => number = Math.random,
): [TimelineEvent, TimelineEvent] | null {
  const shuffled = shuffle(events, rng);
  const first = shuffled[0];
  if (!first) return null;
  const second = shuffled.find((e) => e.date.year !== first.date.year);
  if (!second) return null;
  return [first, second];
}
