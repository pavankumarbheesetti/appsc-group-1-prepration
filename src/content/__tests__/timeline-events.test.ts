/**
 * Timeline dataset tests.
 *
 * Two concerns, mirroring the content-integrity gate:
 *   1. SCHEMA — `content/timeline/events.json` parses against the Zod schema in
 *      `timeline-types.ts` (shape, enums, date/period refinements).
 *   2. INTEGRITY — ids are unique; every `subtopicId` exists in the taxonomy;
 *      every `relatedMcqId` resolves to a real MCQ item id; periods are
 *      well-ordered; the event list is sortable/indexable by `date.year`.
 *
 * Both read the SAME JSON the app bundles (via node:fs, like validate.ts), so a
 * regression in the data or the schema fails here rather than at runtime.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTimeline,
  TimelineBankSchema,
  ERA_IDS,
  LANE_IDS,
  groupEventsByEra,
} from '../timeline-types';
import { TaxonomySchema } from '../taxonomy';

const CONTENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../content');

const rawTimeline = JSON.parse(
  readFileSync(join(CONTENT_DIR, 'timeline', 'events.json'), 'utf8'),
) as unknown;
const taxonomy = TaxonomySchema.parse(
  JSON.parse(readFileSync(join(CONTENT_DIR, 'taxonomy.json'), 'utf8')),
);

/** Collect every MCQ item id across all content banks on disk. */
function collectMcqIds(): Set<string> {
  const ids = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (entry.endsWith('.json')) {
        let json: unknown;
        try {
          json = JSON.parse(readFileSync(abs, 'utf8'));
        } catch {
          return;
        }
        if (json && (json as { kind?: unknown }).kind === 'mcq') {
          for (const item of (json as { items: { id: string }[] }).items) ids.add(item.id);
        }
      }
    }
  };
  walk(CONTENT_DIR);
  return ids;
}

describe('timeline schema', () => {
  it('parses against the Zod schema', () => {
    expect(() => parseTimeline(rawTimeline)).not.toThrow();
  });

  it('is a non-trivial dataset (kind, version, events, periods)', () => {
    const bank = parseTimeline(rawTimeline);
    expect(bank.kind).toBe('timeline');
    expect(bank.version).toMatch(/\d+\.\d+\.\d+/);
    expect(bank.events.length).toBeGreaterThanOrEqual(250);
    expect(bank.periods.length).toBeGreaterThanOrEqual(50);
  });

  it('only uses declared era, lane and kind enums', () => {
    const bank = parseTimeline(rawTimeline);
    const eras = new Set<string>(ERA_IDS);
    const lanes = new Set<string>(LANE_IDS);
    for (const ev of bank.events) {
      expect(eras.has(ev.era)).toBe(true);
      expect(lanes.has(ev.lane)).toBe(true);
    }
    for (const p of bank.periods) expect(lanes.has(p.lane)).toBe(true);
  });

  it('rejects a year of 0 and an endYear before year', () => {
    expect(TimelineBankSchema.safeParse({
      kind: 'timeline', version: '1.0.0', periods: [],
      events: [{ id: 'x', title: 'x', date: { year: 0 }, era: 'gupta', lane: 'north-india', kind: 'event', summary: 's', detail: 'd', subtopicIds: [], relatedMcqIds: [], apSpecific: false, importance: 1, source: 'x' }],
    }).success).toBe(false);
    expect(TimelineBankSchema.safeParse({
      kind: 'timeline', version: '1.0.0', periods: [],
      events: [{ id: 'x', title: 'x', date: { year: 320, endYear: 300 }, era: 'gupta', lane: 'north-india', kind: 'event', summary: 's', detail: 'd', subtopicIds: [], relatedMcqIds: [], apSpecific: false, importance: 1, source: 'x' }],
    }).success).toBe(false);
  });
});

describe('timeline integrity', () => {
  const bank = parseTimeline(rawTimeline);
  const subtopicIds = new Set(taxonomy.subtopics.map((s) => s.id));
  const mcqIds = collectMcqIds();

  it('has unique event ids and period ids', () => {
    const evIds = bank.events.map((e) => e.id);
    expect(new Set(evIds).size).toBe(evIds.length);
    const pIds = bank.periods.map((p) => p.id);
    expect(new Set(pIds).size).toBe(pIds.length);
  });

  it('every event subtopicId exists in the taxonomy', () => {
    const bad: string[] = [];
    for (const ev of bank.events) {
      for (const sid of ev.subtopicIds) if (!subtopicIds.has(sid)) bad.push(`${ev.id}→${sid}`);
    }
    expect(bad).toEqual([]);
  });

  it('every period subtopicId exists in the taxonomy', () => {
    const bad: string[] = [];
    for (const p of bank.periods) {
      for (const sid of p.subtopicIds) if (!subtopicIds.has(sid)) bad.push(`${p.id}→${sid}`);
    }
    expect(bad).toEqual([]);
  });

  it('every relatedMcqId resolves to a real MCQ item id', () => {
    const bad: string[] = [];
    for (const ev of bank.events) {
      for (const mid of ev.relatedMcqIds) if (!mcqIds.has(mid)) bad.push(`${ev.id}→${mid}`);
    }
    expect(bad).toEqual([]);
  });

  it('periods are well-ordered (startYear <= endYear)', () => {
    for (const p of bank.periods) expect(p.endYear).toBeGreaterThanOrEqual(p.startYear);
  });

  it('events are sortable/indexable by date.year and stay complete after grouping', () => {
    const sorted = [...bank.events].sort((a, b) => a.date.year - b.date.year);
    expect(sorted.length).toBe(bank.events.length);
    const grouped = groupEventsByEra(bank.events).reduce((n, g) => n + g.events.length, 0);
    expect(grouped).toBe(bank.events.length);
    // groups appear in declared ERA order
    const order = groupEventsByEra(bank.events).map((g) => g.era);
    const expected = ERA_IDS.filter((e) => bank.events.some((ev) => ev.era === e));
    expect(order).toEqual(expected);
  });

  it('keeps a strong Andhra-Pradesh share (>= 25% of events)', () => {
    const ap = bank.events.filter((e) => e.apSpecific).length;
    expect(ap / bank.events.length).toBeGreaterThanOrEqual(0.25);
  });

  it('links the large majority of events to at least one MCQ', () => {
    const linked = bank.events.filter((e) => e.relatedMcqIds.length > 0).length;
    expect(linked / bank.events.length).toBeGreaterThan(0.8);
  });
});
