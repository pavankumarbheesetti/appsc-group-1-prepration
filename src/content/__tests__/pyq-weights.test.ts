import { describe, it, expect } from 'vitest';
import pyqWeightsJson from '../../../content/audit/pyq-weights.json';
import taxonomy from '../../../content/taxonomy.json';
import { parsePyqWeights, PyqWeightsSchema } from '../audit-types';
import { parseTaxonomy } from '../taxonomy';

/**
 * Schema + integrity tests for the authored PYQ-weights document. It must parse
 * against the Zod schema, key only real taxonomy subtopic ids, carry a weight
 * for every Prelims-track subtopic (0 allowed), and reproduce the headline
 * frequency numbers from the C-pyq audit (National Income 21, etc.).
 */
describe('pyq-weights — schema', () => {
  it('accepts the authored weights document', () => {
    const doc = parsePyqWeights(pyqWeightsJson);
    expect(doc.version).toBeGreaterThan(0);
    expect(doc.source.length).toBeGreaterThan(0);
    expect(Object.keys(doc.weights).length).toBeGreaterThan(100);
    // Weights are non-negative integers (0 allowed).
    for (const w of Object.values(doc.weights)) {
      expect(Number.isInteger(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects a negative weight', () => {
    expect(
      PyqWeightsSchema.safeParse({ version: 1, source: 's', weights: { x: -1 } }).success,
    ).toBe(false);
  });

  it('rejects a non-integer weight', () => {
    expect(
      PyqWeightsSchema.safeParse({ version: 1, source: 's', weights: { x: 1.5 } }).success,
    ).toBe(false);
  });

  it('rejects a missing source', () => {
    expect(PyqWeightsSchema.safeParse({ version: 1, weights: {} }).success).toBe(false);
  });
});

describe('pyq-weights — integrity against the taxonomy', () => {
  const tax = parseTaxonomy(taxonomy);
  const validIds = new Set(tax.subtopics.map((s) => s.id));
  const subjectTrack = new Map(tax.subjects.map((s) => [s.code, s.track] as const));
  const prelims = tax.subtopics.filter((s) => {
    const t = s.track ?? subjectTrack.get(s.subjectCode);
    return t === 'paper1' || t === 'paper2';
  });
  const doc = parsePyqWeights(pyqWeightsJson);

  it('keys only real taxonomy subtopic ids', () => {
    const dangling = Object.keys(doc.weights).filter((id) => !validIds.has(id));
    expect(dangling).toEqual([]);
  });

  it('carries a weight for EVERY Prelims-track subtopic (0 allowed)', () => {
    const missing = prelims.filter((s) => !(s.id in doc.weights)).map((s) => s.id);
    expect(missing).toEqual([]);
    // Every key is itself a Prelims subtopic (no stray mains-track keys).
    const prelimsIds = new Set(prelims.map((s) => s.id));
    expect(Object.keys(doc.weights).every((id) => prelimsIds.has(id))).toBe(true);
  });

  it('reproduces the C-pyq headline frequency numbers', () => {
    // Single-entry topics match their audit count exactly.
    expect(doc.weights['econ-national-income']).toBe(21);
    expect(doc.weights['geo-physical-india']).toBe(16);
    expect(doc.weights['geo-atmosphere-climatology']).toBe(13);
    expect(doc.weights['ment-number-system']).toBe(13);
    expect(doc.weights['ment-social-intelligence-decision']).toBe(14);
    // Aggregated topics sum their audit entries.
    // President/Executive 20 + Parliament 12 = 32.
    expect(doc.weights['pol-union-executive-legislature']).toBe(32);
    // AP CA/Schemes 19 + AP Welfare 5 = 24.
    expect(doc.weights['ca-regional']).toBe(24);
    // Space/ISRO 18 + Defence Tech 5 = 23.
    expect(doc.weights['sci-space-defence']).toBe(23);
  });

  it('sums to the corpus total minus the out-of-scope questions (693 of 695)', () => {
    const sum = Object.values(doc.weights).reduce((a, b) => a + b, 0);
    // 695 mapped question-topics − 2 out-of-scope (Telangana Armed Struggle) = 693.
    expect(sum).toBe(693);
  });
});
