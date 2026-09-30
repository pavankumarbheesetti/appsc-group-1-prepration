import { describe, it, expect } from 'vitest';
import {
  assignRows,
  axisTicks,
  buildTimeScale,
  byYear,
  defaultFilter,
  eraBands,
  eraSpansFromEvents,
  filterEvents,
  formatYear,
  mulberry32,
  pickChronology,
  pickPair,
  piecewiseScale,
  rowCount,
  scoreChronology,
  searchEvents,
  whichCameFirst,
  yearDistance,
  type EraSpan,
} from '../timeline';
import type { TimelineEvent } from '../../content/timeline-types';

/** Build a minimal valid event for layout/filter tests. @internal */
function ev(partial: Partial<TimelineEvent> & { id: string; year: number }): TimelineEvent {
  return {
    id: partial.id,
    title: partial.title ?? partial.id,
    date: { year: partial.year, ...(partial.date ?? {}) },
    era: partial.era ?? 'mauryan',
    lane: partial.lane ?? 'north-india',
    kind: partial.kind ?? 'event',
    summary: partial.summary ?? 'summary',
    detail: partial.detail ?? 'detail',
    subtopicIds: partial.subtopicIds ?? [],
    relatedMcqIds: partial.relatedMcqIds ?? [],
    apSpecific: partial.apSpecific ?? false,
    importance: partial.importance ?? 1,
    source: partial.source ?? 'src',
  };
}

describe('piecewiseScale', () => {
  const s = piecewiseScale([-100, 0, 100], [0, 50, 200]);

  it('maps domain endpoints to range endpoints', () => {
    expect(s.toX(-100)).toBe(0);
    expect(s.toX(100)).toBe(200);
    expect(s.minYear).toBe(-100);
    expect(s.maxYear).toBe(100);
    expect(s.width).toBe(200);
  });

  it('is piecewise (segments have different pixel density)', () => {
    // First segment: 100 years over 50px; second: 100 years over 150px.
    expect(s.toX(-50)).toBeCloseTo(25);
    expect(s.toX(50)).toBeCloseTo(125);
  });

  it('clamps out-of-range input', () => {
    expect(s.toX(-9999)).toBe(0);
    expect(s.toX(9999)).toBe(200);
    expect(s.fromX(-10)).toBe(-100);
    expect(s.fromX(9999)).toBe(100);
  });

  it('round-trips year → x → year within each segment', () => {
    for (const y of [-100, -75, -20, 0, 33, 80, 100]) {
      expect(s.fromX(s.toX(y))).toBeCloseTo(y, 5);
    }
  });
});

describe('buildTimeScale', () => {
  const spans: EraSpan[] = [
    { era: 'prehistoric', startYear: -500000, endYear: -3000 },
    { era: 'mauryan', startYear: -326, endYear: -185 },
    { era: 'contemporary', startYear: 2000, endYear: 2026 },
  ];

  it('nonlinear gives each era roughly equal width (compresses ancient)', () => {
    const scale = buildTimeScale(spans, 900, 'nonlinear');
    // Three eras → three equal 300px segments (boundaries at start years + max end).
    expect(scale.toX(-500000)).toBeCloseTo(0);
    expect(scale.toX(-326)).toBeCloseTo(300);
    expect(scale.toX(2000)).toBeCloseTo(600);
    expect(scale.toX(2026)).toBeCloseTo(900);
  });

  it('linear gives width proportional to year span', () => {
    const scale = buildTimeScale(spans, 1000, 'linear');
    // Total domain span is huge and dominated by prehistory; modern is a sliver.
    const ancientW = scale.toX(-326) - scale.toX(-500000);
    const modernW = scale.toX(2026) - scale.toX(2000);
    expect(ancientW).toBeGreaterThan(modernW * 100);
  });

  it('is monotonic increasing across the whole domain', () => {
    const scale = buildTimeScale(spans, 800, 'nonlinear');
    let prev = -Infinity;
    for (const y of [-500000, -100000, -326, -200, 0, 1000, 2000, 2026]) {
      const x = scale.toX(y);
      expect(x).toBeGreaterThanOrEqual(prev);
      prev = x;
    }
  });

  it('never crashes on empty spans', () => {
    const scale = buildTimeScale([], 500, 'nonlinear');
    expect(scale.width).toBeGreaterThan(0);
  });
});

describe('eraSpansFromEvents', () => {
  it('derives one span per era in chronological ERA_IDS order', () => {
    const spans = eraSpansFromEvents([
      ev({ id: 'a', year: 320, era: 'gupta' }),
      ev({ id: 'b', year: 550, era: 'gupta' }),
      ev({ id: 'c', year: -326, era: 'mauryan' }),
    ]);
    expect(spans.map((s) => s.era)).toEqual(['mauryan', 'gupta']);
    expect(spans.find((s) => s.era === 'gupta')).toMatchObject({ startYear: 320, endYear: 550 });
  });

  it('uses endYear for spans', () => {
    const spans = eraSpansFromEvents([ev({ id: 'a', year: -300, date: { year: -300, endYear: 300 }, era: 'sangam' })]);
    expect(spans[0]).toMatchObject({ startYear: -300, endYear: 300 });
  });
});

describe('eraBands + axisTicks', () => {
  const spans: EraSpan[] = [
    { era: 'mauryan', startYear: -326, endYear: -185 },
    { era: 'gupta', startYear: 320, endYear: 550 },
  ];
  const scale = buildTimeScale(spans, 600, 'nonlinear');

  it('bands cover the axis start→next-start, last band to maxYear', () => {
    const bands = eraBands(spans, scale);
    expect(bands).toHaveLength(2);
    expect(bands[0]!.x1).toBeCloseTo(0);
    expect(bands[1]!.x2).toBeCloseTo(600);
    // Bands are contiguous.
    expect(bands[0]!.x2).toBeCloseTo(bands[1]!.x1);
  });

  it('axis ticks stay within domain and respect the min gap', () => {
    const ticks = axisTicks(scale, 40);
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t.year).toBeGreaterThanOrEqual(scale.minYear);
      expect(t.year).toBeLessThanOrEqual(scale.maxYear);
    }
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!.x - ticks[i - 1]!.x).toBeGreaterThanOrEqual(40);
    }
  });
});

describe('assignRows (overlap avoidance)', () => {
  it('places overlapping boxes in different rows and never overlaps within a row', () => {
    const items = [
      { id: 'a', x: 0, w: 50 },
      { id: 'b', x: 10, w: 50 }, // overlaps a
      { id: 'c', x: 120, w: 30 }, // fits in row 0 after a
      { id: 'd', x: 20, w: 40 }, // overlaps a and b
    ];
    const rows = assignRows(items, 6);
    // Verify no two items in the same row overlap.
    const byRow = new Map<number, { x: number; w: number }[]>();
    for (const it of items) {
      const r = rows.get(it.id)!;
      const list = byRow.get(r) ?? [];
      list.push(it);
      byRow.set(r, list);
    }
    for (const list of byRow.values()) {
      const sorted = [...list].sort((p, q) => p.x - q.x);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i]!.x).toBeGreaterThanOrEqual(sorted[i - 1]!.x + sorted[i - 1]!.w + 6);
      }
    }
    expect(rowCount(rows)).toBeGreaterThanOrEqual(3);
  });

  it('packs non-overlapping boxes into a single row', () => {
    const rows = assignRows([
      { id: 'a', x: 0, w: 20 },
      { id: 'b', x: 40, w: 20 },
      { id: 'c', x: 80, w: 20 },
    ], 6);
    expect(rowCount(rows)).toBe(1);
  });
});

describe('filterEvents', () => {
  const events = [
    ev({ id: 'ap', year: 1953, lane: 'andhra', era: 'post-independence', kind: 'event', apSpecific: true, importance: 3, subtopicIds: ['s-pol'] }),
    ev({ id: 'battle', year: 1565, lane: 'deccan', era: 'vijayanagara-bahmani', kind: 'battle', importance: 2, subtopicIds: ['s-hist'] }),
    ev({ id: 'ctx', year: -600, lane: 'world', era: 'mahajanapada', kind: 'culture', importance: 1 }),
  ];
  const subjectsOf = (e: TimelineEvent) =>
    e.subtopicIds.includes('s-pol') ? (['POL'] as const) : e.subtopicIds.includes('s-hist') ? (['HIST'] as const) : [];

  it('shows everything with the default filter', () => {
    expect(filterEvents(events, defaultFilter(), subjectsOf)).toHaveLength(3);
  });

  it('AP-only keeps only apSpecific events', () => {
    const f = { ...defaultFilter(), apOnly: true };
    expect(filterEvents(events, f, subjectsOf).map((e) => e.id)).toEqual(['ap']);
  });

  it('minImportance drops lower-importance events', () => {
    const f = { ...defaultFilter(), minImportance: 3 as const };
    expect(filterEvents(events, f, subjectsOf).map((e) => e.id)).toEqual(['ap']);
  });

  it('lane selection hides other lanes', () => {
    const f = { ...defaultFilter(), lanes: new Set(['deccan' as const]) };
    expect(filterEvents(events, f, subjectsOf).map((e) => e.id)).toEqual(['battle']);
  });

  it('subject filter uses the resolver', () => {
    const f = { ...defaultFilter(), subject: 'HIST' as const };
    expect(filterEvents(events, f, subjectsOf).map((e) => e.id)).toEqual(['battle']);
  });
});

describe('searchEvents', () => {
  const events = [
    ev({ id: 'talikota', year: 1565, title: 'Battle of Talikota', summary: 'Vijayanagara defeated' }),
    ev({ id: 'plassey', year: 1757, title: 'Battle of Plassey', summary: 'Company victory in Bengal' }),
  ];

  it('matches title and summary, case-insensitively, sorted by year', () => {
    expect(searchEvents(events, 'talikota').map((e) => e.id)).toEqual(['talikota']);
    expect(searchEvents(events, 'battle').map((e) => e.id)).toEqual(['talikota', 'plassey']);
    expect(searchEvents(events, 'bengal').map((e) => e.id)).toEqual(['plassey']);
  });

  it('returns [] for an empty query', () => {
    expect(searchEvents(events, '   ')).toEqual([]);
  });
});

describe('learning modes', () => {
  const events = [
    ev({ id: 'a', year: -326, title: 'Alexander invades' }),
    ev({ id: 'b', year: 321, title: 'Mauryan empire' }),
    ev({ id: 'c', year: 1565, title: 'Talikota' }),
    ev({ id: 'd', year: 1947, title: 'Independence' }),
  ];

  it('pickChronology returns n distinct-year events deterministically for a seed', () => {
    const rng = mulberry32(42);
    const pick = pickChronology(events, 3, rng);
    expect(pick).toHaveLength(3);
    expect(new Set(pick.map((e) => e.date.year)).size).toBe(3);
    // Same seed → same pick.
    expect(pickChronology(events, 3, mulberry32(42)).map((e) => e.id)).toEqual(pick.map((e) => e.id));
  });

  it('scoreChronology counts correctly-placed events and reveals the true order', () => {
    const set = [events[2]!, events[0]!, events[3]!, events[1]!]; // c,a,d,b
    // Learner orders a,b,c,d — correct chronological order is a,b,c,d.
    const score = scoreChronology(['a', 'b', 'c', 'd'], set);
    expect(score.total).toBe(4);
    expect(score.correctPositions).toBe(4);
    expect(score.perfect).toBe(true);
    expect(score.correctOrder.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('scoreChronology partial credit', () => {
    const score = scoreChronology(['a', 'c', 'b', 'd'], events); // b and c swapped
    expect(score.correctPositions).toBe(2);
    expect(score.perfect).toBe(false);
  });

  it('yearDistance and whichCameFirst', () => {
    expect(yearDistance(1940, 1947)).toBe(7);
    expect(whichCameFirst(events[0]!, events[3]!)).toBe(-1);
    expect(whichCameFirst(events[3]!, events[0]!)).toBe(1);
  });

  it('pickPair returns two distinct-year events', () => {
    const pair = pickPair(events, mulberry32(7));
    expect(pair).not.toBeNull();
    expect(pair![0].date.year).not.toBe(pair![1].date.year);
  });
});

describe('formatYear + byYear', () => {
  it('formats BCE/CE, approx, spans, and modern days', () => {
    expect(formatYear({ year: -2600, approx: true })).toBe('c. 2600 BCE');
    expect(formatYear({ year: 1565 })).toBe('1565 CE');
    expect(formatYear({ year: 1947, month: 8, day: 15 })).toBe('15 Aug 1947 CE');
    expect(formatYear({ year: -3300, endYear: -1300 })).toBe('3300 BCE – 1300 BCE');
  });

  it('byYear sorts BCE before CE', () => {
    const sorted = [{ date: { year: 100 } }, { date: { year: -100 } }] as TimelineEvent[];
    sorted.sort(byYear);
    expect(sorted[0]!.date.year).toBe(-100);
  });
});
