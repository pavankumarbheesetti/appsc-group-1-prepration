import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QualityWaiversSchema } from '../audit-types';
import {
  auditAllQuality,
  checkBankQuality,
  checkItemQuality,
  isAllCorrectKey,
  isStatementItem,
  qualityEnabled,
  qualityExitCode,
  renderedStem,
  statementKeyCode,
  type QualityItem,
} from '../validate';

// The question-quality machinery (.research/plan/QUESTION-QUALITY.md): every
// item rule and bank rule with a positive and a negative fixture, the waivers
// schema, waiver application + staleness, and the audit:quality CLI exit code.

const STEM = 'Which ruler of the Satavahana dynasty performed the Ashvamedha sacrifice twice?';
const OPTS = [
  'Gautamiputra Satakarni',
  'Vasishthiputra Pulumavi',
  'Yajna Sri Satakarni',
  'Simuka of Pratishthana',
];

let seq = 0;
/** A clean single-answer prose item (passes every item rule). */
function item(over: Partial<QualityItem> = {}): QualityItem {
  seq += 1;
  return { id: `q-${seq}`, question: STEM, options: OPTS, answerIndex: 0, ...over };
}

/** A three-statement item keyed by `key` (options are the usual codes). */
function stmt(key: string, over: Partial<QualityItem> = {}): QualityItem {
  const options = ['1 only', '2 and 3 only', '1 and 3 only', '1, 2 and 3'];
  if (!options.includes(key)) options[3] = key;
  return item({
    question:
      'Consider the following statements about the Satavahanas:\nWhich of the statements given above is/are correct?',
    statements: [
      'They issued lead coins.',
      'They patronised Buddhism.',
      'Their official language was Prakrit.',
    ],
    options,
    answerIndex: options.indexOf(key),
    ...over,
  });
}

/** `n` clean items with keys cycling A, B, C, D. */
function balanced(n: number): QualityItem[] {
  return Array.from({ length: n }, (_, i) => item({ answerIndex: i % 4 }));
}

const rulesOf = (q: QualityItem) => checkItemQuality(q).map((f) => f.rule);
const bankRules = (items: QualityItem[]) =>
  Object.keys(checkBankQuality('/content/x/mcq-x.json', 'HIST', items).violations);

describe('item rules', () => {
  it('a clean exam item has no findings', () => {
    expect(checkItemQuality(item())).toEqual([]);
  });

  it('stem-short: flags a bare stem, passes a full one; the rendered stem includes statements', () => {
    expect(rulesOf(item({ question: 'Capital of Andhra Pradesh?' }))).toContain('stem-short');
    expect(rulesOf(item())).not.toContain('stem-short');
    const s = stmt('1 only', { question: 'Consider:\nWhich of the above is/are correct?' });
    expect(renderedStem(s).length).toBeGreaterThanOrEqual(45);
    expect(rulesOf(s)).not.toContain('stem-short');
  });

  it('stem-prompt: a statement item must ask "Which of the above …?"', () => {
    expect(
      rulesOf(
        stmt('1 only', { question: 'Consider the following statements about the Satavahanas:' }),
      ),
    ).toContain('stem-prompt');
    expect(rulesOf(stmt('1 only'))).not.toContain('stem-prompt');
    expect(
      rulesOf(stmt('1 only', { question: 'How many of the statements given above are correct?' })),
    ).not.toContain('stem-prompt');
  });

  it('option-length: flags a key far longer than the rest; exempts short names, numerals and codes', () => {
    const long = item({
      options: [
        'Simuka',
        'Hala',
        'Gautamiputra Satakarni, who defeated the Kshaharata Nahapana',
        'Krishna',
      ],
    });
    expect(rulesOf(long)).toContain('option-length');
    expect(rulesOf(item())).not.toContain('option-length');
    expect(rulesOf(item({ options: ['Goa', 'Maharashtra', 'Bihar', 'Kerala'] }))).not.toContain(
      'option-length',
    );
    expect(rulesOf(item({ options: ['5', '120 km/h', '1,250', '7.5%'] }))).not.toContain(
      'option-length',
    );
    expect(rulesOf(stmt('1 only'))).not.toContain('option-length');
  });

  it('option-duplicate: flags options identical after normalising, passes distinct ones', () => {
    expect(
      rulesOf(
        item({
          options: [
            'Gautamiputra Satakarni',
            'gautamiputra  satakarni.',
            'Simuka of Pratishthana',
            'Hala the poet-king',
          ],
        }),
      ),
    ).toContain('option-duplicate');
    expect(rulesOf(item())).not.toContain('option-duplicate');
  });

  it('option-filler: flags None/All of the above, passes real options', () => {
    expect(rulesOf(item({ options: [...OPTS.slice(0, 3), 'None of the above'] }))).toContain(
      'option-filler',
    );
    expect(rulesOf(item({ options: [...OPTS.slice(0, 3), 'All of these'] }))).toContain(
      'option-filler',
    );
    expect(rulesOf(item())).not.toContain('option-filler');
  });

  it('option-absolute: flags distractor-only absolutes, passes when the key shares them or none use them', () => {
    const opts = [
      'It is usually decided by the Speaker',
      'It is always decided by the President',
      'It is never referred to a committee',
      'It is decided solely by the Rajya Sabha',
    ];
    expect(rulesOf(item({ options: opts, answerIndex: 0 }))).toContain('option-absolute');
    expect(rulesOf(item({ options: opts, answerIndex: 1 }))).not.toContain('option-absolute');
    expect(rulesOf(item())).not.toContain('option-absolute');
  });
});

describe('statement classification and all-correct keys', () => {
  it('recognises statement items; numericals and ordering items are not', () => {
    expect(isStatementItem(stmt('1 only'))).toBe(true);
    expect(
      isStatementItem(
        item({
          question: 'Lok Sabha and Assembly seats of residuary Andhra Pradesh are, respectively:',
          options: ['17 and 119', '25 and 175', '42 and 294', '20 and 147'],
        }),
      ),
    ).toBe(false);
    expect(
      isStatementItem(
        stmt('1 only', { options: ['1 - 2 - 3', '2 - 1 - 3', '3 - 2 - 1', '1 - 3 - 2'] }),
      ),
    ).toBe(false);
    expect(
      isStatementItem(
        item({
          question: 'Consider the following statements:\n1. A\n2. B\n3. C\nWhich are correct?',
          options: ['1 only', '2 only', '1 and 3 only', '1, 2 and 3'],
        }),
      ),
    ).toBe(true);
  });

  it('all-correct: every statement named / Both on two / All three / All of the above', () => {
    expect(isAllCorrectKey(stmt('1, 2 and 3'))).toBe(true);
    expect(isAllCorrectKey(stmt('All three'))).toBe(true);
    expect(isAllCorrectKey(stmt('1 and 3 only'))).toBe(false);
    expect(
      isAllCorrectKey(stmt('Both 1 and 2', { statements: ['A is true.', 'B is true.'] })),
    ).toBe(true);
    // "1, 2 and 3 only" on FOUR statements is a subset, not all-correct.
    expect(isAllCorrectKey(stmt('1, 2 and 3 only', { statements: ['a', 'b', 'c', 'd'] }))).toBe(
      false,
    );
    expect(
      isAllCorrectKey(item({ options: [...OPTS.slice(0, 3), 'All of the above'], answerIndex: 3 })),
    ).toBe(true);
    expect(isAllCorrectKey(item())).toBe(false);
  });

  it('normalises keys for the variety rule', () => {
    expect(statementKeyCode(stmt('1 and 3 only'))).toBe('1,3');
    expect(statementKeyCode(stmt('Neither 1 nor 2'))).toBe('none');
    expect(statementKeyCode(stmt('Only two'))).toBe('count-2');
    expect(statementKeyCode(stmt('1, 2 and 3'))).toBe('all');
  });
});

describe('bank rules', () => {
  /** 10 statement items with varied keys, `all` of them keyed all-correct. */
  const statementBank = (all: number): QualityItem[] => {
    const varied = [
      '1 only',
      '2 and 3 only',
      '1 and 3 only',
      'Neither 1 nor 2',
      '1 only',
      '2 and 3 only',
      '1 and 3 only',
      'Neither 1 nor 2',
      '1 only',
      '2 and 3 only',
    ];
    return varied.map((k, i) => stmt(i < all ? '1, 2 and 3' : k));
  };

  it('all-correct-share: > 20% of statement items keyed all-correct fails; <= 20% passes', () => {
    expect(bankRules(statementBank(3))).toContain('all-correct-share');
    expect(bankRules(statementBank(2))).not.toContain('all-correct-share');
    // Small statement sets (< 5) may hold exactly one.
    expect(bankRules([stmt('1, 2 and 3'), stmt('1 only'), stmt('2 and 3 only')])).not.toContain(
      'all-correct-share',
    );
    expect(bankRules([stmt('1, 2 and 3'), stmt('1, 2 and 3'), stmt('2 and 3 only')])).toContain(
      'all-correct-share',
    );
  });

  it('answer-spread: each option 20–30% for banks >= 30 items', () => {
    expect(bankRules(balanced(40))).not.toContain('answer-spread');
    const skewed = balanced(40).map((q, i) => (i < 8 ? { ...q, answerIndex: 1 } : q)); // B ≈ 40%
    expect(bankRules(skewed)).toContain('answer-spread');
  });

  it('answer-spread: small banks (< 30) use the 18–32% tolerance', () => {
    // 20 items, 6/5/5/4 → 30/25/25/20: inside both bands.
    const ok = balanced(20).map((q, i) => (i === 3 ? { ...q, answerIndex: 0 } : q));
    expect(bankRules(ok)).not.toContain('answer-spread');
    // 22 items as 7/5/5/5 → 31.8% A: outside 20–30 but inside 18–32 → passes as a small bank.
    const small = [...balanced(20), item({ answerIndex: 0 }), item({ answerIndex: 1 })].map(
      (q, i) => (i === 21 ? { ...q, answerIndex: 0 } : q),
    );
    expect(bankRules(small)).not.toContain('answer-spread');
    // 20 items as 7/5/4/4 → 35% A: outside the tolerance.
    const bad = balanced(20).map((q, i) => (i === 2 || i === 3 ? { ...q, answerIndex: 0 } : q));
    expect(bankRules(bad)).toContain('answer-spread');
  });

  it('key-variety: uniform statement keys fail, varied keys pass', () => {
    expect(bankRules(statementBank(2))).not.toContain('key-variety');
    const uniform = Array.from({ length: 8 }, (_, i) =>
      stmt(i % 2 ? '1 and 3 only' : '2 and 3 only'),
    );
    expect(bankRules(uniform)).toContain('key-variety'); // 2 distinct, top 50%
    const noSingle = Array.from({ length: 10 }, (_, i) =>
      stmt(['1 and 3 only', '2 and 3 only', '1, 2 and 3', '1 and 2 only'][i % 4]!),
    );
    expect(
      checkBankQuality('/content/x.json', 'HIST', noSingle).findings.find(
        (f) => f.rule === 'key-variety',
      )?.detail,
    ).toContain('no "N only"');
    expect(bankRules([stmt('1 only'), stmt('1 only'), stmt('1 only')])).toContain('key-variety');
  });

  it('reports items, spread, all-correct share and violations by rule', () => {
    const b = checkBankQuality('/content/x.json', 'HIST', [
      ...balanced(4),
      stmt('1, 2 and 3'),
      item({ question: 'Too short?' }),
    ]);
    expect(b.items).toBe(6);
    expect(b.spread.reduce((a, c) => a + c, 0)).toBe(6);
    expect(b.statementItems).toBe(1);
    expect(b.allCorrect).toBe(1);
    expect(b.shortStems).toBe(1);
    expect(b.violations['stem-short']).toBe(1);
  });
});

describe('quality waivers schema + switch', () => {
  const base = { version: 1, source: 'test waivers' };
  it('accepts a valid waivers file (optional rules)', () => {
    expect(
      QualityWaiversSchema.safeParse({
        ...base,
        waivers: [{ bank: '/content/a/mcq-a.json', why: 'baseline — pending fix' }],
      }).success,
    ).toBe(true);
    expect(
      QualityWaiversSchema.safeParse({
        ...base,
        waivers: [
          {
            bank: '/content/a/mcq-a.json',
            rules: ['answer-spread'],
            why: 'baseline — pending fix',
          },
        ],
      }).success,
    ).toBe(true);
  });
  it('rejects bad paths, unknown rules, waiver-stale, short why, duplicates and extra keys', () => {
    const w = { bank: '/content/a/mcq-a.json', why: 'baseline — pending fix' };
    for (const bad of [
      { ...w, bank: 'content/a.json' },
      { ...w, rules: ['made-up'] },
      { ...w, rules: ['waiver-stale'] },
      { ...w, why: 'short' },
      { ...w, extra: true },
    ]) {
      expect(QualityWaiversSchema.safeParse({ ...base, waivers: [bad] }).success).toBe(false);
    }
    expect(QualityWaiversSchema.safeParse({ ...base, waivers: [w, w] }).success).toBe(false);
  });
  it('is ON by default (permanent gate); only VALIDATE_QUALITY=0 opts out', () => {
    expect(qualityEnabled({})).toBe(true);
    expect(qualityEnabled({ VALIDATE_QUALITY: '0' })).toBe(false);
    expect(qualityEnabled({ VALIDATE_QUALITY: '1' })).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Fixture content dirs: auditAllQuality + the audit:quality CLI               */
/* -------------------------------------------------------------------------- */

describe('auditAllQuality + audit:quality CLI', () => {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const VITE_NODE = join(ROOT, 'node_modules', '.bin', 'vite-node');
  const GOOD = '/content/history-ap/good/mcq-good.json';
  const BAD = '/content/history-ap/bad/mcq-bad.json';
  let tmp: string;

  /** A content dir with a clean bank and a bad (skewed, short-stem) bank, plus optional waivers. */
  function fixture(name: string, waivers?: unknown): string {
    const dir = join(tmp, name);
    const write = (glob: string, items: QualityItem[]) => {
      const abs = join(dir, glob.replace(/^\/content\//, ''));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(
        abs,
        JSON.stringify({
          kind: 'mcq',
          subjectCode: 'HIST',
          topic: 'Demo',
          items: items.map((q) => ({ ...q, subjectCode: 'HIST' })),
        }),
      );
    };
    write(GOOD, balanced(20));
    write(
      BAD,
      balanced(20).map((q, i) => ({
        ...q,
        answerIndex: i < 12 ? 0 : q.answerIndex,
        ...(i === 0 ? { question: 'Too short?' } : {}),
      })),
    );
    if (waivers !== undefined) {
      mkdirSync(join(dir, 'audit'), { recursive: true });
      writeFileSync(join(dir, 'audit', 'quality-waivers.json'), JSON.stringify(waivers));
    }
    return dir;
  }
  const waiversFor = (...entries: { bank: string; rules?: string[] }[]) => ({
    version: 1,
    source: 'fixture',
    waivers: entries.map((e) => ({ ...e, why: 'baseline — pending fix' })),
  });
  const run = (dir: string, out: string, ...extra: string[]) =>
    spawnSync(
      VITE_NODE,
      ['scripts/audit-quality.ts', '--content-dir', dir, '--out', out, ...extra],
      { cwd: ROOT, encoding: 'utf8' },
    );

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'quality-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('orders banks worst-first and applies waivers', () => {
    const none = auditAllQuality(fixture('order'));
    expect(none.banks.map((b) => b.file)).toEqual([BAD, GOOD]);
    expect(none.banks[1]!.findings).toEqual([]);
    expect(qualityExitCode(none)).toBe(1);

    const waived = auditAllQuality(fixture('waived', waiversFor({ bank: BAD })));
    expect(waived.findings.every((f) => f.waived)).toBe(true);
    expect(qualityExitCode(waived)).toBe(0);
  });

  it('a rule-scoped waiver leaves the other rules failing', () => {
    const r = auditAllQuality(
      fixture('scoped', waiversFor({ bank: BAD, rules: ['answer-spread'] })),
    );
    expect(r.findings.find((f) => f.rule === 'answer-spread')?.waived).toBe(true);
    expect(r.findings.find((f) => f.rule === 'stem-short')?.waived).toBe(false);
    expect(qualityExitCode(r)).toBe(1);
  });

  it('flags stale waivers (clean bank, unknown bank) and an invalid waivers file', () => {
    const r = auditAllQuality(
      fixture(
        'stale',
        waiversFor({ bank: BAD }, { bank: GOOD }, { bank: '/content/nope/mcq-nope.json' }),
      ),
    );
    const stale = r.findings.filter((f) => f.rule === 'waiver-stale').map((f) => f.itemId);
    expect(stale.sort()).toEqual(['/content/nope/mcq-nope.json', GOOD].sort());
    expect(qualityExitCode(r)).toBe(1);
    const invalid = auditAllQuality(fixture('invalid', { version: 1, waivers: [] }));
    expect(invalid.waiverErrors.length).toBeGreaterThan(0);
    expect(qualityExitCode(invalid)).toBe(1);
  });

  it('CLI exits 1 on an un-waived finding and still writes BASELINE.md', () => {
    const out = join(tmp, 'fail.md');
    const res = run(fixture('cli-fail'), out);
    expect(res.status).toBe(1);
    const md = readFileSync(out, 'utf8');
    expect(md).toContain('Gate: **FAIL**');
    expect(md.indexOf('history-ap/bad')).toBeLessThan(md.indexOf('history-ap/good'));
    expect(md).toContain('## Per subject');
  }, 60_000);

  it('CLI exits 0 when every finding is waived', () => {
    const out = join(tmp, 'pass.md');
    const res = run(fixture('cli-pass', waiversFor({ bank: BAD })), out);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('gate passed');
    expect(readFileSync(out, 'utf8')).toContain('Gate: **PASS**');
  }, 60_000);

  it('CLI exits 1 on a stale waiver', () => {
    const res = run(
      fixture('cli-stale', waiversFor({ bank: BAD }, { bank: GOOD })),
      join(tmp, 'stale.md'),
    );
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('waiver-stale');
  }, 60_000);

  it('strict: waived findings fail (qualityExitCode + CLI --strict)', () => {
    const waived = auditAllQuality(fixture('strict-waived', waiversFor({ bank: BAD })));
    expect(qualityExitCode(waived)).toBe(0);
    expect(qualityExitCode(waived, true)).toBe(1);
    const res = run(fixture('cli-strict', waiversFor({ bank: BAD })), join(tmp, 'strict.md'), '--strict');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('strict');
  }, 60_000);

  it('CLI --strict passes a clean content dir with no waivers', () => {
    const dir = join(tmp, 'strict-clean');
    mkdirSync(join(dir, 'history-ap', 'good'), { recursive: true });
    writeFileSync(
      join(dir, 'history-ap', 'good', 'mcq-good.json'),
      JSON.stringify({
        kind: 'mcq',
        subjectCode: 'HIST',
        topic: 'Demo',
        items: balanced(20).map((q) => ({ ...q, subjectCode: 'HIST' })),
      }),
    );
    const res = run(dir, join(tmp, 'strict-clean.md'), '--strict');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('strict: 0 findings, 0 waivers');
  }, 60_000);

  it('--seed-waivers waives exactly the failing banks and then passes', () => {
    const dir = fixture('cli-seed');
    const res = run(dir, join(tmp, 'seed.md'), '--seed-waivers');
    expect(res.status).toBe(0);
    const path = join(dir, 'audit', 'quality-waivers.json');
    expect(existsSync(path)).toBe(true);
    const doc = QualityWaiversSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    expect(doc.waivers.map((w) => w.bank)).toEqual([BAD]);
  }, 60_000);
});

/* -------------------------------------------------------------------------- */
/* The REAL content: quality is a permanent gate                              */
/* -------------------------------------------------------------------------- */

describe('real content: question-quality permanent gate', () => {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

  it('content/audit/quality-waivers.json is valid and EMPTY (no bank may be waived)', () => {
    const doc = QualityWaiversSchema.parse(
      JSON.parse(readFileSync(join(ROOT, 'content', 'audit', 'quality-waivers.json'), 'utf8')),
    );
    expect(doc.waivers).toEqual([]);
  });

  it('every real MCQ bank has 0 quality findings (strict exit 0)', () => {
    const r = auditAllQuality(join(ROOT, 'content'));
    expect(r.banks.length).toBeGreaterThanOrEqual(129);
    expect(r.findings.map((f) => `${f.file} ${f.itemId} [${f.rule}]`)).toEqual([]);
    expect(qualityExitCode(r, true)).toBe(0);
  }, 120_000);
});
