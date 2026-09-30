import { describe, it, expect } from 'vitest';
import learningSequenceJson from '../../../content/plan/learning-sequence.json';
import taxonomy from '../../../content/taxonomy.json';
import {
  LEARNING_SEQUENCE_SUBJECTS,
  LearningSequenceSchema,
  parseLearningSequence,
} from '../plan-types';
import { parseTaxonomy } from '../taxonomy';

/**
 * Schema + integrity tests for the authored learning sequence. It must parse
 * against the Zod schema, list every Prelims subtopic of each subject exactly
 * once, reference only earlier ids in `prereqs` (a valid topological study
 * order), key only real taxonomy ids, and tag MENT — and only MENT — with a
 * `stream`.
 */
describe('learning-sequence — schema', () => {
  it('accepts the authored document', () => {
    const doc = parseLearningSequence(learningSequenceJson);
    expect(doc.version).toBeGreaterThan(0);
    for (const subject of LEARNING_SEQUENCE_SUBJECTS) {
      expect(Array.isArray(doc.subjects[subject])).toBe(true);
      expect(doc.subjects[subject].length).toBeGreaterThan(0);
    }
  });

  it('rejects an unknown stream', () => {
    expect(
      LearningSequenceSchema.safeParse({
        version: 1,
        subjects: {
          HIST: [],
          POL: [],
          ECON: [],
          GEO: [],
          SCI: [],
          MENT: [{ id: 'x', prereqs: [], stream: 'bogus', why: 'y' }],
          CA: [],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects a missing why', () => {
    expect(
      LearningSequenceSchema.safeParse({
        version: 1,
        subjects: {
          HIST: [{ id: 'x', prereqs: [] }],
          POL: [],
          ECON: [],
          GEO: [],
          SCI: [],
          MENT: [],
          CA: [],
        },
      }).success,
    ).toBe(false);
  });
});

describe('learning-sequence — integrity against the taxonomy', () => {
  const tax = parseTaxonomy(taxonomy);
  const subjectTrack = new Map(tax.subjects.map((s) => [s.code, s.track] as const));
  const isPrelims = (s: (typeof tax.subtopics)[number]): boolean => {
    const t = s.track ?? subjectTrack.get(s.subjectCode);
    return t === 'paper1' || t === 'paper2';
  };
  const prelimsBySubject = new Map<string, Set<string>>();
  for (const s of tax.subtopics) {
    if (!isPrelims(s)) continue;
    const set = prelimsBySubject.get(s.subjectCode) ?? new Set<string>();
    set.add(s.id);
    prelimsBySubject.set(s.subjectCode, set);
  }
  const doc = parseLearningSequence(learningSequenceJson);

  it('lists EVERY Prelims subtopic of each subject exactly once', () => {
    for (const subject of LEARNING_SEQUENCE_SUBJECTS) {
      const expected = prelimsBySubject.get(subject) ?? new Set<string>();
      const ids = doc.subjects[subject].map((s) => s.id);
      // Exactly once: no duplicates.
      expect(new Set(ids).size).toBe(ids.length);
      // Same membership as the taxonomy's Prelims set for the subject.
      expect(new Set(ids)).toEqual(expected);
    }
  });

  it('keys only real taxonomy subtopic ids in the correct subject', () => {
    const idSubject = new Map(tax.subtopics.map((s) => [s.id, s.subjectCode] as const));
    for (const subject of LEARNING_SEQUENCE_SUBJECTS) {
      for (const step of doc.subjects[subject]) {
        expect(idSubject.get(step.id)).toBe(subject);
      }
    }
  });

  it('references prereqs only from EARLIER entries in the same list', () => {
    for (const subject of LEARNING_SEQUENCE_SUBJECTS) {
      const steps = doc.subjects[subject];
      const seenAt = new Map<string, number>();
      steps.forEach((step, idx) => {
        for (const p of step.prereqs) {
          const at = seenAt.get(p);
          expect(at, `${subject}: ${step.id} prereq ${p}`).not.toBeUndefined();
          expect(at! < idx).toBe(true);
        }
        seenAt.set(step.id, idx);
      });
    }
  });

  it('tags MENT steps with a MENT lane and HISTORY steps with a stream; no other subject', () => {
    // MENT steps carry a quant/reasoning/abilities lane.
    for (const step of doc.subjects.MENT) {
      expect(step.stream).toBeDefined();
      expect(['quant', 'reasoning', 'abilities']).toContain(step.stream);
    }
    // HISTORY steps carry an early/modern chronological stream (schema accepts it).
    for (const step of doc.subjects.HIST) {
      expect(step.stream).toBeDefined();
      expect(['early', 'modern']).toContain(step.stream);
    }
    // Every OTHER subject omits the stream tag.
    for (const subject of LEARNING_SEQUENCE_SUBJECTS) {
      if (subject === 'MENT' || subject === 'HIST') continue;
      for (const step of doc.subjects[subject]) {
        expect(step.stream).toBeUndefined();
      }
    }
  });

  it('splits HISTORY into TWO chronological streams (early + modern), each in order', () => {
    const hist = doc.subjects.HIST;
    const early = hist.filter((s) => s.stream === 'early').map((s) => s.id);
    const modern = hist.filter((s) => s.stream === 'modern').map((s) => s.id);
    expect(early.length).toBeGreaterThan(0);
    expect(modern.length).toBeGreaterThan(0);
    expect(early.length + modern.length).toBe(hist.length);
    // H-modern = modern + AP freedom/statehood + art & culture.
    expect(modern).toContain('hist-modern-freedom-movement');
    expect(modern).toContain('hist-ap-andhra-freedom-movement');
    expect(modern).toContain('hist-art-architecture');
    expect(modern).toContain('hist-art-ap-culture');
    // H-early = ancient + medieval + AP early dynasties.
    expect(early).toContain('hist-ancient-stone-age');
    expect(early).toContain('hist-medieval-mughal-empire');
    expect(early).toContain('hist-ap-kakatiyas');
    expect(early).toContain('hist-ap-qutb-shahis');
    // No modern/art topic leaked into the early stream and vice-versa.
    for (const id of early) expect(/^hist-(modern|art)-/.test(id)).toBe(false);
    for (const id of modern) expect(/^hist-(ancient|medieval)-/.test(id)).toBe(false);
  });

  it('keeps HISTORY chronological — AP topics interleave at their era', () => {
    const order = doc.subjects.HIST.map((s) => s.id);
    const pos = (id: string): number => order.indexOf(id);
    // AP Satavahanas–Ikshvakus right after ancient Satavahanas.
    expect(pos('hist-ap-satavahanas-ikshvakus')).toBe(pos('hist-ancient-satavahanas') + 1);
    // Kakatiyas after the south-Indian dynasties.
    expect(pos('hist-ap-kakatiyas')).toBeGreaterThan(pos('hist-medieval-south-indian-dynasties'));
    // Qutb Shahis after Vijayanagara–Bahmani.
    expect(pos('hist-ap-qutb-shahis')).toBeGreaterThan(pos('hist-medieval-vijayanagara-bahmani'));
    // Andhra freedom movement after the national freedom movement + Gandhi.
    expect(pos('hist-ap-andhra-freedom-movement')).toBeGreaterThan(pos('hist-modern-gandhi'));
    // Andhra state formation after post-independence integration.
    expect(pos('hist-ap-andhra-movement-formation')).toBeGreaterThan(
      pos('hist-modern-post-independence-integration'),
    );
    // AP culture after the AP dynasties it builds on.
    expect(pos('hist-art-ap-culture')).toBeGreaterThan(pos('hist-ap-kakatiyas'));
  });
});
