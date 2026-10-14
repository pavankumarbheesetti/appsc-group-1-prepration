// @vitest-environment jsdom
/**
 * FLOW-QA-2 fixes (stage e1): backup import safety (N1/D36), finished test rows
 * open their results + instructions before timed tests (N2/D23), ^{}/_{}
 * rendering everywhere (N3/D14), ONE accuracy (N4), D12 accuracy gate,
 * match-question keys (D43) and learner-friendly source labels (D39).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as settings from '../settings';
import * as mock from '../mock';
import { dayRows, rowView, computeReviseCtx } from '../today-tasks';
import { renderQuestionStem, renderExplanation, displayMatch, optionKeyFor, mountQuiz } from '../quiz';
import { buildNoteArticle } from '../notes';
import { buildAtAGlance } from '../components/atglance';
import { renderInline, renderPreview } from '../dom';
import { studyMarkBar } from '../learn';
import * as learn from '../learn';
import {
  __resetForTests,
  BackupError,
  exportStateJSON,
  importStateJSON,
  loadState,
  parseBackupJSON,
  recordTestAttempt,
  setPlanStartDate,
  updateState,
} from '../../state/store';
import { getBanks, getCards, getMindmap, getSubtopic, getSubtopics } from '../../content/loader';
import type { MCQItem } from '../../content/types';
import { currentPlan } from '../../lib/plan';
import { planDayFor } from '../../engine/planner';
import { localISO } from '../../lib/review-scope';
import { weekTestNumber } from '../../lib/test-number';
import { accuracyPct, formatAccuracy, topicAccuracy } from '../../lib/accuracy';
import { deriveStudyStatus, isTopicStudied, lowAccuracyNote, markTopicStudied, topicStudy } from '../../lib/study-status';
import { CA_SOURCE_LABEL, STUDY_MATERIAL_LABEL, learnerSource } from '../../lib/source-label';
import { rankWeakAreas } from '../../lib/weak';

function btn(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));
}

function host(nodes: ReadonlyArray<Node | string | null | undefined | false>): HTMLElement {
  const d = document.createElement('div');
  for (const n of nodes) if (n) d.append(typeof n === 'string' ? document.createTextNode(n) : n);
  return d;
}

const RAW = /\^\{|_\{/;

beforeEach(() => {
  localStorage.clear();
  __resetForTests();
  document.body.innerHTML = '';
  location.hash = '';
});

/* -------------------------------------------------------------------------- */
/* 1. Import safety                                                            */
/* -------------------------------------------------------------------------- */

describe('P0 import — full-schema validation before touching state', () => {
  function seed(): string {
    updateState((s) => {
      s.progress['q1'] = { seen: 3, correct: 2, wrong: 1 };
      s.study['sub-a'] = { mark: 'studied', studiedOn: '2026-10-11' };
    });
    return JSON.stringify(loadState());
  }

  it('{"bad":1} and truncated JSON are rejected and leave state untouched (store)', () => {
    const before = seed();
    const good = exportStateJSON();
    for (const bad of ['{"bad":1}', good.slice(0, Math.floor(good.length / 2)), '[]', '42', '{"version":"x"}']) {
      expect(() => parseBackupJSON(bad)).toThrow(BackupError);
      expect(JSON.stringify(loadState())).toBe(before);
    }
    // The lenient path also refuses a value with no APPSC state at all.
    expect(() => importStateJSON('{"bad":1}')).toThrow(/APPSC backup/);
    expect(JSON.stringify(loadState())).toBe(before);
    // A partial blob (no progress / sr / notebook) is not a full backup.
    expect(() => parseBackupJSON('{"version":1,"settings":{"examDate":"2027-01-24","planStartDate":"2026-10-10"}}')).toThrow(/missing/);
  });

  it('Settings: {"bad":1} shows "nothing was changed"; a truncated file too', () => {
    const before = seed();
    const root = document.createElement('div');
    settings.render(root);
    const ta = root.querySelector<HTMLTextAreaElement>('.settings-import-text')!;
    ta.value = '{"bad":1}';
    btn(root, 'Import pasted JSON')!.click();
    expect(root.querySelector('.settings-import-status')!.textContent).toContain("This file isn't an APPSC backup — nothing was changed");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    ta.value = exportStateJSON().slice(0, 40);
    btn(root, 'Import pasted JSON')!.click();
    expect(root.querySelector('.settings-import-status')!.textContent).toContain('nothing was changed');
    expect(JSON.stringify(loadState())).toBe(before);
  });

  it('a valid backup asks to confirm with its date; the success message survives the redraw', () => {
    seed();
    const backup = exportStateJSON();
    expect(JSON.parse(backup).exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    updateState((s) => {
      s.progress = {};
    });
    const root = document.createElement('div');
    document.body.append(root);
    settings.render(root);
    root.querySelector<HTMLTextAreaElement>('.settings-import-text')!.value = backup;
    btn(root, 'Import pasted JSON')!.click();
    const dlg = document.querySelector('[role="alertdialog"]')!;
    expect(dlg.textContent).toMatch(/Replace your current progress with this backup from \d+ \w{3} \d{4}\? Current progress will be lost — export first\?/);
    expect(loadState().progress['q1']).toBeUndefined(); // nothing applied before confirming
    btn(dlg, 'Replace my progress')!.click();
    expect(loadState().progress['q1']?.seen).toBe(3);
    expect(root.querySelector('.settings-import-status')!.textContent).toContain('Import successful');
  });

  it('cancelling the confirm changes nothing', () => {
    seed();
    const backup = exportStateJSON();
    updateState((s) => {
      s.progress = {};
    });
    const root = document.createElement('div');
    document.body.append(root);
    settings.render(root);
    root.querySelector<HTMLTextAreaElement>('.settings-import-text')!.value = backup;
    btn(root, 'Import pasted JSON')!.click();
    btn(document.querySelector('[role="alertdialog"]')!, 'Cancel')!.click();
    expect(loadState().progress['q1']).toBeUndefined();
    expect(root.querySelector('.settings-import-status')!.textContent).toContain('nothing was changed');
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Test rows → results; numbering; instructions                             */
/* -------------------------------------------------------------------------- */

describe('test rows — submitted opens results; Week test numbering; instructions', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T10:00:00'));
    setPlanStartDate('2026-10-10');
  });
  afterEach(() => vi.useRealTimers());

  it('weekTestNumber counts the learner\u2019s own week tests from plan start', () => {
    const at = (d: string): { kind: string; at: number; dateISO: string } => ({ kind: 'week-test', at: Date.parse(`${d}T10:00:00`), dateISO: d });
    expect(weekTestNumber('2026-10-17', [], '2026-10-10')).toBe(1);
    expect(weekTestNumber('2026-10-24', [at('2026-10-17')], '2026-10-10')).toBe(2);
    // A test before the plan start does not count; a same-day attempt keeps its number.
    expect(weekTestNumber('2026-10-17', [at('2026-10-03'), at('2026-10-17')], '2026-10-10')).toBe(1);
  });

  it('a submitted week-test row opens its RESULTS (full review), never a new attempt', () => {
    const day = planDayFor(currentPlan(new Date()), '2026-10-17')!;
    const sub = getSubtopics().find((s) => (getSubtopic(s.id)?.mcqs.length ?? 0) >= 2)!;
    const items = getSubtopic(sub.id)!.mcqs.slice(0, 2);
    const now = Date.now();
    recordTestAttempt({
      at: now, dateISO: localISO(now), reviewIds: [items[1]!.id], kind: 'week-test', total: 2, attempted: 2, correct: 1, wrong: 1, skipped: 0,
      net: 0.67, guessAttempted: 0, guessCorrect: 0, marksLostToWrong: 0.33,
      itemIds: items.map((i) => i.id), answers: [items[0]!.answerIndex, (items[1]!.answerIndex + 1) % items[1]!.options.length], confidences: [null, null],
    } as never);
    const row = dayRows(day, '2026-10-17').find((r) => r.task === 'test')!;
    const v = rowView(row, { reviseCtx: computeReviseCtx('2026-10-17', day), day });
    expect(v.label).toBe('Week test 1');
    v.onClick();
    expect(location.hash).toBe(`#/practice/mock/results/${now}`);
    const root = document.createElement('div');
    mock.renderResultsRoute(root);
    expect(root.textContent).toContain('Week test results');
    expect(root.querySelectorAll('.mock-review-item').length).toBe(2);
    expect(root.querySelector('.mock-countdown')).toBeNull();
    // Retake is a SEPARATE, secondary action.
    const retake = btn(root, 'Retake')!;
    expect(retake.className).not.toContain('btn-primary');
  });

  it('an unsubmitted week test opens the instructions screen first; the timer starts on Start', () => {
    updateState((s) => {
      for (const sub of getSubtopics().slice(0, 6)) s.study[sub.id] = { mark: 'studied', studiedOn: '2026-10-12' };
    });
    const day = planDayFor(currentPlan(new Date()), '2026-10-17')!;
    const row = dayRows(day, '2026-10-17').find((r) => r.task === 'test')!;
    rowView(row, { reviseCtx: computeReviseCtx('2026-10-17', day), day }).onClick();
    const root = document.createElement('div');
    mock.render(root);
    expect(root.querySelector('.test-instructions')).not.toBeNull();
    expect(root.textContent).toContain('questions');
    expect(root.textContent).toContain('\u22121/3');
    expect(root.textContent).toMatch(/Sure.*50-50.*Guess/);
    expect(root.querySelector('.mock-countdown')).toBeNull();
    btn(root, 'Start the test')!.click();
    expect(root.querySelector('.mock-countdown')).not.toBeNull();
    expect(root.textContent).toContain('Week test 1');
  });
});

/* -------------------------------------------------------------------------- */
/* 3. ^{} / _{} rendered everywhere                                            */
/* -------------------------------------------------------------------------- */

describe('no raw ^{ / _{ in any rendered MCQ / note / card / mindmap', () => {
  it('a base-less index before √ renders as a root index', () => {
    const h = host(renderInline('^{4}√10 and x_{1} + 2^{100}'));
    expect(h.textContent).not.toMatch(RAW);
    expect(h.querySelector('sup.root-index')?.textContent).toBe('4');
    expect(h.querySelectorAll('sup').length).toBe(2);
    expect(h.querySelector('sub')?.textContent).toBe('1');
    // Truncated previews never leave half a token behind.
    expect(host(renderPreview('abc ^{12345}', 7)).textContent).not.toMatch(RAW);
  });

  it('scans every bank through the real renderers', () => {
    const problems: string[] = [];
    for (const { bank } of getBanks()) {
      if (bank.kind === 'mcq') {
        for (const item of bank.items as MCQItem[]) {
          const h = host([...renderQuestionStem(item), renderExplanation(item)] as Node[]);
          for (const o of displayMatch(item).options) h.append(...renderInline(o));
          h.append(...renderPreview(item.question, 80));
          if (RAW.test(h.textContent ?? '')) problems.push(`mcq ${item.id}`);
        }
      } else if (bank.kind === 'notes') {
        bank.items.forEach((note, i) => {
          const h = host([buildNoteArticle(note, `n${i}`)]);
          if (RAW.test(h.textContent ?? '')) problems.push(`note ${note.id}`);
        });
      }
    }
    let cards = 0;
    let maps = 0;
    for (const sub of getSubtopics()) {
      for (const c of getCards(sub.id)) {
        cards += 1;
        const h = host([...renderInline(c.front), ...renderInline(c.back)]);
        if (RAW.test(h.textContent ?? '')) problems.push(`card ${c.id}`);
      }
      const map = getMindmap(sub.id);
      if (map) {
        maps += 1;
        const h = host([buildAtAGlance(map)]);
        if (RAW.test(h.textContent ?? '')) problems.push(`mindmap ${sub.id}`);
      }
    }
    expect(cards).toBeGreaterThan(0);
    expect(maps).toBeGreaterThan(0);
    expect(problems.slice(0, 20).join("\n")).toBe("");
  });

  it('the live quiz (options + feedback) shows no raw markup', () => {
    const items = getBanks()
      .flatMap(({ bank }) => (bank.kind === 'mcq' ? (bank.items as MCQItem[]) : []))
      .filter((i) => RAW.test(i.question + i.options.join(' ')))
      .slice(0, 5);
    expect(items.length).toBeGreaterThan(0);
    const root = document.createElement('div');
    mountQuiz(root, items, () => {});
    expect(root.textContent).not.toMatch(RAW);
    root.querySelector<HTMLElement>('.option-card')!.click();
    expect(root.textContent).not.toMatch(RAW);
  });
});

/* -------------------------------------------------------------------------- */
/* 4–5. Accuracy + D12                                                          */
/* -------------------------------------------------------------------------- */

describe('ONE accuracy (correct ÷ answered, all attempts) + D12', () => {
  /** A topic with ≥ 15 questions; record `correct` of `answered` first-time answers. */
  function seedTopic(correct: number, answered: number): string {
    const sub = getSubtopics().find((s) => (getSubtopic(s.id)?.mcqs.length ?? 0) >= 15)!;
    const ids = getSubtopic(sub.id)!.mcqs.map((m) => m.id);
    updateState((s) => {
      ids.slice(0, answered).forEach((id, i) => {
        const ok = i < correct;
        s.progress[id] = { seen: 1, correct: ok ? 1 : 0, wrong: ok ? 0 : 1, lastResult: ok ? 'correct' : 'wrong' };
      });
    });
    return sub.id;
  }

  it('12/15 shows 80% (lib + Learn header + Progress row)', () => {
    expect(accuracyPct(12, 15)).toBe(80);
    const id = seedTopic(12, 15);
    const acc = topicAccuracy(loadState().progress, getSubtopic(id)!.mcqs.map((m) => m.id));
    expect(formatAccuracy(acc)).toBe('80%');
    // Learn header.
    const view = document.createElement('main');
    view.id = 'view';
    document.body.append(view);
    location.hash = `#/learn/${id}`;
    learn.render(view);
    expect(view.querySelector('.learn-header')!.textContent).toContain('80%');
    // Weak-area ranking uses the same number.
    const sub = getSubtopic(id)!;
    const [w] = rankWeakAreas([{ subtopicId: id, name: sub.meta.name, mcqIds: sub.mcqs.map((m) => m.id) }], loadState().progress).weak;
    expect(Math.round((w?.accuracy ?? 0) * 100)).toBe(80);
  });

  it('D12: 0/10 correct does NOT auto-study; 5/10 does; manual mark shows a gentle note', () => {
    expect(deriveStudyStatus(undefined, 10, 20, 0)).toBe('in-progress');
    expect(deriveStudyStatus(undefined, 10, 20, 50)).toBe('studied');
    expect(deriveStudyStatus(undefined, 9, 20, 100)).toBe('in-progress');
    const id = seedTopic(0, 10);
    expect(isTopicStudied(id)).toBe(false);
    markTopicStudied(id, true);
    expect(isTopicStudied(id)).toBe(true);
    expect(lowAccuracyNote(topicStudy(id))).toBe('Consider reviewing the notes \u2014 you scored 0%.');
    const bar = studyMarkBar(getSubtopic(id)!);
    expect(bar.textContent).toContain('Consider reviewing the notes \u2014 you scored 0%.');
  });

  it('D12: 6/10 correct auto-studies with no note', () => {
    const id = seedTopic(6, 10);
    expect(isTopicStudied(id)).toBe(true);
    expect(lowAccuracyNote(topicStudy(id))).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Match keys                                                                */
/* -------------------------------------------------------------------------- */

describe('match questions — List-I A–D, List-II 1–4, options (i)–(iv)', () => {
  const lettered = {
    id: 'm-test',
    question: 'Match List-I with List-II',
    options: ['A-B, B-D, C-A, D-C', 'A-A, B-B, C-C, D-D', 'A-C, B-A, C-D, D-B', 'A-D, B-C, C-B, D-A'],
    answerIndex: 0,
    match: {
      leftTitle: 'List-I', rightTitle: 'List-II',
      left: [{ key: 'A', text: 'one' }, { key: 'B', text: 'two' }, { key: 'C', text: 'three' }, { key: 'D', text: 'four' }],
      right: [{ key: 'A', text: 'w' }, { key: 'B', text: 'x' }, { key: 'C', text: 'y' }, { key: 'D', text: 'z' }],
    },
  } as unknown as MCQItem;

  it('maps letter-keyed List-II to numbers at render (with a validator warning)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shown = displayMatch(lettered);
    expect(shown.options[0]).toBe('A-2, B-4, C-1, D-3');
    expect(shown.match!.right.map((r) => r.key)).toEqual(['1', '2', '3', '4']);
    expect(warn).toHaveBeenCalled();
    const h = host(renderQuestionStem(lettered));
    const rightKeys = [...h.querySelectorAll('tbody tr td:nth-child(2) .match-key')].map((k) => k.textContent);
    expect(rightKeys).toEqual(['1.', '2.', '3.', '4.']);
    warn.mockRestore();
  });

  it('option keys on match questions are (i)–(iv), not A–D', () => {
    expect(optionKeyFor(lettered, 0)).toBe('(i)');
    expect(optionKeyFor({ question: 'Plain?' }, 0)).toBe('A');
    const root = document.createElement('div');
    mountQuiz(root, [displayMatch(lettered)], () => {});
    const keys = [...root.querySelectorAll('.option-key')].map((k) => k.textContent);
    expect(keys).toEqual(['(i)', '(ii)', '(iii)', '(iv)']);
    expect(root.querySelector('.option-body')!.textContent).toBe('A-2, B-4, C-1, D-3');
  });

  it('every content match item renders List-II with numeric keys', () => {
    const bad: string[] = [];
    for (const { bank } of getBanks()) {
      if (bank.kind !== 'mcq') continue;
      for (const item of bank.items as MCQItem[]) {
        if (!item.match) continue;
        const h = host(renderQuestionStem(item));
        const keys = [...h.querySelectorAll('tbody tr td:nth-child(2) .match-key')].map((k) => k.textContent ?? '');
        if (keys.some((k) => /^[A-Za-z]\.$/.test(k))) bad.push(item.id);
      }
    }
    expect(bad).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. Source labels                                                             */
/* -------------------------------------------------------------------------- */

describe('learner-friendly Source labels', () => {
  it('maps internal labels and hides file names', () => {
    expect(learnerSource('Weekly CA PDFs — May Week 1')).toBe(CA_SOURCE_LABEL);
    expect(learnerSource('Weekly CA PDF — November Week 2 (2026)')).toBe(CA_SOURCE_LABEL);
    expect(learnerSource('local APPSC GK PDF — Modern History: Gandhi Movements')).toBe(`${STUDY_MATERIAL_LABEL} \u2014 Modern History: Gandhi Movements`);
    expect(learnerSource('local APPSC Quantitative Reasoning PDF — Ratio')).toBe(`${STUDY_MATERIAL_LABEL} \u2014 Ratio`);
    expect(learnerSource('review-v2 R3')).toBeNull();
    expect(learnerSource('AP fact dossier (dossier-gov.md, as-of 1 Sep 2026); verified Sep 2026')).not.toMatch(/\.md/);
    expect(learnerSource('.research/ap dossiers (PRS/PIB/Hindu/Wikipedia, verified)')).toBe('Compiled from PRS/PIB/Hindu/Wikipedia');
    expect(learnerSource('NCERT Science Class 10')).toBe('NCERT Science Class 10');
  });

  it('the explanation shows "Source:" with the friendly label', () => {
    const exp = renderExplanation({ id: 'x', question: 'q', options: ['a', 'b'], answerIndex: 0, explanation: 'Because.', source: 'Weekly CA PDFs — May Week 1' } as unknown as MCQItem)!;
    const src = exp.querySelector('.explanation-source')!;
    expect(src.textContent).toBe(`Source:${CA_SOURCE_LABEL}`);
    expect(exp.textContent).not.toMatch(/PDF/);
  });
});
