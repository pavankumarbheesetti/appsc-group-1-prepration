import { describe, it, expect } from 'vitest';
import taxonomy from '../../../content/taxonomy.json';
import ivcMcqBank from '../../../content/history-ancient/hist-ancient-ivc/mcq-hist-ancient-ivc.json';
import {
  getTaxonomy,
  getSubjects,
  getSubtopics,
  getSubtopic,
  getSubtopicCoverage,
} from '../loader';

// Exercises the taxonomy accessors and — crucially — the MERGE of taxonomy meta
// with the discovered banks grouped by subtopicId (the IVC banks all set
// subtopicId 'hist-ancient-ivc').
describe('taxonomy loader', () => {
  it('exposes the full-syllabus taxonomy', () => {
    const tax = getTaxonomy();
    // Nine subjects now span the whole official syllabus (Screening Papers I & II
    // plus the qualifying languages), not just History.
    expect(tax.subjects).toHaveLength(9);
    expect(tax.subtopics).toHaveLength(129);
    // The 23 Ancient-India subtopics are preserved unchanged.
    expect(tax.subtopics.filter((s) => s.chapterId === 'ancient-india')).toHaveLength(23);
  });

  it('lists subjects sorted by order', () => {
    const subjects = getSubjects();
    expect(subjects.map((s) => s.code)).toEqual([
      'HIST',
      'POL',
      'ECON',
      'GEO',
      'SCI',
      'MENT',
      'CA',
      'TEL',
      'ENG',
    ]);
  });

  it('tags each subject with its exam track (paper1 / paper2 / mains)', () => {
    const trackOf = new Map(getSubjects().map((s) => [s.code as string, s.track] as const));
    // Paper-I theory subjects.
    for (const code of ['HIST', 'POL', 'ECON', 'GEO']) {
      expect(trackOf.get(code)).toBe('paper1');
    }
    // Paper-II aptitude subjects.
    for (const code of ['SCI', 'MENT', 'CA']) {
      expect(trackOf.get(code)).toBe('paper2');
    }
    // Mains / qualifying parallel track.
    for (const code of ['TEL', 'ENG']) {
      expect(trackOf.get(code)).toBe('mains');
    }
  });

  it('lists subtopics sorted by chronological order, filterable by subject', () => {
    const all = getSubtopics();
    expect(all).toHaveLength(129);
    // Globally unique, strictly-ascending `order` across the whole taxonomy.
    for (let i = 1; i < all.length; i += 1) {
      expect(all[i]!.order).toBeGreaterThan(all[i - 1]!.order);
    }
    // History spans Ancient India (23) + Medieval (6) + Modern (9) + AP (6) + Art (3).
    expect(getSubtopics('HIST')).toHaveLength(47);
    // Other subjects are now populated as syllabus skeletons (0 authored content).
    expect(getSubtopics('ECON')).toHaveLength(14);
  });

  it('merges taxonomy meta with discovered content for a subtopic', () => {
    const ivc = getSubtopic('hist-ancient-ivc');
    expect(ivc).toBeDefined();
    expect(ivc?.meta.name).toBe('Indus Valley Civilization');
    expect(ivc?.meta.band).toBe('A');
    // The IVC banks are grouped in by subtopicId.
    expect(ivc?.mcqs).toHaveLength(ivcMcqBank.items.length);
    expect(ivc?.notes).toHaveLength(24);
    expect(ivc?.mains).toHaveLength(8);
  });

  it('merges taxonomy meta with discovered content for the Stone Age subtopic', () => {
    // Batch-1 registered content now resolves under the shared subtopicId.
    const stone = getSubtopic('hist-ancient-stone-age');
    expect(stone).toBeDefined();
    expect(stone?.meta.name).toBe('Stone Age');
    // Re-authored to a lean, coverage-driven exam-level bank (3 refreshers + 16 exam,
    // incl. an added chronology item from the review pipeline).
    // +13 MCQs closing the Stone Age fact universe (content/facts, 2026-10-17).
    expect(stone?.mcqs).toHaveLength(60);
    expect(stone?.notes).toHaveLength(16);
    expect(stone?.mains).toHaveLength(3);
    // Batch-1 rollout: the subtopic now declares an examPoints checklist that its
    // bank covers 100% (exam-point coverage, not the band-target fallback).
    expect(stone?.meta.examPoints).toHaveLength(23);
    const cov = getSubtopicCoverage('hist-ancient-stone-age');
    expect(cov?.examPoints?.missing).toEqual([]);
    expect(cov?.pct).toBe(100);
  });

  it('surfaces the Batch-6 reference subtopics (Books & Authors, Travelers) via the loader', () => {
    // Batch 6 completes all 23 subtopics, so no taxonomy subtopic is empty now.
    // Both newly registered reference topics resolve under their shared subtopicId.
    const books = getSubtopic('hist-ancient-books-authors');
    expect(books).toBeDefined();
    expect(books?.meta.name).toBe('Books & Authors of Ancient India');
    // Floors, not exact counts: completeness rounds grow these banks (round 4: 40 MCQs / 17 notes).
    expect(books?.mcqs.length).toBeGreaterThanOrEqual(19);
    expect(books?.notes.length).toBeGreaterThanOrEqual(14);
    expect(books?.mains.length).toBeGreaterThanOrEqual(2);

    const travelers = getSubtopic('hist-ancient-travelers');
    expect(travelers).toBeDefined();
    expect(travelers?.meta.name).toBe('Travelers in Ancient India');
    // Re-authored to a lean, coverage-driven exam-level bank (3 refreshers + 13 exam).
    // Floors (bank grew in completeness round 4: 27 MCQs / 14 notes).
    expect(travelers?.mcqs.length).toBeGreaterThanOrEqual(18);
    expect(travelers?.notes.length).toBeGreaterThanOrEqual(12);
    expect(travelers?.mains.length).toBeGreaterThanOrEqual(3);
    // Rollout: the subtopic now declares an examPoints checklist that its bank
    // covers 100% (exam-point coverage, not the band-target fallback).
    expect(travelers?.meta.examPoints?.length ?? 0).toBeGreaterThanOrEqual(16);
    const travelersCov = getSubtopicCoverage('hist-ancient-travelers');
    expect(travelersCov?.examPoints?.missing).toEqual([]);
    expect(travelersCov?.pct).toBe(100);
  });

  it('returns undefined for an unknown subtopic id', () => {
    expect(getSubtopic('does-not-exist')).toBeUndefined();
  });

  it('getSubtopicCoverage returns exam-point coverage for a subtopic that declares examPoints', () => {
    // IVC is the coverage-driven EXEMPLAR: it declares an examPoints checklist,
    // and its lean bank covers 100% of those points via each item's covers[].
    const cov = getSubtopicCoverage('hist-ancient-ivc');
    expect(cov).toBeDefined();
    expect(cov?.examPoints).toBeDefined();
    // Computed: the taxonomy checklist grows when completeness rounds merge examPoints.
    const declared = taxonomy.subtopics.find((s) => s.id === 'hist-ancient-ivc')?.examPoints ?? [];
    expect(declared.length).toBeGreaterThanOrEqual(20);
    expect(cov?.examPoints?.total).toBe(declared.length);
    expect(cov?.examPoints?.missing).toEqual([]);
    expect(cov?.pct).toBe(100);
  });

  it('getSubtopicCoverage falls back to the band-target estimate when no examPoints are authored', () => {
    // The fallback path: a subtopic that declares NO examPoints reports a band-
    // target estimate with NO per-point detail. We anchor this on the FIRST
    // content-less subtopic (chosen dynamically) — never authored and with no
    // examPoints checklist, so it stays on the fallback path: the band-target
    // estimate is 0% (no authored MCQs) and, crucially, examPoints is undefined.
    // Skip-guard when the whole taxonomy is authored (no such subtopic remains).
    const contentlessId = getSubtopics().find((s) => {
      const v = getSubtopic(s.id);
      return (
        v !== undefined &&
        (v.meta.examPoints === undefined || v.meta.examPoints.length === 0) &&
        v.mcqs.length === 0
      );
    })?.id;
    if (contentlessId) {
      const cov = getSubtopicCoverage(contentlessId);
      expect(cov).toBeDefined();
      expect(cov?.pct).toBe(0);
      // Fallback carries no exam-point breakdown.
      expect(cov?.examPoints).toBeUndefined();
    }
    // Unknown id → undefined (not in the taxonomy).
    expect(getSubtopicCoverage('does-not-exist')).toBeUndefined();
  });
});
