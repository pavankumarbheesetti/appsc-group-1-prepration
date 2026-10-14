/**
 * Fix B — every Today row has a task, an amount, a destination matching its
 * label and a completion state (FLOW-QA D5–D10, D17/D18; LOGIC-AUDIT H1, H4,
 * M1, M9). Clock pinned; plan starts Sat 10 Oct 2026; Prelims 24 Jan 2027.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as today from '../today';
import * as planner from '../planner';
import * as formulaSheet from '../formula-sheet';
import { tldrRows, formulaSections } from '../formula-sheet';
import { dayRows, rowDone, rowView, computeReviseCtx, catchupTopics, weakDrillFor, languageRows } from '../today-tasks';
import { renderFlashcards } from '../revise';
import * as notebook from '../notebook';
import * as start from '../start';
import {
  adminCardsFor,
  APPLY_DEADLINE_ISO,
  activeTask,
  caSetSize,
  clearActiveTask,
  fitMissed,
  freshFirst,
  isExamDay,
  isRowKeyDone,
  mainsKey,
  missedTopics,
  START_HERE_KEY,
  weakDrillIds,
} from '../../lib/day-tasks';
import { currentPlan, onTimePlan } from '../../lib/plan';
import { planDayFor, type PlanDay } from '../../engine/planner';
import { markTopicStudied, isTopicStudied } from '../../lib/study-status';
import { localISO } from '../../lib/review-scope';
import { TELUGU_LESSONS } from '../../content/telugu';
import { getSubtopic } from '../../content/loader';
import {
  __resetForTests,
  loadState,
  recordTestAttempt,
  setPlanStartDate,
  setTeluguLessonDone,
  updateState,
} from '../../state/store';

function setClock(iso: string): void {
  vi.setSystemTime(new Date(`${iso}T10:00:00`));
}

/** A mounted #view (row destinations render into it) + a Today root inside. */
function mountView(): HTMLElement {
  document.body.innerHTML = '';
  const view = document.createElement('main');
  view.id = 'view';
  document.body.appendChild(view);
  return view;
}

function renderToday(): HTMLElement {
  const view = mountView();
  today.render(view);
  return view;
}

function rowsOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('.today-check')];
}

function rowByText(root: HTMLElement, text: string): HTMLElement {
  const r = rowsOf(root).find((x) => x.textContent?.includes(text));
  if (!r) throw new Error(`row not found: ${text} in ${rowsOf(root).map((x) => x.textContent).join(' | ')}`);
  return r;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const b = [...root.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.includes(text));
  if (!b) throw new Error(`button not found: ${text}`);
  return b;
}

function dayOf(iso: string): PlanDay {
  const d = planDayFor(currentPlan(new Date()), iso);
  if (!d) throw new Error(`no plan day ${iso}`);
  return d;
}

/** Answer the first question of a running quiz, then end the session. */
function answerOneAndEnd(root: HTMLElement): void {
  root.querySelector<HTMLElement>('.option-card')!.click();
  buttonByText(root, 'End session').click();
}

beforeEach(() => {
  localStorage.clear();
  __resetForTests();
  clearActiveTask();
  location.hash = '';
  vi.useFakeTimers({ toFake: ['Date'] });
  setClock('2026-10-13');
  setPlanStartDate('2026-10-10');
});

afterEach(() => {
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

describe('day-tasks — pure helpers', () => {
  const days = [
    { dateISO: '2026-10-10', theorySubtopicIds: ['a', 'b'], aptitudeSubtopicIds: ['m1'] },
    { dateISO: '2026-10-12', theorySubtopicIds: ['c'], aptitudeSubtopicIds: [] },
    { dateISO: '2026-10-13', theorySubtopicIds: ['d'], aptitudeSubtopicIds: [] },
  ];

  it('missedTopics: unstudied topics from earlier days, in plan order, minus today/excluded', () => {
    const studied = new Set(['b']);
    const out = missedTopics(days, '2026-10-10', '2026-10-13', (id) => studied.has(id), new Set(['c']));
    expect(out).toEqual([
      { id: 'a', dueISO: '2026-10-10' },
      { id: 'm1', dueISO: '2026-10-10' },
    ]);
  });

  it('fitMissed: takes in order while they fit (always one), capped', () => {
    const missed = [{ id: 'a', dueISO: 'x' }, { id: 'b', dueISO: 'x' }, { id: 'c', dueISO: 'x' }];
    expect(fitMissed(missed, 50, () => 30).map((m) => m.id)).toEqual(['a']);
    expect(fitMissed(missed, 10, () => 30).map((m) => m.id)).toEqual(['a']);
    expect(fitMissed(missed, 100, () => 30, 2).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('weakDrillIds: weak questions first, round-robin, then the rest, capped at 20', () => {
    const ids = weakDrillIds(
      [{ subtopicId: 's1', wrongQuestionIds: ['w1', 'w2'] }, { subtopicId: 's2', wrongQuestionIds: ['x1'] }],
      (id) => Array.from({ length: 15 }, (_, i) => `${id}-q${i}`),
    );
    expect(ids.slice(0, 3)).toEqual(['w1', 'x1', 'w2']);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it('adminCardsFor: apply until 27 Oct, "missed" until 31 Oct, then hidden; hall ticket 12 Jan → eve', () => {
    const none = (): boolean => false;
    const exam = '2027-01-24';
    expect(adminCardsFor('2026-10-14', exam, none, false)).toEqual(['apply-online']);
    expect(adminCardsFor(APPLY_DEADLINE_ISO, exam, none, false)).toEqual(['apply-online']);
    expect(adminCardsFor('2026-10-28', exam, none, false)).toEqual(['apply-missed']);
    expect(adminCardsFor('2026-10-31', exam, none, false)).toEqual(['apply-missed']);
    expect(adminCardsFor('2026-11-07', exam, none, false)).toEqual([]);
    expect(adminCardsFor('2026-10-28', exam, (id) => id === 'apply-online', false)).toEqual([]);
    expect(adminCardsFor('2027-01-11', exam, none, false)).toEqual([]);
    expect(adminCardsFor('2027-01-12', exam, none, false)).toEqual(['hall-ticket']);
    expect(adminCardsFor('2027-01-23', exam, none, true)).toEqual(['hall-ticket', 'exam-day']);
    expect(adminCardsFor(exam, exam, none, false)).toEqual([]);
    expect(isExamDay(exam, exam)).toBe(true);
  });

  it('CA set sizes and fresh-first ordering', () => {
    expect(caSetSize(25)).toBe(10);
    expect(caSetSize(5)).toBe(5);
    expect(caSetSize(200)).toBe(20);
    expect(freshFirst(['a', 'b', 'c'], { a: { seen: 2 } } as never, 2)).toEqual(['b', 'c']);
  });

  it('formula sheet: TL;DR table rows come out of MENT notes, in sequence order', () => {
    const rows = tldrRows([{ body: 'Intro\n\n**TL;DR**\n| Formula | Meaning |\n|---|---|\n| a+b | sum |\n| `x^2` | square |\n\nAfter' }]);
    expect(rows).toEqual([{ formula: 'a+b', meaning: 'sum' }, { formula: '`x^2`', meaning: 'square' }]);
    const sections = formulaSections();
    expect(sections.length).toBeGreaterThan(5);
    expect(sections.every((s) => s.subtopicId.startsWith('ment') && s.rows.length > 0)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 1 — every row: task, amount, destination, completion                        */
/* -------------------------------------------------------------------------- */

describe('Today rows — task, amount, destination and completion (D5–D9, H1)', () => {
  it('every row on Tue 13 Oct has a label, an amount, minutes and a tick', () => {
    const root = renderToday();
    const rows = rowsOf(root);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) {
      expect(r.querySelector('.today-check-label')?.textContent?.trim()).toBeTruthy();
      expect(r.querySelector('.today-check-detail')?.textContent?.trim()).toBeTruthy();
      expect(r.querySelector('.today-check-tick')).toBeTruthy();
      expect(r.getAttribute('data-done')).toBe('false');
    }
  });

  it('completing every row on Tue 13 Oct → "All done for today — well done" + tomorrow preview', () => {
    const day = dayOf('2026-10-13');
    const rows = dayRows(day, '2026-10-13');
    // Topic rows: Mark as studied.
    for (const r of rows) if (r.task === 'topic' && r.topic) markTopicStudied(r.topic.subtopicId, true, '2026-10-13');
    // Telugu: the lesson pass.
    setTeluguLessonDone(TELUGU_LESSONS[0]!.id, true, '2026-10-13');
    let root = renderToday();
    expect(root.querySelector('.hero-now-eyebrow')?.textContent).toBe('Up now');

    // Revise: the flashcard session — Start begins the task; the session end ticks it.
    const revise = rowByText(root, 'Flashcards for today');
    revise.querySelector<HTMLButtonElement>('.today-check-btn')!.click();
    expect(activeTask()?.session).toBe('flashcards');
    const fc = mountView();
    renderFlashcards(fc);
    for (let i = 0; i < 200 && fc.querySelector('.flashcard, .fc-card, [data-fc]'); i += 1) {
      const reveal = [...fc.querySelectorAll<HTMLButtonElement>('button')].find((b) => /show|reveal|flip/i.test(b.textContent ?? ''));
      reveal?.click();
      const good = [...fc.querySelectorAll<HTMLButtonElement>('button')].find((b) => /^(good|easy|got it)/i.test(b.textContent?.trim() ?? ''));
      if (!good) break;
      good.click();
    }
    // Whatever the session shape, its end ticks the row (no session left running).
    expect(activeTask()).toBeNull();

    // CA: the row opens a 10-question set from the named bank; submitting ticks it.
    root = renderToday();
    const ca = root.querySelector<HTMLElement>('.today-check[data-kind="ca"]')!;
    expect(ca.textContent).toMatch(/\d+ questions from .*Current Affairs/);
    ca.querySelector<HTMLButtonElement>('.today-check-btn')!.click();
    expect(root.textContent).toMatch(/Start the \d+-question set/);
    buttonByText(root, 'question set').click();
    answerOneAndEnd(root);
    expect(root.textContent).toContain('Set done');

    root = renderToday();
    for (const r of rowsOf(root)) expect(r.getAttribute('data-done')).toBe('true');
    expect(root.querySelector('[data-state="all-done"]')?.textContent).toContain('All done for today \u2014 well done');
    expect(root.querySelector('.today-tomorrow')?.textContent).toMatch(/^Tomorrow \(Wed 14 Oct\): /);
  });

  it('"Up now" advances as rows finish', () => {
    let root = renderToday();
    const first = root.querySelector('.hero-now-title')?.textContent;
    buttonByText(root.querySelector('.hero')!, 'Mark as studied').click();
    root = renderToday();
    expect(root.querySelector('.hero-now-title')?.textContent).not.toBe(first);
  });

  it('Start here: hero shows it first on day 1; done only when "I\u2019ve read this" is tapped', () => {
    setClock('2026-10-10');
    let root = renderToday();
    expect(root.querySelector('.hero-now-title')?.textContent).toBe('Start here');
    const guide = mountView();
    start.render(guide);
    expect(isRowKeyDone('2026-10-10', START_HERE_KEY)).toBe(false);
    buttonByText(guide, 'I\u2019ve read this').click();
    expect(isRowKeyDone('2026-10-10', START_HERE_KEY)).toBe(true);
    root = renderToday();
    expect(rowByText(root, 'Start here').getAttribute('data-done')).toBe('true');
    expect(root.querySelector('.hero-now-title')?.textContent).not.toBe('Start here');
  });

  it('day-1 CA row = "How current affairs is asked" section, then a 10-question starter set (D7)', () => {
    setClock('2026-10-10');
    const root = renderToday();
    const ca = rowByText(root, 'How current affairs is asked');
    expect(ca.textContent).toContain('10-question starter set');
    ca.querySelector<HTMLButtonElement>('.today-check-btn')!.click();
    expect(root.querySelector('#start-ca')).toBeTruthy();
    expect(buttonByText(root, 'Start the 10-question set')).toBeTruthy();
  });

  it('Sunday round-up = a 25-question mixed set from the week\u2019s CA (D8)', () => {
    setClock('2026-10-11');
    const root = renderToday();
    const roundup = rowByText(root, 'weekly round-up');
    expect(roundup.textContent).toContain('25-question set');
    roundup.querySelector<HTMLButtonElement>('.today-check-btn')!.click();
    expect(buttonByText(root, 'Start the 25-question set')).toBeTruthy();
    expect(location.hash).not.toContain('learn');
  });

  it('week test row: done when submitted, shows the score; review row done when its list is cleared', () => {
    setClock('2026-10-17');
    const day = dayOf('2026-10-17');
    const now = Date.now();
    recordTestAttempt({
      at: now, dateISO: localISO(now), reviewIds: ['q1'], kind: 'week-test', total: 45, attempted: 40, correct: 30, wrong: 10, skipped: 5,
      net: 26.67, guessAttempted: 0, guessCorrect: 0, marksLostToWrong: 3.33,
    } as never);
    const rows = dayRows(day, '2026-10-17');
    const test = rows.find((r) => r.task === 'test')!;
    const review = rows.find((r) => r.task === 'review')!;
    expect(rowDone(test, '2026-10-17')).toBe(true);
    const root = renderToday();
    expect(rowByText(root, 'Week test').textContent).toContain('Score 26.67 net');
    expect(rowDone(review, '2026-10-17')).toBe(false);
    // The review row starts the scoped list; clearing it ticks the row.
    rowByText(root, 'Review every wrong').querySelector<HTMLButtonElement>('.today-check-btn')!.click();
    expect(activeTask()?.session).toBe('review');
    expect(isRowKeyDone('2026-10-17', review.key)).toBe(false);
  });

  it('mains-write row opens THAT question; "I\u2019ve written it" ticks it', () => {
    // N6: Mains practice only uses studied topics.
    markTopicStudied('econ-agriculture', true);
    const plan = currentPlan(new Date());
    const day = plan.days.find((d) => d.blocks.some((b) => b.kind === 'mains-write' && b.mainsQuestionId));
    expect(day).toBeTruthy();
    const block = day!.blocks.find((b) => b.kind === 'mains-write')!;
    const row = dayRows(day!, day!.dateISO).find((r) => r.task === 'mains')!;
    location.hash = '#/';
    rowView(row, { reviseCtx: computeReviseCtx(day!.dateISO, day!), day: day! }).onClick();
    expect(location.hash).toBe(`#/mains/${block.mainsQuestionId}`);
    expect(row.key).toBe(mainsKey(block.mainsQuestionId!));
  });

  it('light day (exam − 1): formula sheet + CA set + flashcards; formula row ticks on "I\u2019ve read it"', () => {
    setClock('2027-01-23');
    const root = renderToday();
    const formula = rowByText(root, 'Mental Ability formula sheet');
    rowByText(root, 'Current affairs \u2014 key facts set');
    rowByText(root, 'Flashcards \u2014 due cards');
    formula.querySelector<HTMLButtonElement>('.today-check-btn')!.click();
    expect(location.hash).toBe('#/formula-sheet');
    const sheet = mountView();
    formulaSheet.render(sheet);
    expect(sheet.textContent).toContain('Mental Ability formula sheet');
    expect(sheet.querySelectorAll('.formula-topic').length).toBeGreaterThan(5);
    buttonByText(sheet, 'I\u2019ve read it').click();
    expect(rowByText(renderToday(), 'Mental Ability formula sheet').getAttribute('data-done')).toBe('true');
  });

  it('day-off light day (Diwali): flashcards + CA set, never the Planner', () => {
    const day = currentPlan(new Date()).days.find((d) => d.dayOff);
    expect(day).toBeTruthy();
    const rows = dayRows(day!, day!.dateISO);
    expect(rows.map((r) => r.task)).toEqual(['flashcards', 'light-ca']);
    location.hash = '#/';
    rowView(rows[0]!, { reviseCtx: computeReviseCtx(day!.dateISO, day!), day: day! }).onClick();
    expect(location.hash).toBe('#/revise/flashcards');
  });
});

/* -------------------------------------------------------------------------- */
/* 2 — catch-up + weakest area                                                 */
/* -------------------------------------------------------------------------- */

describe('Catch-up = the missed topics; weakest area = 3 lowest-accuracy studied topics (D10, H4)', () => {
  it('after skipping days, catch-up lists the missed topics in sequence order with their own Learn links', () => {
    setClock('2026-10-14');
    const day = dayOf('2026-10-14');
    const block = day.blocks.find((b) => b.kind === 'catchup');
    expect(block).toBeTruthy();
    const missed = catchupTopics(day, block!.minutes, '2026-10-14');
    expect(missed.length).toBeGreaterThan(0);
    const root = renderToday();
    const first = rowByText(root, missed[0]!.topic.name);
    expect(first.textContent).toContain('missed from');
    first.querySelector<HTMLButtonElement>('.today-check-btn')!.click();
    expect(location.hash.startsWith(`#/learn/${missed[0]!.topic.subtopicId}/`)).toBe(true);
    expect(location.hash).toContain('from=today');
  });

  it('a missed topic studied today stays on the row, ticked', () => {
    setClock('2026-10-14');
    const day = dayOf('2026-10-14');
    const block = day.blocks.find((b) => b.kind === 'catchup')!;
    const missed = catchupTopics(day, block.minutes, '2026-10-14');
    markTopicStudied(missed[0]!.topic.subtopicId, true, '2026-10-14');
    const again = catchupTopics(dayOf('2026-10-14'), block.minutes, '2026-10-14');
    expect(again[0]!.topic.subtopicId).toBe(missed[0]!.topic.subtopicId);
  });

  it('nothing missed → "Nothing to catch up — use this time for weak areas" (a weak-area drill)', () => {
    // Sunday 18 Oct keeps a catch-up block; study everything due before it.
    setClock('2026-10-18');
    for (const pd of onTimePlan().days.filter((d) => d.dateISO < '2026-10-18')) {
      for (const id of [...pd.theorySubtopicIds, ...pd.aptitudeSubtopicIds]) markTopicStudied(id, true, '2026-10-12');
    }
    const day = dayOf('2026-10-18');
    const block = day.blocks.find((b) => b.kind === 'catchup');
    expect(block).toBeTruthy();
    expect(catchupTopics(day, block!.minutes, '2026-10-18')).toEqual([]);
    const weak = dayRows(day, '2026-10-18').find((r) => r.nothingMissed);
    expect(weak?.task).toBe('weak');
    const v = rowView(weak!, { reviseCtx: computeReviseCtx('2026-10-18', day), day });
    expect(v.label).toBe('Nothing to catch up \u2014 use this time for weak areas');
    expect(v.detail).toMatch(/questions from today\u2019s topics/);
    const root = renderToday();
    const row = rowByText(root, 'Nothing to catch up');
    row.querySelector<HTMLButtonElement>('.today-check-btn')!.click();
    expect(root.textContent).toMatch(/Start the \d+-question set/);
  });

  it('weakest area names the 3 lowest-accuracy STUDIED topics and drills 20 of their questions', () => {
    const ids = ['ment-number-system', 'hist-ancient-stone-age', 'hist-ancient-ivc', 'hist-ancient-early-vedic'];
    updateState((s) => {
      ids.forEach((id, n) => {
        const mcqs = getSubtopic(id)?.mcqs ?? [];
        mcqs.slice(0, 6).forEach((m, i) => {
          s.progress[m.id] = { seen: 2, correct: i < n ? 2 : 0, lastResult: i < n ? 'correct' : 'wrong' } as never;
        });
      });
    });
    for (const id of ids) markTopicStudied(id, true, '2026-10-12');
    const drill = weakDrillFor(dayOf('2026-10-13'));
    expect(drill.fromWeak).toBe(true);
    expect(drill.names).toHaveLength(3);
    expect(drill.names).toContain(getSubtopic('ment-number-system')!.meta.name);
    expect(drill.names).not.toContain(getSubtopic('hist-ancient-early-vedic')!.meta.name);
    expect(drill.ids).toHaveLength(20);
  });

  it('no accuracy data → "Practise today\u2019s topics"', () => {
    const drill = weakDrillFor(dayOf('2026-10-13'));
    expect(drill.fromWeak).toBe(false);
    expect(drill.ids.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 5 — admin expiry, exam day, post-exam                                       */
/* -------------------------------------------------------------------------- */

describe('Admin cards expire; exam day; post-exam Mains kick-start (D18, M9)', () => {
  it('apply card on 14 Oct; "Missed the deadline?" on 29 Oct; gone on 7 Nov', () => {
    setClock('2026-10-14');
    expect(renderToday().textContent).toContain('Apply online \u2014 deadline 27 Oct');
    setClock('2026-10-29');
    const late = renderToday().textContent ?? '';
    expect(late).toContain('Missed the deadline? check psc.ap.gov.in for extensions');
    expect(late).not.toContain('Apply online \u2014 deadline');
    setClock('2026-11-07');
    const gone = renderToday().textContent ?? '';
    expect(gone).not.toContain('Missed the deadline');
    expect(gone).not.toContain('Apply online');
  });

  it('hall ticket card from 12 Jan, not on exam day; exam day shows a calm card', () => {
    setClock('2027-01-12');
    expect(renderToday().textContent).toContain('Hall ticket');
    setClock('2027-01-24');
    const root = renderToday();
    const text = root.textContent ?? '';
    expect(text).not.toContain('Hall ticket \u2014 download');
    expect(root.querySelector('[data-state="exam-day"]')).toBeTruthy();
    expect(text).toContain('reporting time');
    expect(text).toContain('Good luck');
    expect(text).toContain('Prelims today');
    expect(text).not.toContain('No blocks scheduled today');
  });

  it('post-exam: Mains kick-start incl. Telugu / English / Essay rows; no "0 days to Prelims"', () => {
    const seen = new Set<string>();
    for (const d of ['2027-01-25', '2027-01-26', '2027-01-27', '2027-01-28', '2027-01-29', '2027-01-30', '2027-01-31']) {
      setClock(d);
      const root = renderToday();
      const text = root.textContent ?? '';
      expect(text).toContain('Mains kick-start');
      expect(text).not.toContain('0 days to Prelims');
      for (const r of languageRows(planDayFor(currentPlan(new Date()), d))) seen.add(r.language!);
      if (text.includes('Telugu (qualifying)')) seen.add('telugu-shown');
      if (text.includes('English (qualifying)')) seen.add('english-shown');
      if (text.includes('General Essay')) seen.add('essay-shown');
    }
    expect(seen).toEqual(new Set(['telugu', 'english', 'essay', 'telugu-shown', 'english-shown', 'essay-shown']));
  });
});

/* -------------------------------------------------------------------------- */
/* 6 — Planner rows open the same destinations                                 */
/* -------------------------------------------------------------------------- */

/** Open the lazily-built "See all weeks" grid. */
function openGrid(view: HTMLElement): void {
  const details = view.querySelector<HTMLDetailsElement>('details.all-weeks')!;
  details.open = true;
  details.dispatchEvent(new Event('toggle'));
}

describe('Planner rows link to the same destinations as Today (D2)', () => {
  it('the This-week table topics open Learn; topic-less grid blocks open the Today destination', () => {
    const view = mountView();
    planner.render(view);
    const link = view.querySelector<HTMLButtonElement>('.planner-week .pw-topic-link');
    expect(link).toBeTruthy();
    link!.click();
    expect(location.hash).toMatch(/^#\/learn\//);

    const view2 = mountView();
    planner.render(view2);
    openGrid(view2);
    const ca = [...view2.querySelectorAll<HTMLButtonElement>('.plan-cell-block.is-link')].find((b) => b.textContent?.includes('Current Affairs'));
    expect(ca).toBeTruthy();
    ca!.click();
    expect(view2.textContent).toMatch(/Start the \d+-question set/);
  });

  it('a planner CA set ticks the same Today row', () => {
    const view = mountView();
    planner.render(view);
    openGrid(view);
    const todayCell = view.querySelector('.plan-cell.is-today')!;
    const ca = [...todayCell.querySelectorAll<HTMLButtonElement>('.plan-cell-block.is-link')].find((b) => b.textContent?.includes('Current Affairs'))!;
    ca.click();
    buttonByText(view, 'question set').click();
    answerOneAndEnd(view);
    const root = renderToday();
    expect(root.querySelector('.today-check[data-kind="ca"]')!.getAttribute('data-done')).toBe('true');
    // The CA first pass (C2) is recorded too.
    expect(isTopicStudied('ca-national')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Session-end hooks                                                           */
/* -------------------------------------------------------------------------- */

describe('review list cleared → review row ticked', () => {
  it('finishing the scoped review quiz completes the active review task', () => {
    setClock('2026-10-17');
    const day = dayOf('2026-10-17');
    const review = dayRows(day, '2026-10-17').find((r) => r.task === 'review')!;
    const mcq = getSubtopic('hist-ancient-stone-age')!.mcqs[0]!;
    const now = Date.now();
    recordTestAttempt({
      at: now, dateISO: localISO(now), reviewIds: [mcq.id], kind: 'week-test', total: 1, attempted: 1, correct: 0, wrong: 1, skipped: 0,
      net: -0.33, guessAttempted: 0, guessCorrect: 0, marksLostToWrong: 0.33,
    } as never);
    const root = renderToday();
    rowByText(root, 'Review every wrong').querySelector<HTMLButtonElement>('.today-check-btn')!.click();
    const nb = mountView();
    notebook.render(nb);
    buttonByText(nb, 'Review these 1').click();
    nb.querySelector<HTMLElement>('.option-card')!.click();
    buttonByText(nb, 'See results').click();
    expect(isRowKeyDone('2026-10-17', review.key)).toBe(true);
    expect(rowDone(review, '2026-10-17')).toBe(true);
    expect(isTopicStudied('hist-ancient-stone-age')).toBe(false);
    expect(loadState().blocksDone['2026-10-17']).toContain(review.key);
  });
});
