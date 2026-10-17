import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import stoneAgeFacts from '../../../content/facts/hist-ancient-stone-age.json';
import manifest from '../../../content/manifest.json';
import { FactsFileSchema, parseFacts, type FactsFile } from '../facts-types';
import {
  auditAllCompleteness,
  checkFactsCompleteness,
  completenessExitCode,
  estimateFactCount,
  missingKeyTokens,
  validateAllContent,
  type CompletenessContent,
} from '../validate';
import { getContentIndex, getFacts } from '../loader';

// The completeness machinery: the facts-file schema, the three per-fact checks
// (taught / drilled / high-yield MCQ), the backlog estimate, the regression
// gate's exit behaviour (pure + the real CLI on fixture content dirs), and the
// loader accessor.

const SID = 'demo-subtopic';

/** The Ancient India I unit — closed in the first completeness round. */
const ANCIENT_1 = [
  'hist-ancient-stone-age',
  'hist-ancient-ivc',
  'hist-ancient-early-vedic',
  'hist-ancient-later-vedic',
  'hist-ancient-mahajanapadas',
  'hist-ancient-rise-of-magadha',
  'hist-ancient-magadha-dynasties',
  'hist-ancient-jainism',
  'hist-ancient-buddhism-1',
  'hist-ancient-buddhism-2',
];

/** A minimal valid facts file around the given facts. */
function factsFile(facts: FactsFile['facts']): FactsFile {
  return { version: 1, subtopicId: SID, facts };
}

/** Fixture content: one note, one MCQ, one card. */
const CONTENT: CompletenessContent = {
  notes: [
    {
      id: 'n-sites',
      body: '**Gufkral** is a Neolithic site in **Kashmir**. Bhimbetka is in Madhya Pradesh.',
      keyPoints: ['Chirand (Bihar) is famous for bone tools.'],
    },
  ],
  mcqs: [
    {
      id: 'q-gufkral',
      question: 'Which Neolithic site is in Kashmir?',
      options: ['Gufkral', 'Maski', 'Chirand', 'Hallur'],
    },
  ],
  cards: [{ id: 'c-chirand', front: 'Neolithic site in Bihar known for bone tools?', back: 'Chirand.' }],
};

const gufkral = {
  id: 'gufkral',
  fact: 'Gufkral is a Neolithic site in Kashmir.',
  kind: 'place' as const,
  yield: 'high' as const,
  sources: ['source-text' as const],
  keys: ['Gufkral', 'Kashmir'],
  taughtIn: 'n-sites',
  drilledBy: ['q-gufkral'],
};

describe('facts-file schema', () => {
  it('accepts the seeded Stone Age fact universe', () => {
    const file = parseFacts(stoneAgeFacts);
    expect(file.subtopicId).toBe('hist-ancient-stone-age');
    expect(file.facts.length).toBeGreaterThan(100);
  });

  it('accepts a minimal fact without taughtIn/drilledBy/keys', () => {
    const ok = FactsFileSchema.safeParse(
      factsFile([{ id: 'a', fact: 'A fact sentence.', kind: 'term', yield: 'low', sources: ['standard'] }]),
    );
    expect(ok.success).toBe(true);
  });

  it.each([
    ['an unknown kind', { ...gufkral, kind: 'site' }],
    ['an unknown yield', { ...gufkral, yield: 'top' }],
    ['an unknown source', { ...gufkral, sources: ['wikipedia'] }],
    ['empty sources', { ...gufkral, sources: [] }],
    ['a non-kebab id', { ...gufkral, id: 'Gufkral Site' }],
    ['an unknown field', { ...gufkral, note: 'x' }],
  ])('rejects a fact with %s', (_label, fact) => {
    expect(FactsFileSchema.safeParse(factsFile([fact as never])).success).toBe(false);
  });

  it('rejects duplicate fact ids, an empty list and a missing version', () => {
    expect(FactsFileSchema.safeParse(factsFile([gufkral, gufkral])).success).toBe(false);
    expect(FactsFileSchema.safeParse(factsFile([])).success).toBe(false);
    expect(FactsFileSchema.safeParse({ subtopicId: SID, facts: [gufkral] }).success).toBe(false);
    expect(() => parseFacts({ version: 1 })).toThrow(/invalid facts file/);
  });
});

describe('completeness checks', () => {
  it('passes a fact that is taught and drilled by an MCQ (100/100/100)', () => {
    const r = checkFactsCompleteness(factsFile([gufkral]), CONTENT);
    expect(r.findings).toEqual([]);
    expect([r.taughtPct, r.drilledPct, r.highYieldMcqPct]).toEqual([100, 100, 100]);
  });

  it('(a) flags a TAUGHT miss: no taughtIn, unknown note, key tokens absent', () => {
    const r = checkFactsCompleteness(
      factsFile([
        { ...gufkral, id: 'no-note', taughtIn: undefined },
        { ...gufkral, id: 'bad-note', taughtIn: 'n-missing' },
        { ...gufkral, id: 'not-in-note', keys: ['Gufkral', 'Pulwama'] , drilledBy: ['q-gufkral'] },
      ]),
      CONTENT,
    );
    expect(r.findings.map((f) => [f.factId, f.rule])).toEqual(
      expect.arrayContaining([
        ['no-note', 'taught-missing'],
        ['bad-note', 'taught-unknown-note'],
        ['not-in-note', 'taught-tokens'],
      ]),
    );
    expect(r.taught).toBe(0);
    expect(r.taughtPct).toBe(0);
  });

  it('(b) flags a DRILLED miss: no drilledBy, unknown id, item lacks the key tokens', () => {
    const r = checkFactsCompleteness(
      factsFile([
        { ...gufkral, id: 'no-drill', drilledBy: undefined },
        { ...gufkral, id: 'bad-drill', drilledBy: ['q-nope'] },
        { ...gufkral, id: 'wrong-drill', drilledBy: ['c-chirand'] },
      ]),
      CONTENT,
    );
    expect(r.findings.map((f) => [f.factId, f.rule])).toEqual(
      expect.arrayContaining([
        ['no-drill', 'drilled-missing'],
        ['bad-drill', 'drilled-unknown-item'],
        ['wrong-drill', 'drilled-tokens'],
      ]),
    );
    expect(r.drilled).toBe(0);
    expect(r.taughtPct).toBe(100); // teaching is independent of drilling
  });

  it('(c) flags a HIGH-YIELD fact drilled only by a card; a medium one passes on a card', () => {
    const chirand = {
      id: 'chirand',
      fact: 'Chirand in Bihar is famous for bone tools.',
      kind: 'pair' as const,
      sources: ['source-text' as const],
      keys: ['Chirand', 'bone tools'],
      taughtIn: 'n-sites',
      drilledBy: ['c-chirand'],
    };
    const high = checkFactsCompleteness(factsFile([{ ...chirand, yield: 'high' }]), CONTENT);
    expect(high.findings.map((f) => f.rule)).toEqual(['high-yield-card-only']);
    expect([high.drilledPct, high.highYieldMcqPct]).toEqual([100, 0]);

    const medium = checkFactsCompleteness(factsFile([{ ...chirand, yield: 'medium' }]), CONTENT);
    expect(medium.findings).toEqual([]);
    expect(medium.highYieldMcqPct).toBe(100); // no high-yield facts → vacuously 100
  });

  it('does not read the MCQ explanation (the item must ASK for the fact)', () => {
    const mcqs = [{ id: 'q', question: 'Which site is famous for bone tools?', options: ['A', 'B'], explanation: 'Chirand.' }];
    const r = checkFactsCompleteness(
      factsFile([{ ...gufkral, keys: ['Chirand', 'bone tools'], taughtIn: 'n-sites', drilledBy: ['q'] }]),
      { ...CONTENT, mcqs },
    );
    expect(r.findings.map((f) => f.rule)).toContain('drilled-tokens');
  });

  it('matches keys case-insensitively at a word start, and derives tokens when keys are absent', () => {
    expect(missingKeyTokens({ fact: 'x', keys: ['microlith'] }, 'tiny microliths')).toEqual([]);
    expect(missingKeyTokens({ fact: 'x', keys: ['eran'] }, 'a veteran site')).toEqual(['eran']);
    expect(missingKeyTokens({ fact: 'x', keys: ['Thoms'] }, 'christian jurgensen thomsen')).toEqual([]);
    // Derived: >= half of the significant tokens of the fact sentence.
    expect(missingKeyTokens({ fact: 'Gufkral lies in Kashmir valley' }, 'gufkral kashmir')).toEqual([]);
    expect(missingKeyTokens({ fact: 'Gufkral lies in Kashmir valley' }, 'nothing relevant').length).toBeGreaterThan(0);
  });

  it('estimates backlog facts from distinct bolded terms + keyPoints, skipping labels', () => {
    const n = estimateFactCount([
      { id: 'a', body: '**In one line:** x. **Gufkral** and **gufkral** and **Kashmir**. **TL;DR**', keyPoints: ['k1', 'k2'] },
    ]);
    expect(n).toBe(2 + 2); // gufkral, kashmir + 2 keyPoints
  });
});

describe('completeness gate', () => {
  const row = (taughtPct: number, drilledPct: number, highYieldMcqPct = 100) => ({
    subtopicId: SID,
    subjectCode: 'HIST',
    order: 0,
    hasFacts: true,
    mcqs: 1,
    cards: 1,
    status: 'GAPS' as const,
    result: { facts: 1, taught: 1, drilled: 1, highYield: 0, highYieldMcq: 0, taughtPct, drilledPct, highYieldMcqPct, findings: [] },
  });

  it('exits 0 at 100/100 and when only backlog subtopics exist', () => {
    expect(completenessExitCode({ rows: [row(100, 100)], orphanFacts: [] })).toBe(0);
    expect(
      completenessExitCode({
        rows: [{ subtopicId: 'b', subjectCode: 'HIST', order: 1, hasFacts: false, mcqs: 0, cards: 0, estimate: 9, status: 'NO-FACTS' }],
        orphanFacts: [],
      }),
    ).toBe(0);
  });

  it('exits 1 when a closed subtopic drops below 100% taught or drilled, or a facts file is orphaned', () => {
    expect(completenessExitCode({ rows: [row(99, 100)], orphanFacts: [] })).toBe(1);
    expect(completenessExitCode({ rows: [row(100, 50)], orphanFacts: [] })).toBe(1);
    expect(completenessExitCode({ rows: [], orphanFacts: ['x'] })).toBe(1);
  });

  it('exits 1 when a closed subtopic has a high-yield fact without an MCQ (card-only is no longer a warning)', () => {
    // 100% taught and 100% drilled, but a high-yield fact is drilled only by a card.
    expect(completenessExitCode({ rows: [row(100, 100, 99)], orphanFacts: [] })).toBe(1);
    expect(completenessExitCode({ rows: [row(100, 100, 0)], orphanFacts: [] })).toBe(1);
    // End to end through the pure checker: a high-yield card-only fact fails, a medium one passes.
    const cardOnly = { ...gufkral, keys: ['Chirand', 'bone tools'], drilledBy: ['c-chirand'] };
    const asRow = (r: ReturnType<typeof checkFactsCompleteness>) => ({ ...row(r.taughtPct, r.drilledPct, r.highYieldMcqPct), result: r });
    const high = checkFactsCompleteness(factsFile([cardOnly]), CONTENT);
    expect([high.taughtPct, high.drilledPct]).toEqual([100, 100]);
    expect(completenessExitCode({ rows: [asRow(high)], orphanFacts: [] })).toBe(1);
    const medium = checkFactsCompleteness(factsFile([{ ...cardOnly, yield: 'medium' }]), CONTENT);
    expect(completenessExitCode({ rows: [asRow(medium)], orphanFacts: [] })).toBe(0);
  });

  it('the real repo content passes and every closed subtopic (incl. the Ancient India I unit) is COMPLETE', () => {
    const report = auditAllCompleteness();
    expect(completenessExitCode(report)).toBe(0);
    const closed = report.rows.filter((r) => r.hasFacts);
    expect(closed.length).toBe(getContentIndex().facts.size);
    for (const r of closed) expect(r.status, r.subtopicId).toBe('COMPLETE');
    for (const id of ANCIENT_1) expect(report.rows.find((r) => r.subtopicId === id)?.status, id).toBe('COMPLETE');
    // Floor: the closed set only ever grows (32 after completeness round 2, 55 after round 3, 76 after round 4).
    expect(closed.length).toBeGreaterThanOrEqual(76);
    // Rows are in study-plan order. Closure no longer proceeds strictly in study
    // order (round 2 closed POL/ECON/GEO/SCI/MENT units in parallel), so closed and
    // backlog rows interleave; each subset must still be in study order, and the
    // first backlog row is the first study-order subtopic with no facts file.
    const inOrder = (rs: typeof report.rows) => rs.every((r, i) => i === 0 || rs[i - 1]!.order <= r.order);
    expect(inOrder(report.rows)).toBe(true);
    const open = report.rows.filter((r) => !r.hasFacts);
    expect(inOrder(open)).toBe(true);
    expect(open[0]).toBe(report.rows.find((r) => !r.hasFacts));
  });
});

describe('audit:completeness CLI exit behaviour', () => {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const VITE_NODE = join(ROOT, 'node_modules', '.bin', 'vite-node');
  let tmp: string;

  /** Write a tiny content dir (notes + mcq + cards + facts) under tmp/<name>. */
  function fixture(name: string, drilledBy: string[], extraCards: CompletenessContent['cards'] = []): string {
    const dir = join(tmp, name);
    const bank = join(dir, 'history-ancient', SID);
    mkdirSync(bank, { recursive: true });
    mkdirSync(join(dir, 'facts'), { recursive: true });
    const base = { subjectCode: 'HIST', topic: 'Demo' };
    writeFileSync(
      join(bank, 'notes.json'),
      JSON.stringify({ kind: 'notes', ...base, items: CONTENT.notes.map((n) => ({ ...n, subjectCode: 'HIST', subtopicId: SID, title: 'T' })) }),
    );
    writeFileSync(
      join(bank, 'mcq.json'),
      JSON.stringify({ kind: 'mcq', ...base, items: CONTENT.mcqs.map((q) => ({ ...q, subjectCode: 'HIST', subtopicId: SID, answerIndex: 0 })) }),
    );
    writeFileSync(
      join(bank, 'cards.json'),
      JSON.stringify({ kind: 'cards', ...base, items: [...CONTENT.cards, ...extraCards].map((c) => ({ ...c, subjectCode: 'HIST', subtopicId: SID, verified: true })) }),
    );
    writeFileSync(join(dir, 'facts', `${SID}.json`), JSON.stringify(factsFile([{ ...gufkral, drilledBy }])));
    return dir;
  }

  const run = (dir: string, out: string) =>
    spawnSync(VITE_NODE, ['scripts/audit-completeness.ts', '--content-dir', dir, '--out', out], { cwd: ROOT, encoding: 'utf8' });

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'completeness-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('exits 0 and writes STATUS.md when every closed subtopic is 100/100', () => {
    const out = join(tmp, 'pass.md');
    const res = run(fixture('pass', ['q-gufkral']), out);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('COMPLETE');
    expect(readFileSync(out, 'utf8')).toContain('Gate: **PASS**');
  }, 60_000);

  it('exits non-zero when a closed subtopic is below 100% drilled', () => {
    const out = join(tmp, 'fail.md');
    const res = run(fixture('fail', ['q-unknown']), out);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain('drilled-unknown-item');
    expect(readFileSync(out, 'utf8')).toContain('Gate: **FAIL**');
  }, 60_000);

  it('exits non-zero when a closed high-yield fact is drilled only by a flashcard', () => {
    const out = join(tmp, 'card-only.md');
    const card = { id: 'c-gufkral', front: 'Neolithic site in Kashmir?', back: 'Gufkral.' };
    const res = run(fixture('card-only', ['c-gufkral'], [card]), out);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain('high-yield-card-only');
    expect(readFileSync(out, 'utf8')).toContain('Gate: **FAIL**');
  }, 60_000);
});

describe('facts loading + validation', () => {
  it('getFacts returns the seeded Stone Age universe and undefined elsewhere', () => {
    expect(getFacts('hist-ancient-stone-age')?.facts.length).toBe(stoneAgeFacts.facts.length);
    // A backlog subtopic (no facts file) returns undefined — computed, not hard-coded.
    const backlog = auditAllCompleteness().rows.find((r) => !r.hasFacts);
    expect(backlog).toBeDefined();
    expect(getFacts(backlog!.subtopicId)).toBeUndefined();
    for (const id of ANCIENT_1) expect(getFacts(id)?.facts.length, id).toBeGreaterThan(0);
    expect(getContentIndex().facts.size).toBeGreaterThanOrEqual(1);
  });

  it('validate:content passes the facts file and the manifest never lists content/facts', () => {
    const r = validateAllContent().find((x) => x.file === '/content/facts/hist-ancient-stone-age.json');
    expect(r?.ok).toBe(true);
    expect(manifest.banks.some((b) => b.path.startsWith('/content/facts/'))).toBe(false);
  });
});
