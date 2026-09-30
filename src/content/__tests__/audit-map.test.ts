import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSyllabusMap } from '../audit-types';
import { parseTaxonomy } from '../taxonomy';

/**
 * Structural audit-map tests over the REAL authored files on disk. These guard
 * the wiring the pure engine can't see on its own: that no Prelims-track
 * subtopic is left orphaned (unreferenced by any syllabus-map clause), which
 * would make it invisible to the coverage audit. Reads the JSON directly with
 * `node:fs` so it exercises exactly what ships in `content/`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..', '..');
const readJson = (rel: string): unknown => JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'));

const taxonomy = parseTaxonomy(readJson('content/taxonomy.json'));
const syllabusMap = parseSyllabusMap(readJson('content/audit/syllabus-map.json'));

/** Effective exam track of a subtopic: its own override, else its subject's track. */
function effectiveTrack(subjectCode: string, override?: string): string | undefined {
  if (override) return override;
  return taxonomy.subjects.find((s) => s.code === subjectCode)?.track;
}

describe('audit map — no orphan Prelims-track subtopics', () => {
  const referenced = new Set<string>();
  for (const clause of syllabusMap) for (const id of clause.subtopicIds) referenced.add(id);

  const prelimsSubtopics = taxonomy.subtopics.filter((s) => {
    const track = effectiveTrack(s.subjectCode, s.track);
    return track === 'paper1' || track === 'paper2';
  });

  it('references every Prelims-track subtopic in ≥1 clause', () => {
    const orphans = prelimsSubtopics.filter((s) => !referenced.has(s.id)).map((s) => s.id);
    expect(orphans).toEqual([]);
  });

  it('has Prelims-track subtopics to check (guards against a vacuous pass)', () => {
    expect(prelimsSubtopics.length).toBeGreaterThan(0);
  });
});

describe('audit map — every clause subtopic id exists in the taxonomy', () => {
  const validIds = new Set(taxonomy.subtopics.map((s) => s.id));

  it('maps only to real taxonomy subtopic ids', () => {
    const unknown = new Set<string>();
    for (const clause of syllabusMap) {
      for (const id of clause.subtopicIds) if (!validIds.has(id)) unknown.add(`${clause.ref}:${id}`);
    }
    expect([...unknown]).toEqual([]);
  });
});
