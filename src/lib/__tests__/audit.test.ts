import { describe, it, expect } from 'vitest';
import {
  computeAudit,
  isApText,
  isGenericKeyword,
  specificKeywords,
  GENERIC_STOPLIST,
  AP_TARGETS,
  mcqEvidenceText,
  noteEvidenceText,
  mainsEvidenceText,
  PRELIMS_MCQ_EVIDENCE_MIN,
  MAINS_MAINS_MIN,
  MAINS_NOTE_MIN,
  KEYWORD_COVERAGE_MIN,
  type EvidenceIndex,
  type SubtopicEvidence,
} from '../audit';
import type { SyllabusMap, PyqMap } from '../../content/audit-types';

/**
 * Unit tests for the PURE audit engine under the STRICT, honest rules
 * (see `.research/audit/E-review.md`):
 *   - only SPECIFIC keywords count (generic stoplist removed), matched on a
 *     WORD BOUNDARY (case-insensitive, never substring);
 *   - Prelims COVERED ⇔ ≥60% specific keywords each evidenced AND ≥3 MCQs;
 *   - Mains COVERED ⇔ ≥60% specific keywords across mains+notes AND ≥2 mains + ≥1 note;
 *   - otherwise THIN (some specific evidence) / MISSING (none, or no content);
 *   - PYQ HIT/NEAR/MISS is deterministic and specific-keyword-gated.
 * Everything is exercised with hand-built fixtures (no disk, no loader).
 */

/** Build a SubtopicEvidence quickly (lower-cased, like the real evidence index). */
function ev(
  subject: SubtopicEvidence['subject'],
  mcqTexts: string[],
  noteTexts: string[] = [],
  mainsTexts: string[] = [],
): SubtopicEvidence {
  return {
    subject,
    mcqTexts: mcqTexts.map((t) => t.toLowerCase()),
    noteTexts: noteTexts.map((t) => t.toLowerCase()),
    mainsTexts: mainsTexts.map((t) => t.toLowerCase()),
  };
}

describe('audit — thresholds', () => {
  it('exposes the strict thresholds the task requires', () => {
    expect(PRELIMS_MCQ_EVIDENCE_MIN).toBe(3);
    expect(MAINS_MAINS_MIN).toBe(2);
    expect(MAINS_NOTE_MIN).toBe(1);
    expect(KEYWORD_COVERAGE_MIN).toBeCloseTo(0.6);
  });
});

describe('audit — text builders', () => {
  it('mcqEvidenceText folds question/options/explanation/covers/tags to lower-case', () => {
    const text = mcqEvidenceText({
      question: 'Who founded the Maurya empire?',
      options: ['Ashoka', 'Chandragupta'],
      explanation: 'Chandragupta Maurya, guided by Kautilya.',
      covers: ['Mauryan admin'],
      tags: ['history'],
    });
    expect(text).toContain('maurya');
    expect(text).toContain('chandragupta');
    expect(text).toContain('kautilya');
    expect(text).toBe(text.toLowerCase());
  });

  it('note/mains builders read their respective fields', () => {
    expect(noteEvidenceText({ title: 'IVC', body: 'Harappa', keyPoints: ['Dholavira'] })).toContain('dholavira');
    expect(mainsEvidenceText({ question: 'Discuss', modelAnswer: 'Ashoka Dhamma' })).toContain('ashoka');
  });
});

describe('audit — generic stoplist', () => {
  it('flags stopwords case-insensitively and keeps specific terms', () => {
    expect(isGenericKeyword('State')).toBe(true);
    expect(isGenericKeyword('ETHICS')).toBe(true);
    expect(isGenericKeyword('governance')).toBe(true);
    expect(isGenericKeyword('Harappa')).toBe(false);
    expect(isGenericKeyword('Lokpal')).toBe(false);
  });

  it('specificKeywords() drops every stopword', () => {
    expect(specificKeywords(['State', 'features', 'Harappa', 'Mohenjo'])).toEqual(['Harappa', 'Mohenjo']);
    expect(GENERIC_STOPLIST.has('andhra')).toBe(true);
  });
});

describe('audit — AP detection', () => {
  it('flags strong AP terms, standalone AP, and river-context Krishna/Godavari', () => {
    expect(isApText('The capital was shifted to Amaravati.')).toBe(true);
    expect(isApText('Andhra Mahasabha met in 1913.')).toBe(true);
    expect(isApText('This is an AP-specific scheme.')).toBe(true);
    expect(isApText('The Krishna river delta is fertile.')).toBe(true);
  });

  it('does NOT flag the deity Krishna or unrelated text', () => {
    expect(isApText('Lord Krishna in the Mahabharata.')).toBe(false);
    expect(isApText('The Mughal empire under Akbar.')).toBe(false);
  });

  it('ignores APPSC citation noise so it does not inflate AP share', () => {
    expect(isApText('*Source: APPSC previous paper.*')).toBe(false);
  });
});

describe('audit — Prelims clause classification (strict)', () => {
  const evidence: EvidenceIndex = new Map<string, SubtopicEvidence>([
    // 3 MCQs, each carrying ≥1 specific keyword; 3/3 keywords evidenced → COVERED.
    ['sub-cov', ev('HIST', ['Harappa town planning', 'Mohenjo-daro seals', 'Indus script at Harappa'])],
    // Keywords hit 100% but only 2 MCQs carry evidence → THIN (fails the ≥3-MCQ gate).
    ['sub-2mcq', ev('HIST', ['Chandragupta Maurya', 'Ashoka Maurya', 'unrelated filler'])],
    // Only 1 specific keyword of 3 evidenced (33% < 60%), across 3 MCQs → THIN.
    ['sub-lowkw', ev('POL', ['Preamble of the constitution', 'Preamble again', 'Preamble once more'])],
    // Content present but NO specific keyword matches → MISSING (none).
    ['sub-nokw', ev('POL', ['totally unrelated', 'more filler', 'still nothing'])],
    // Word-boundary: "maurya" must NOT match inside "mauryan".
    ['sub-boundary', ev('HIST', ['the mauryan empire', 'mauryan administration', 'mauryan society'])],
    // Abundant generic words but the clause keywords are all generic → MISSING.
    ['sub-generic', ev('POL', ['the state and its features', 'state governance', 'state powers and features'])],
  ]);

  const syllabusMap: SyllabusMap = [
    { ref: 'P-COV', paper: 'prelims-1', clause: 'IVC', subtopicIds: ['sub-cov'], keywords: ['Harappa', 'Mohenjo', 'Indus'], apSpecific: false },
    { ref: 'P-2MCQ', paper: 'prelims-1', clause: 'Maurya', subtopicIds: ['sub-2mcq'], keywords: ['Maurya', 'Ashoka'], apSpecific: false },
    { ref: 'P-LOWKW', paper: 'prelims-1', clause: 'Constitution', subtopicIds: ['sub-lowkw'], keywords: ['Preamble', 'Sovereign', 'Republic'], apSpecific: false },
    { ref: 'P-NOKW', paper: 'prelims-1', clause: 'Rights', subtopicIds: ['sub-nokw'], keywords: ['Writs', 'Habeas'], apSpecific: false },
    { ref: 'P-BOUND', paper: 'prelims-1', clause: 'Boundary', subtopicIds: ['sub-boundary'], keywords: ['Maurya'], apSpecific: false },
    { ref: 'P-GEN', paper: 'prelims-1', clause: 'All generic', subtopicIds: ['sub-generic'], keywords: ['State', 'features', 'powers', 'governance'], apSpecific: false },
    { ref: 'P-EMPTY', paper: 'prelims-1', clause: 'Gap', subtopicIds: [], keywords: ['nothing'], apSpecific: false },
    { ref: 'P-UNKNOWN', paper: 'prelims-1', clause: 'Mapped but empty', subtopicIds: ['no-such'], keywords: ['x'], apSpecific: false },
  ];

  const report = computeAudit(syllabusMap, [], evidence);
  const byRef = new Map(report.clauses.map((c) => [c.ref, c]));

  it('COVERED needs ≥60% specific keywords AND ≥3 MCQs of evidence', () => {
    const c = byRef.get('P-COV')!;
    expect(c.status).toBe('COVERED');
    expect(c.mcqEvidence).toBeGreaterThanOrEqual(PRELIMS_MCQ_EVIDENCE_MIN);
    expect(c.keywordCoveragePct).toBe(100);
  });

  it('THIN when keywords are fully hit but fewer than 3 MCQs carry evidence', () => {
    const c = byRef.get('P-2MCQ')!;
    expect(c.status).toBe('THIN');
    expect(c.mcqEvidence).toBe(2);
  });

  it('THIN when < 60% of specific keywords are evidenced', () => {
    const c = byRef.get('P-LOWKW')!;
    expect(c.status).toBe('THIN');
    expect(c.keywordCoveragePct).toBeLessThan(60);
  });

  it('MISSING when content exists but no specific keyword is evidenced', () => {
    expect(byRef.get('P-NOKW')!.status).toBe('MISSING');
  });

  it('matches keywords on WORD BOUNDARIES (Maurya ≠ Mauryan) → MISSING here', () => {
    const c = byRef.get('P-BOUND')!;
    expect(c.mcqEvidence).toBe(0);
    expect(c.status).toBe('MISSING');
  });

  it('IGNORES generic stopwords entirely (all-generic clause → MISSING)', () => {
    const c = byRef.get('P-GEN')!;
    expect(c.specificKeywords).toEqual([]);
    expect(c.status).toBe('MISSING');
  });

  it('MISSING when a clause maps to no content (empty or unknown ids)', () => {
    expect(byRef.get('P-EMPTY')!.status).toBe('MISSING');
    expect(byRef.get('P-UNKNOWN')!.status).toBe('MISSING');
  });
});

describe('audit — Mains clause classification (strict)', () => {
  const evidence: EvidenceIndex = new Map<string, SubtopicEvidence>([
    // ≥2 mains + ≥1 note, 2/2 specific keywords across the pool → COVERED.
    ['m-cov', ev('POL', [], ['integrity in public service'], ['discuss integrity and probity', 'probity essay'])],
    // Keywords fine but only 1 mains item → THIN (fails ≥2 mains).
    ['m-1mains', ev('POL', [], ['note on labour codes'], ['discuss the labour code and wages'])],
    // ≥2 mains + note present, but only 40% of specific keywords evidenced → THIN.
    ['m-lowkw', ev('POL', [], ['a note mentioning wages'], ['essay on wages', 'another on wages'])],
    // Items present but no specific keyword matched anywhere → MISSING.
    ['m-nokw', ev('POL', [], ['unrelated note'], ['unrelated essay', 'more filler'])],
  ]);

  const syllabusMap: SyllabusMap = [
    { ref: 'M-COV', paper: 'mains-3', clause: 'Probity', subtopicIds: ['m-cov'], keywords: ['integrity', 'probity'], apSpecific: false },
    { ref: 'M-1MAINS', paper: 'mains-3', clause: 'Labour', subtopicIds: ['m-1mains'], keywords: ['labour', 'code'], apSpecific: false },
    { ref: 'M-LOWKW', paper: 'mains-3', clause: 'Labour codes', subtopicIds: ['m-lowkw'], keywords: ['labour', 'code', 'wages', 'factories', 'ESI'], apSpecific: false },
    { ref: 'M-NOKW', paper: 'mains-3', clause: 'Ethics', subtopicIds: ['m-nokw'], keywords: ['Lokpal', 'corruption'], apSpecific: false },
  ];

  const report = computeAudit(syllabusMap, [], evidence);
  const byRef = new Map(report.clauses.map((c) => [c.ref, c]));

  it('COVERED needs ≥60% specific keywords AND ≥2 mains + ≥1 note', () => {
    const c = byRef.get('M-COV')!;
    expect(c.status).toBe('COVERED');
    expect(c.mainsEvidence).toBeGreaterThanOrEqual(1);
    expect(c.noteEvidence).toBe(1);
  });

  it('THIN when it lacks a second mains item even with a note and keywords', () => {
    expect(byRef.get('M-1MAINS')!.status).toBe('THIN');
  });

  it('THIN when < 60% of specific keywords are evidenced', () => {
    const c = byRef.get('M-LOWKW')!;
    expect(c.status).toBe('THIN');
    expect(c.keywordCoveragePct).toBeLessThan(60);
  });

  it('MISSING when items exist but no specific keyword is evidenced', () => {
    expect(byRef.get('M-NOKW')!.status).toBe('MISSING');
  });
});

describe('audit — roll-ups and gate inputs', () => {
  const evidence: EvidenceIndex = new Map<string, SubtopicEvidence>([
    ['s-cov', ev('HIST', ['Harappa one', 'Harappa two', 'Harappa three'])],
    ['s-thin', ev('HIST', ['Harappa only once', 'filler', 'filler two'])],
    ['s-miss', ev('POL', ['nothing here', 'or here'])],
  ]);
  const syllabusMap: SyllabusMap = [
    { ref: 'A', paper: 'prelims-1', clause: 'cov', subtopicIds: ['s-cov'], keywords: ['Harappa'], apSpecific: false },
    { ref: 'B', paper: 'prelims-1', clause: 'thin', subtopicIds: ['s-thin'], keywords: ['Harappa'], apSpecific: false },
    { ref: 'C', paper: 'prelims-1', clause: 'miss', subtopicIds: ['s-miss'], keywords: ['Dholavira'], apSpecific: false },
    { ref: 'D', paper: 'prelims-1', clause: 'gap', subtopicIds: [], keywords: ['x'], apSpecific: false },
  ];
  const report = computeAudit(syllabusMap, [], evidence);

  it('rolls up per-paper covered/thin/missing and prelims percent', () => {
    const p1 = report.papers.find((p) => p.paper === 'prelims-1')!;
    expect(p1).toMatchObject({ total: 4, covered: 1, thin: 1, missing: 2 });
    // 1 covered of 4 → 25%.
    expect(report.prelimsTraceabilityPct).toBe(25);
  });

  it('collects everything not COVERED into thinMissing', () => {
    expect(report.thinMissing.map((c) => c.ref).sort()).toEqual(['B', 'C', 'D']);
  });
});

describe('audit — PYQ classification (deterministic, specific-gated)', () => {
  const evidence: EvidenceIndex = new Map<string, SubtopicEvidence>([
    ['sub-hit', ev('SCI', ['ISRO launched PSLV', 'ISRO satellite mission', 'DRDO missile'])],
    ['sub-near', ev('MENT', ['A single direction-sense puzzle'])],
    ['sub-miss', ev('GEO', ['Totally unrelated content'])],
    ['sub-generic', ev('POL', ['the state and its policy', 'more about the state'])],
  ]);
  const pyqMap: PyqMap = [
    { years: [2023], paper: 'prelims-2', subject: 'Sci&Tech', gist: 'ISRO missions', keywords: ['ISRO'], subtopicId: 'sub-hit' },
    { years: [2024], paper: 'prelims-2', subject: 'Mental Ability', gist: 'Direction', keywords: ['direction'], subtopicId: 'sub-near' },
    { years: [2019], paper: 'prelims-1', subject: 'Geography', gist: 'Rivers', keywords: ['himalaya'], subtopicId: 'sub-miss' },
    { years: [2019], paper: 'prelims-1', subject: 'X', gist: 'unknown subtopic', keywords: ['x'], subtopicId: 'no-such' },
    { years: [2019], paper: 'prelims-1', subject: 'Y', gist: 'only generic keywords', keywords: ['State', 'policy'], subtopicId: 'sub-generic' },
  ];

  const report = computeAudit([], pyqMap, evidence);

  it('classifies HIT (≥2 MCQs), NEAR (exactly 1), MISS (0 / unknown)', () => {
    const byId = new Map(report.pyqResults.map((p) => [p.subtopicId, p]));
    expect(byId.get('sub-hit')!.status).toBe('HIT');
    expect(byId.get('sub-near')!.status).toBe('NEAR');
    expect(byId.get('sub-miss')!.status).toBe('MISS');
    expect(byId.get('no-such')!.status).toBe('MISS');
  });

  it('MISS when a topic has only generic keywords (nothing specific to evidence)', () => {
    const byId = new Map(report.pyqResults.map((p) => [p.subtopicId, p]));
    expect(byId.get('sub-generic')!.status).toBe('MISS');
  });

  it('summarises hit/near/miss and the hit percent', () => {
    expect(report.pyq).toMatchObject({ total: 5, hit: 1, near: 1, miss: 3, hitPct: 20 });
  });
});

describe('audit — AP share per subject', () => {
  it('computes AP items / total items per subject over all item kinds', () => {
    const evidence: EvidenceIndex = new Map<string, SubtopicEvidence>([
      ['g1', ev('GEO', ['Krishna river delta', 'The Alps in Europe'])], // 1 of 2 AP
      ['h1', ev('HIST', [], ['Kakatiya dynasty of Warangal'], ['A note on the Mughals'])], // 1 of 2 AP
    ]);
    const report = computeAudit([], [], evidence);
    const geo = report.apShareBySubject.find((a) => a.subject === 'GEO')!;
    expect(geo).toMatchObject({ apItems: 1, totalItems: 2, pct: 50 });
    const hist = report.apShareBySubject.find((a) => a.subject === 'HIST')!;
    expect(hist).toMatchObject({ apItems: 1, totalItems: 2, pct: 50 });
  });
});

describe('audit — AP-share target floors', () => {
  it('exposes the required per-subject AP-share floors', () => {
    expect(AP_TARGETS).toMatchObject({ CA: 42, ECON: 28, GEO: 35, HIST: 25, POL: 20, SCI: 24 });
    // AP-neutral subjects are exempt (no floor).
    expect(AP_TARGETS.MENT).toBeUndefined();
    expect(AP_TARGETS.TEL).toBeUndefined();
    expect(AP_TARGETS.ENG).toBeUndefined();
  });

  it('attaches target + meetsTarget and collects sub-floor subjects into apTargetFailures', () => {
    const evidence: EvidenceIndex = new Map<string, SubtopicEvidence>([
      // HIST: 1 of 2 AP = 50% ≥ 25% floor → meets.
      ['h1', ev('HIST', ['Kakatiya Warangal', 'The Mughals'])],
      // POL: 0 of 3 AP = 0% < 20% floor → BELOW.
      ['p1', ev('POL', ['generic one', 'generic two', 'generic three'])],
      // MENT: exempt (no floor) even at 0% AP.
      ['m1', ev('MENT', ['a ratio puzzle'])],
    ]);
    const report = computeAudit([], [], evidence);
    const bySub = new Map(report.apShareBySubject.map((a) => [a.subject, a]));

    expect(bySub.get('HIST')).toMatchObject({ target: 25, meetsTarget: true });
    expect(bySub.get('POL')).toMatchObject({ pct: 0, target: 20, meetsTarget: false });
    // Exempt subject: null floor, always "meets".
    expect(bySub.get('MENT')).toMatchObject({ target: null, meetsTarget: true });

    expect(report.apTargetFailures.map((a) => a.subject)).toEqual(['POL']);
  });

  it('reports no failures when every subject with a floor clears it', () => {
    const evidence: EvidenceIndex = new Map<string, SubtopicEvidence>([
      // CA: 1 of 1 AP = 100% ≥ 42% floor.
      ['c1', ev('CA', ['Amaravati capital scheme'])],
    ]);
    const report = computeAudit([], [], evidence);
    expect(report.apTargetFailures).toEqual([]);
  });
});
