import { describe, it, expect } from 'vitest';
import syllabusMapJson from '../../../content/audit/syllabus-map.json';
import pyqMapJson from '../../../content/audit/pyq-map.json';
import taxonomy from '../../../content/taxonomy.json';
import {
  parseSyllabusMap,
  parsePyqMap,
  SyllabusMapClauseSchema,
  PyqMapEntrySchema,
  AUDIT_PAPERS,
} from '../audit-types';
import { parseTaxonomy } from '../taxonomy';

/**
 * Schema + integrity tests for the two authored audit maps. They must parse
 * against the Zod schemas, reject malformed shapes, and — crucially — every
 * subtopic id they reference must resolve to a real taxonomy subtopic (a dangling
 * id would silently make a clause look MISSING).
 */
describe('audit maps — schema', () => {
  it('accepts the authored syllabus map', () => {
    const map = parseSyllabusMap(syllabusMapJson);
    expect(map.length).toBeGreaterThan(100);
    // Every clause carries at least one keyword and a valid audit paper.
    for (const c of map) {
      expect(c.keywords.length).toBeGreaterThan(0);
      expect(AUDIT_PAPERS).toContain(c.paper);
    }
  });

  it('accepts the authored PYQ map', () => {
    const map = parsePyqMap(pyqMapJson);
    expect(map.length).toBeGreaterThan(50);
    for (const p of map) {
      expect(p.years.length).toBeGreaterThan(0);
      expect(p.keywords.length).toBeGreaterThan(0);
    }
  });

  it('rejects a clause missing keywords', () => {
    expect(
      SyllabusMapClauseSchema.safeParse({
        ref: 'X', paper: 'prelims-1', clause: 'c', subtopicIds: [], keywords: [], apSpecific: false,
      }).success,
    ).toBe(false);
  });

  it('rejects a clause with an unknown paper', () => {
    expect(
      SyllabusMapClauseSchema.safeParse({
        ref: 'X', paper: 'prelims-9', clause: 'c', subtopicIds: [], keywords: ['k'], apSpecific: false,
      }).success,
    ).toBe(false);
  });

  it('rejects a PYQ entry with no years', () => {
    expect(
      PyqMapEntrySchema.safeParse({
        years: [], paper: 'prelims-1', subject: 'S', gist: 'g', keywords: ['k'], subtopicId: 's',
      }).success,
    ).toBe(false);
  });
});

describe('audit maps — integrity against the taxonomy', () => {
  const tax = parseTaxonomy(taxonomy);
  const validIds = new Set(tax.subtopics.map((s) => s.id));

  it('every syllabus-map subtopic id resolves to a taxonomy subtopic', () => {
    const map = parseSyllabusMap(syllabusMapJson);
    const dangling = map.flatMap((c) => c.subtopicIds).filter((id) => !validIds.has(id));
    expect([...new Set(dangling)]).toEqual([]);
  });

  it('every PYQ-map subtopic id resolves to a taxonomy subtopic', () => {
    const map = parsePyqMap(pyqMapJson);
    const dangling = map.map((p) => p.subtopicId).filter((id) => !validIds.has(id));
    expect([...new Set(dangling)]).toEqual([]);
  });

  it('re-maps the previously MISSING Mains-III ethics/law clauses to the new subtopics', () => {
    const map = parseSyllabusMap(syllabusMapJson);
    const byRef = new Map(map.map((c) => [c.ref, c]));
    // The 6 gap-fill subtopics must now carry the clauses that were MISSING/THIN.
    expect(byRef.get('M3-11')?.subtopicIds).toContain('pol-ethics-human-interface');
    expect(byRef.get('M3-14')?.subtopicIds).toContain('pol-ethics-public-service-probity');
    expect(byRef.get('M3-15c')?.subtopicIds).toContain('pol-law-civil-criminal-labour');
    expect(byRef.get('M3-6')?.subtopicIds).toContain('pol-public-administration');
  });
});
