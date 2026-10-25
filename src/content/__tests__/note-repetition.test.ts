import { describe, it, expect } from 'vitest';
import { lintNoteRepetition, auditAllRepetition, type RepetitionClause } from '../validate';

/**
 * note-no-repetition gate — the contract "body TEACHES; the recap appears once
 * (keyPoints); the mnemonic appears once". Every clause gets a FAILING and a
 * PASSING fixture, plus a disk-walk shape check (the live count is reported by
 * `validate:content`, not asserted here — the content fix is a separate task).
 */
const clauses = (note: Parameters<typeof lintNoteRepetition>[0]): RepetitionClause[] =>
  lintNoteRepetition(note).map((f) => f.clause);

const kp = [
  'Aryans migrated to India c. 1500 BCE after the IVC declined.',
  'The Rigveda is the oldest Veda and the main source for the period.',
  'Boghazkoi inscription (Turkey, c. 1400 BCE) names Indra and Varuna.',
  'Sabha and Samiti were the popular assemblies of the tribe.',
  'The Vidatha was the oldest Rigvedic assembly.',
];

/** A clean, teaching-only body: story, picture, terms, a SPECIFIC warning. */
const cleanBody = [
  '**In one line:** the Rigvedic people were pastoral tribes of the Sapta-Sindhu.',
  '',
  '**The story:** after the cities of the Indus declined, Indo-Iranian speakers moved in.',
  '',
  '**Terms explained:**',
  '- **Sabha** — a council of elders that advised the chief of the tribe.',
  '- **Samiti** — the wider gathering of the whole tribe, which could choose a chief.',
  '',
  "**Don't confuse (find-spots):** Boghazkoi is in Turkey, not in Syria where Mitanni lay.",
].join('\n');

const clean = { subjectCode: 'HIST', body: cleanBody, keyPoints: kp, mnemonic: 'Sources "RA-MK": Rigveda, Avesta, Mitanni, Kassite.' };

describe('note-no-repetition — a clean note passes every clause', () => {
  it('raises no findings for a teaching-only body + keyPoints + mnemonic', () => {
    expect(lintNoteRepetition(clean)).toEqual([]);
  });

  it('every finding carries a one-line fix hint', () => {
    const f = lintNoteRepetition({ ...clean, body: `${cleanBody}\n\n**TL;DR:**\n- x` });
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) {
      expect(x.hint.length).toBeGreaterThan(10);
      expect(x.hint).not.toContain('\n');
    }
  });
});

describe('note-no-repetition — (a) repeated-run', () => {
  const para = 'The Rigveda was passed down by oral tradition for centuries before writing.';

  it('FAILS when a paragraph of >= 40 chars appears twice in the body', () => {
    expect(clauses({ ...clean, body: `${cleanBody}\n\n${para}\n\n${para}` })).toContain('repeated-run');
  });

  it('FAILS when a list-item run is repeated (the non-idempotent patch shape)', () => {
    const run = ['- **Boghazkoi inscription** (Turkey, c. 1400 BCE) — a Hittite–Mitanni treaty.', '- The Rigveda itself was passed down by oral tradition.'];
    const body = [cleanBody, '', ...run, ...run, ...run].join('\n');
    const f = lintNoteRepetition({ ...clean, body }).find((x) => x.clause === 'repeated-run');
    expect(f?.detail).toContain('×3');
  });

  it('PASSES for short repeated lines, repeated labels and repeated table rows', () => {
    const label = '**Do it the slow way first (reason through a scenario)**';
    const row = '| 1 | a table row that is long enough to count as forty chars |';
    const body = [cleanBody, label, 'Yes.', 'Yes.', label, row, row].join('\n');
    expect(clauses({ ...clean, body })).not.toContain('repeated-run');
  });
});

describe('note-no-repetition — (b) recap-in-body', () => {
  it("FAILS on a 'Key fact at a glance' block", () => {
    const body = `${cleanBody}\n\n**Picture it:**\n\n| # | Key fact at a glance |\n|---|---|\n| 1 | x |`;
    expect(clauses({ ...clean, body })).toContain('recap-in-body');
  });

  it("FAILS on an '### In short' section", () => {
    expect(clauses({ ...clean, body: `${cleanBody}\n\n### In short\n\nThe end.` })).toContain('recap-in-body');
  });

  it("FAILS on a 'TL;DR' marker in a theory note", () => {
    expect(clauses({ ...clean, body: `${cleanBody}\n\n**TL;DR:** pastoral tribes.` })).toContain('recap-in-body');
  });

  it('FAILS on an unlabelled list that repeats >= 60% of keyPoints (formatting ignored)', () => {
    const list = kp.slice(0, 3).map((k) => `- **${k.replace(/\.$/, '')}**`);
    const f = lintNoteRepetition({ ...clean, body: [cleanBody, '', 'Recap:', ...list].join('\n') });
    expect(f.find((x) => x.clause === 'recap-in-body')?.detail).toContain('3/5 keyPoints');
  });

  it('PASSES when a body list repeats < 60% of keyPoints', () => {
    const list = kp.slice(0, 2).map((k) => `- ${k}`);
    expect(clauses({ ...clean, body: [cleanBody, '', 'Recap:', ...list].join('\n') })).not.toContain('recap-in-body');
  });

  it("MENT keeps its per-section '**TL;DR**' (rule 1) — but not a keyPoints copy", () => {
    const ment = { subjectCode: 'MENT', body: '### Rule\n**TL;DR**\n| Formula | Meaning |\n|---|---|\n| a+b | sum |', keyPoints: ['Add them.'] };
    expect(clauses(ment)).not.toContain('recap-in-body');
    expect(clauses({ ...ment, body: `${ment.body}\n\n- Add them.` })).toContain('recap-in-body');
  });
});

describe('note-no-repetition — (c) mnemonic-in-body', () => {
  it('FAILS when the body contains the mnemonic verbatim', () => {
    expect(clauses({ ...clean, body: `${cleanBody}\n\n${clean.mnemonic}` })).toContain('mnemonic-in-body');
  });

  it("FAILS on a '**Remember it:**' paragraph restating the mnemonic", () => {
    const body = `${cleanBody}\n\n**Remember it:** Sources hook "RA-MK" — Rigveda, Avesta (Iran), Mitanni, Kassite records.`;
    expect(clauses({ ...clean, body })).toContain('mnemonic-in-body');
  });

  it('PASSES when the body has an unrelated Remember-it line, or the note has no mnemonic', () => {
    const body = `${cleanBody}\n\n**Remember it:** Sabha is small and Samiti is the whole tribe.`;
    expect(clauses({ ...clean, body })).not.toContain('mnemonic-in-body');
    expect(clauses({ ...clean, body: `${cleanBody}\n\n${clean.mnemonic}`, mnemonic: undefined })).not.toContain('mnemonic-in-body');
  });
});

describe('note-no-repetition — (d) boilerplate', () => {
  it("FAILS on the stamped \"Don't confuse\" exam-swap sentence", () => {
    const body = `${cleanBody}\n\n**Don't confuse:** In the exam the names, dates and places listed above are swapped between options — match each fact to the exact row before you answer.`;
    expect(clauses({ ...clean, body })).toContain('boilerplate');
  });

  it("FAILS on the stamped 'The story in brief' sentence (bold markup ignored)", () => {
    const body = `${cleanBody}\n\n**The story in brief.** The background, the cause-and-effect and every term used are explained in the sections above; the essential facts to carry into the exam are these.`;
    expect(clauses({ ...clean, body })).toContain('boilerplate');
  });

  it("PASSES for a SPECIFIC Don't-confuse warning", () => {
    expect(clauses(clean)).not.toContain('boilerplate');
  });
});

describe('note-no-repetition — (e) repeated-label', () => {
  const full = '**The formula (now that you know what it does)**';
  const section = (h: string, label: string): string => [`### ${h}`, label, 'Add the two parts to get the whole.'].join('\n');

  it('FAILS when a glossed label (> 25 chars) repeats verbatim across sections of one body', () => {
    const body = [section('Rule A', full), section('Rule B', full), section('Rule C', full)].join('\n\n');
    const f = lintNoteRepetition({ subjectCode: 'MENT', body }).find((x) => x.clause === 'repeated-label');
    expect(f?.detail).toContain('×3');
    expect(f?.detail).toContain('The formula (now that you know what it does)');
    expect(f?.hint).toContain('bare label');
  });

  it("FAILS for a heading-style or ':'-suffixed long label too", () => {
    const story = '**The story (cause → what happened → result):**';
    expect(clauses({ ...clean, body: `${cleanBody}\n\n${story}\nA.\n\n${story}\nB.` })).toContain('repeated-label');
    const h = '#### Do it the slow way first (no formula)';
    expect(clauses({ ...clean, body: `${h}\nA.\n${h}\nB.` })).toContain('repeated-label');
  });

  it('PASSES when the full label is used once and later sections use the bare label', () => {
    const body = [section('Rule A', full), section('Rule B', '**The formula**'), section('Rule C', '**The formula**')].join('\n\n');
    expect(clauses({ subjectCode: 'MENT', body })).not.toContain('repeated-label');
  });

  it('PASSES for repeated short bare labels (<= 25 chars) — they repeat per section by design', () => {
    const labels = ['**Do it the slow way first**', '**The idea in one sentence**', '**Common traps**'];
    const body = [...labels, ...labels].join('\n');
    expect(clauses({ subjectCode: 'MENT', body })).not.toContain('repeated-label');
  });

  it('PASSES when two DIFFERENT glosses of a label each appear once', () => {
    const body = '**Do it the slow way first (no formula)**\nA.\n**Do it the slow way first (draw it)**\nB.';
    expect(clauses({ subjectCode: 'MENT', body })).not.toContain('repeated-label');
  });
});

describe('note-no-repetition — disk walk', () => {
  it('returns findings with file, item id, clause, detail and hint', () => {
    const findings = auditAllRepetition();
    expect(Array.isArray(findings)).toBe(true);
    for (const f of findings.slice(0, 5)) {
      expect(typeof f.file).toBe('string');
      expect(typeof f.itemId).toBe('string');
      expect(['repeated-run', 'recap-in-body', 'mnemonic-in-body', 'boilerplate', 'repeated-label']).toContain(f.clause);
      expect(typeof f.detail).toBe('string');
      expect(typeof f.hint).toBe('string');
    }
  });
});
