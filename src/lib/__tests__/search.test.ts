import { describe, it, expect } from 'vitest';
import { searchDocs, totalResults, type SearchDoc } from '../search';

const DOCS: SearchDoc[] = [
  { kind: 'subtopic', id: 'hist-ancient-ivc', title: 'Indus Valley Civilization', subtopicId: 'hist-ancient-ivc' },
  { kind: 'subtopic', id: 'hist-ancient-guptas', title: 'Gupta Empire', subtopicId: 'hist-ancient-guptas' },
  { kind: 'note', id: 'n1', title: 'Indus town planning', subtopicId: 'hist-ancient-ivc', subtitle: 'Indus Valley Civilization' },
  { kind: 'note', id: 'n2', title: 'Great Bath at Mohenjo-daro', subtopicId: 'hist-ancient-ivc' },
  { kind: 'mcq', id: 'm1', title: 'Which site is known as a water fort?', subtopicId: 'hist-ancient-ivc' },
  { kind: 'mcq', id: 'm2', title: 'Who excavated Mohenjo-daro?', subtopicId: 'hist-ancient-ivc' },
];

describe('searchDocs', () => {
  it('returns empty groups for a blank query', () => {
    const r = searchDocs('', DOCS);
    expect(totalResults(r)).toBe(0);
    const ws = searchDocs('   ', DOCS);
    expect(totalResults(ws)).toBe(0);
  });

  it('is case-insensitive and groups by kind', () => {
    const r = searchDocs('indus', DOCS);
    expect(r.subtopics.map((d) => d.id)).toContain('hist-ancient-ivc');
    expect(r.notes.map((d) => d.id)).toContain('n1');
    // "indus" doesn't appear in either MCQ question.
    expect(r.mcqs).toHaveLength(0);
  });

  it('matches question text for jump-to-question', () => {
    const r = searchDocs('mohenjo', DOCS);
    expect(r.notes.map((d) => d.id)).toContain('n2');
    expect(r.mcqs.map((d) => d.id)).toContain('m2');
  });

  it('requires ALL whitespace-separated terms to be present (AND)', () => {
    expect(totalResults(searchDocs('water fort', DOCS))).toBe(1);
    expect(totalResults(searchDocs('water gupta', DOCS))).toBe(0);
  });

  it('ranks a prefix/earlier match above a later one', () => {
    const r = searchDocs('gupta', DOCS);
    expect(r.subtopics[0]?.id).toBe('hist-ancient-guptas');
  });

  it('caps each group at the limit', () => {
    const many: SearchDoc[] = Array.from({ length: 20 }, (_, i) => ({
      kind: 'mcq',
      id: `q${i}`,
      title: `Question about topic ${i}`,
    }));
    const r = searchDocs('topic', many, 8);
    expect(r.mcqs).toHaveLength(8);
  });
});
