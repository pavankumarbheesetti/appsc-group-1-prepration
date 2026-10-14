// @vitest-environment jsdom
/**
 * FLOW-QA-3 fixes (stage f): planner/UI agree on "studied" (N20), no behind
 * banner on rest days / exam eve and never "move the exam date" (D4/N22), no
 * past finish date (N21), pre-start header (D30), no "day 1 of 1" (N28), and
 * the remaining P2 polish items — one describe block per report item.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as today from '../today';
import * as planner from '../planner';
import { currentPlan, plannerProgress } from '../../lib/plan';
import { planDayFor } from '../../engine/planner';
import { isTopicStudied, markTopicStudied } from '../../lib/study-status';
import { __resetForTests, loadState, recordTestAttempt, setPlanStartDate, updateState } from '../../state/store';
import { getSubtopic } from '../../content/loader';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderApp } from '../../app';
import { computeReviseCtx, dayRows, rowView, setRoute, WEAK_DRILL_MINUTES } from '../today-tasks';
import * as notebook from '../notebook';
import * as revise from '../revise';
import * as settings from '../settings';
import * as syllabus from '../syllabus';
import * as start from '../start';
import * as telugu from '../telugu';
import { mountQuiz } from '../quiz';
import { heroContext, isRampDay, tomorrowPreview } from '../today';
import { attemptVerdict } from '../../lib/review-scope';
import { localISO } from '../../lib/review-scope';
import { navigate } from '../../router/router';

const START = '2026-10-10';
const at = (iso: string): Date => new Date(`${iso}T10:00:00`);
const setClock = (iso: string): void => void vi.setSystemTime(at(iso));

function renderInto(view: { render: (r: HTMLElement) => void }): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  view.render(root);
  return root;
}

/** Answer the first `n` questions of `id`, all wrong. */
function failTopic(id: string, n = 10): void {
  const ids = getSubtopic(id)!.mcqs.map((m) => m.id).slice(0, n);
  updateState((s) => {
    for (const q of ids) s.progress[q] = { seen: 1, correct: 0, wrong: 1, lastResult: 'wrong' };
  });
}

beforeEach(() => {
  localStorage.clear();
  __resetForTests();
  document.body.innerHTML = '';
  location.hash = '';
  vi.useFakeTimers({ toFake: ['Date'] });
  setClock(START);
  setPlanStartDate(START);
});
afterEach(() => vi.useRealTimers());

describe('N20 — a failed topic stays on the plan (planner applies the D12 accuracy rule)', () => {
  it('IVC 0/10 is not studied for the planner and is re-offered the next day', () => {
    const IVC = 'hist-ancient-ivc';
    failTopic(IVC);
    expect(isTopicStudied(IVC)).toBe(false);
    expect(plannerProgress()[IVC]?.studied).toBe(false);
    // Today (Sat 10) still lists it, unticked.
    const d10 = planDayFor(currentPlan(at(START)), START)!;
    expect(d10.topics.some((t) => t.subtopicId === IVC)).toBe(true);
    // Study every OTHER row on day 1; IVC moves to Sun 11.
    for (const t of d10.topics) if (t.kind === 'topic' && t.subtopicId !== IVC) markTopicStudied(t.subtopicId, true, START);
    setClock('2026-10-11');
    const d11 = planDayFor(currentPlan(at('2026-10-11')), '2026-10-11')!;
    expect(d11.topics.some((t) => t.subtopicId === IVC)).toBe(true);
    // 6/10 correct does auto-study it and it leaves the plan.
    const ids = getSubtopic(IVC)!.mcqs.map((m) => m.id).slice(0, 10);
    updateState((s) => ids.slice(0, 6).forEach((q) => (s.progress[q] = { seen: 1, correct: 1, wrong: 0, lastResult: 'correct' })));
    expect(plannerProgress()[IVC]?.studied).toBe(true);
  });
});

describe('D4/N22 — no behind banner on days off, the light day or exam eve; never "move the exam date"', () => {
  for (const iso of ['2026-11-08', '2027-01-14', '2027-01-23']) {
    it(`${iso}: no behind banner on Today or the Planner`, () => {
      setClock(iso);
      expect(currentPlan(at(iso)).summary.daysBehind).toBeGreaterThan(7);
      const t = renderInto(today);
      expect(t.querySelector('.today-behind')).toBeNull();
      expect(t.textContent).not.toMatch(/reduced plan/);
      const p = renderInto(planner);
      expect(p.textContent).not.toMatch(/reduced plan/);
    });
  }
  it('a normal far-behind day shows the banner with only time / quick-pass options', () => {
    setClock('2026-12-21');
    const t = renderInto(today);
    const banner = t.querySelector('.today-behind')!;
    expect(banner.textContent).toMatch(/reduced plan/);
    expect(banner.textContent).not.toMatch(/exam date/i);
    expect(banner.textContent).toMatch(/Add study time/);
    expect(banner.textContent).toMatch(/quick pass/);
  });
});

describe('N21 — the Plan header never shows a finish date in the past', () => {
  for (const iso of ['2026-12-13', '2027-01-14', '2027-01-22']) {
    it(`${iso}: finish date ≥ today or an honest message`, () => {
      setClock(iso);
      const p = renderInto(planner);
      const fit = p.querySelector('.planner-hero .feasibility')!.textContent ?? '';
      expect(fit).not.toMatch(/On track/);
      expect(fit).toMatch(/^Behind \u2014/);
      const m = /new finish date (\d{1,2} \w{3} \d{4})/.exec(fit);
      if (m) expect(new Date(m[1]!).getTime()).toBeGreaterThanOrEqual(new Date(`${iso}T00:00:00`).getTime());
    });
  }
  it('all Prelims topics studied → "All topics covered"', () => {
    const plan = currentPlan(at(START));
    expect(planner.planFitLine({ ...plan.summary, prelimsStudied: plan.summary.prelimsTotal }, plan, START)).toBe('All topics covered.');
  });
});

describe('D30 / N28 — unit header before the plan starts, no "day 1 of 1"', () => {
  it('Fri 9 Oct: "Plan starts Sat 10 Oct", not "Day 1 of 6"', () => {
    setClock('2026-10-09');
    const p = renderInto(planner);
    const head = p.querySelector('.unit-head')!;
    expect(head.textContent).toContain('Plan starts Sat 10 Oct');
    expect(head.textContent).not.toMatch(/Day \d+ of \d+/);
  });
  it('revision-cycle / catch-up days do not show "day 1 of 1"', () => {
    setClock('2026-12-14');
    const t = renderInto(today);
    expect(t.textContent).not.toMatch(/day 1 of 1\b/i);
    const p = renderInto(planner);
    expect(p.textContent).not.toMatch(/Day 1 of 1\b/);
  });
});

function app(): HTMLElement {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  document.body.appendChild(root);
  renderApp(root);
  return root;
}
const viewOf = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>('#view')!;
function btnText(root: ParentNode, re: RegExp): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => re.test(b.textContent ?? ''));
}

describe('N8 / N23 — tomorrow preview re-planned after today; week-test number matches', () => {
  it('a topic studied ahead today is not previewed for tomorrow', () => {
    setClock('2026-10-13');
    // Study ALL of today's rows, then tomorrow's first topic (ahead of schedule).
    const today13 = planDayFor(currentPlan(at('2026-10-13')), '2026-10-13')!;
    for (const t of today13.topics) if (t.kind === 'topic') markTopicStudied(t.subtopicId, true, '2026-10-13');
    const tomorrow = planDayFor(currentPlan(at('2026-10-14')), '2026-10-14')!;
    const ahead = tomorrow.blocks.flatMap((b) => b.topics ?? []).find((t) => t.kind === 'topic')!;
    const before = tomorrowPreview(currentPlan(at('2026-10-13')), '2026-10-13')!.textContent ?? '';
    expect(before).toContain(ahead.name);
    markTopicStudied(ahead.subtopicId, true, '2026-10-13');
    const line = tomorrowPreview(currentPlan(at('2026-10-13')), '2026-10-13')!.textContent ?? '';
    expect(line).toMatch(/^Tomorrow \(Wed 14 Oct\): /);
    expect(line).not.toContain(ahead.name);
  });
  it('Fri 16 preview names the same "Week test N" as Saturday\u2019s row', () => {
    setClock('2026-10-16');
    const d16 = planDayFor(currentPlan(at('2026-10-16')), '2026-10-16')!;
    for (const r of dayRows(d16, '2026-10-16')) {
      if (r.topic && r.task === 'topic') markTopicStudied(r.topic.subtopicId, true, '2026-10-16');
    }
    const line = tomorrowPreview(currentPlan(at('2026-10-16')), '2026-10-16')!.textContent ?? '';
    const sat = planDayFor(currentPlan(at('2026-10-17')), '2026-10-17')!;
    const row = dayRows(sat, '2026-10-17').find((r) => r.task === 'test')!;
    const label = rowView(row, { reviseCtx: computeReviseCtx('2026-10-17', sat), day: sat }).label;
    expect(line).toContain(label);
    expect(label).toBe('Week test 1');
  });
});

describe('N9 — the day shows time used and explains the beginner ramp', () => {
  it('a ramp weekday says "First week: 3 h days" and shows used / planned / budget', () => {
    setClock('2026-10-13');
    const d = planDayFor(currentPlan(at('2026-10-13')), '2026-10-13')!;
    expect(isRampDay(d, loadState().settings.dailyStudyMinutes)).toBe(true);
    const root = renderInto(today);
    expect(root.textContent).toMatch(/First week: 3 h days/);
    expect(root.textContent).toMatch(/0 m used of .* planned · today’s budget 3 h/);
  });
});

describe('N10 — the weakest-area drill is ~35 min; the rest is an explicit revision row', () => {
  it('nothing missed: weak row 35 min + "Revision — this week’s topics" row', () => {
    setClock('2026-10-11');
    const d10 = planDayFor(currentPlan(at(START)), START)!;
    for (const t of d10.topics) if (t.kind === 'topic') markTopicStudied(t.subtopicId, true, START);
    const d = planDayFor(currentPlan(at('2026-10-11')), '2026-10-11')!;
    const catchup = d.blocks.find((b) => b.kind === 'catchup');
    expect(catchup).toBeDefined();
    const rows = dayRows(d, '2026-10-11').filter((r) => r.block === catchup);
    const weak = rows.find((r) => r.task === 'weak');
    expect(weak).toBeDefined();
    {
      expect(weak!.minutes).toBe(Math.min(catchup!.minutes, WEAK_DRILL_MINUTES));
      const rest = rows.find((r) => r.weekRevision);
      expect(catchup!.minutes - WEAK_DRILL_MINUTES).toBeGreaterThanOrEqual(15);
      {
        expect(rest?.minutes).toBe(catchup!.minutes - WEAK_DRILL_MINUTES);
        expect(rowView(rest!, { reviseCtx: computeReviseCtx('2026-10-11', d), day: d }).label).toBe('Revision \u2014 this week\u2019s topics');
      }
    }
  });
});

describe('N11 — every practice set has its own URL; results survive navigation', () => {
  it('CA starter set → #/set/…; result kept after Today and Back; hash change re-renders', () => {
    const root = app();
    const d = planDayFor(currentPlan(at(START)), START)!;
    const caRow = dayRows(d, START).find((r) => r.task === 'ca')!;
    rowView(caRow, { reviseCtx: computeReviseCtx(START, d), day: d }).onClick();
    const route = setRoute({ key: caRow.key, dateISO: START });
    expect(location.hash).toBe(`#${route}`);
    btnText(viewOf(root), /Start the \d+-question set/)!.click();
    viewOf(root).querySelector<HTMLButtonElement>('.option-list button')!.click();
    btnText(viewOf(root), /End session/)!.click();
    expect(viewOf(root).querySelector('[data-state="set-done"]')).not.toBeNull();
    navigate('/');
    expect(viewOf(root).querySelector('.hero')).not.toBeNull();
    navigate(route);
    expect(viewOf(root).textContent).toMatch(/Set done \u2713/);
    // A typed hash change to Today re-renders Today.
    location.hash = '#/';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(viewOf(root).querySelector('.hero')).not.toBeNull();
  });
});

describe('N12 — results state each line / button once', () => {
  it('Learn practice results: score line once, footer says "Next up"', () => {
    const root = app();
    navigate('/learn/ment-number-system/practice');
    btnText(viewOf(root), /^Start practice/)!.click();
    viewOf(root).querySelector<HTMLButtonElement>('.option-list button')!.click();
    btnText(viewOf(root), /End session/)!.click();
    const text = viewOf(root).textContent ?? '';
    expect(text.match(/\d+\/\d+ correct/g)?.length).toBe(1);
  });
  it('stored mock results: "Review answers" and "Today" appear once each', async () => {
    const mock = await import('../mock');
    const sub = getSubtopic('hist-ancient-ivc')!.mcqs.slice(0, 2);
    const now = Date.now();
    recordTestAttempt({
      at: now, dateISO: localISO(now), reviewIds: [sub[1]!.id], kind: 'week-test', total: 2, attempted: 2, correct: 1, wrong: 1, skipped: 0,
      net: 0.67, guessAttempted: 0, guessCorrect: 0, marksLostToWrong: 0.33,
      itemIds: sub.map((i) => i.id), answers: [sub[0]!.answerIndex, (sub[1]!.answerIndex + 1) % 4], confidences: [null, null],
    } as never);
    location.hash = `#/practice/mock/results/${now}`;
    const root = document.createElement('div');
    mock.renderResultsRoute(root);
    const labels = [...root.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(labels.filter((l) => l === 'Review answers').length).toBeLessThanOrEqual(1);
    expect(labels.filter((l) => l === 'Today' || l === 'Back to Today').length).toBe(1);
  });
});

describe('N14 — review never relabels the original attempt', () => {
  it('wrong in the test, right in review → still "Wrong"; Guess + correct → "Guessed — correct"', () => {
    const items = getSubtopic('hist-ancient-ivc')!.mcqs.slice(0, 3);
    const [w, g, s50] = items as [typeof items[0], typeof items[0], typeof items[0]];
    const now = Date.now();
    recordTestAttempt({
      at: now, dateISO: localISO(now), reviewIds: [w.id, g.id, s50.id], kind: 'week-test', total: 3, attempted: 3, correct: 2, wrong: 1, skipped: 0,
      net: 1.67, guessAttempted: 1, guessCorrect: 1, marksLostToWrong: 0.33,
      itemIds: [w.id, g.id, s50.id], answers: [(w.answerIndex + 1) % 4, g.answerIndex, s50.answerIndex], confidences: ['sure', 'guess', 'fifty'],
    } as never);
    // Later answered right in review:
    updateState((st) => { st.progress[w.id] = { seen: 2, correct: 1, wrong: 1, lastResult: 'correct' }; });
    expect(attemptVerdict(loadState().testAttempts as never, w.id, w.answerIndex)).toBe('wrong');
    const app0 = app();
    notebook.openScopedReview([w.id, g.id, s50.id], 'Review', 'lead');
    const root = viewOf(app0);
    const chips = [...root.querySelectorAll('.review-card .chip')].map((c) => c.textContent);
    expect(chips).toEqual(['Wrong', 'Guessed \u2014 correct', '50-50 \u2014 correct']);
  });
});

describe('N15 — weekly revision = due flashcards + this week’s mistakes', () => {
  it('the Sunday weekly-revision row opens #/revise/weekly with both parts', () => {
    setClock('2026-10-11');
    const d10 = planDayFor(currentPlan(at(START)), START)!;
    for (const t of d10.topics) if (t.kind === 'topic') markTopicStudied(t.subtopicId, true, START);
    const ivc = getSubtopic('hist-ancient-ivc')!.mcqs[0]!;
    updateState((st) => { st.notebook[ivc.id] = { id: ivc.id, addedAt: Date.now() - 1000, consecutiveCorrect: 0, graduated: false }; });
    const root = app();
    const d = planDayFor(currentPlan(at('2026-10-11')), '2026-10-11')!;
    const row = dayRows(d, '2026-10-11').find((r) => r.block.kind === 'weekly-revision')!;
    const v = rowView(row, { reviseCtx: computeReviseCtx('2026-10-11', d), day: d });
    expect(v.detail).toMatch(/1 mistake from this week/);
    v.onClick();
    expect(location.hash).toBe('#/revise/weekly');
    expect(viewOf(root).textContent).toMatch(/Part 1: due flashcards · Part 2: this week’s mistakes/);
    expect(revise.weekMistakeIds()).toEqual([ivc.id]);
  });
});

describe('N16 — "View weak topics" opens the weak-topics view', () => {
  it('Revise hub → #/revise/weak', () => {
    const root = app();
    navigate('/revise');
    btnText(viewOf(root), /View weak topics/)!.click();
    expect(location.hash).toBe('#/revise/weak');
  });
});

describe('N17 — the plan-start input stays valid after the start has passed', () => {
  it('min = min(current start, today)', () => {
    setClock('2026-10-19');
    expect(settings.planStartMin('2026-10-10', '2026-10-19')).toBe('2026-10-10');
    const root = document.createElement('div');
    document.body.append(root);
    settings.render(root);
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Plan start date"]')!;
    expect(input.min).toBe('2026-10-10');
    expect(input.checkValidity()).toBe(true);
  });
});

describe('N18 / N26 — current affairs is "up to date", never "studied"; legend states the 50% rule', () => {
  it('Topics: CA subject shows "Up to date through Oct 2026"', () => {
    for (const id of ['ca-national', 'ca-regional', 'ca-international']) markTopicStudied(id, true, START);
    const root = document.createElement('div');
    syllabus.render(root);
    const ca = root.querySelector('[data-anchor="CA"] .track-summary-stat')!.textContent ?? '';
    expect(ca).toMatch(/^Up to date through \w{3} 20\d\d/);
    expect(ca).not.toMatch(/Studied/);
    expect(root.textContent).toMatch(/10 practice answers with at least 50% correct/);
  });
});

describe('N19 / D32 / N24 — layout CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../styles/components.css'), 'utf8');
  it('OMR question column has a 560 px basis and a calmer stem size', () => {
    expect(css).toMatch(/\.omr-question-col\s*\{\s*flex:\s*1 1 560px;/);
    expect(css).toMatch(/\.omr-question-col \.question-text\s*\{\s*font-size:\s*var\(--fs-lg\)/);
  });
  it('Mains timer bar wraps; hero buttons may shrink on phones', () => {
    expect(css).toMatch(/\.mains-timer,\s*\.mains-word-row\s*\{\s*flex-wrap:\s*wrap;/);
    expect(css).toMatch(/\.hero-actions \.btn\s*\{\s*min-width:\s*0;\s*max-width:\s*100%;/);
  });
  it('the routed weak-topics view wraps long names and badges (no overflow at 160%)', () => {
    expect(css).toMatch(/\.weak-gap-name\s*\{\s*min-width:\s*0;\s*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/\.weak-row-badges\s*\{\s*flex-wrap:\s*wrap;/);
  });
  it('legacy --color-* tokens are defined (mock confidence tags look like buttons, D26)', () => {
    const tokens = readFileSync(resolve(__dirname, '../../styles/tokens.css'), 'utf8');
    for (const t of ['--color-border', '--color-surface', '--color-accent', '--color-text']) expect(tokens).toContain(`${t}:`);
  });
});

describe('N25 / N27 — match hint and Telugu intro copy', () => {
  it('a match question hints "1–4 to answer (i)–(iv)"', () => {
    const match = (getSubtopic('pol-fundamental-rights')?.mcqs ?? []).find((m) => m.match);
    if (!match) return;
    const root = document.createElement('div');
    mountQuiz(root, [match], () => undefined);
    expect(root.querySelector('.focus-hints')!.textContent).toContain('to answer (i)\u2013(iv)');
    expect(root.querySelector('.focus-hints')!.textContent).not.toContain('A\u2013D');
  });
  it('Telugu intro heading has no stray "an a"', () => {
    const root = document.createElement('div');
    telugu.render(root);
    expect(root.textContent).not.toMatch(/\ban a syllable/);
  });
});

describe('D26 — confidence buttons expose aria-pressed in drill and mock', () => {
  it('drill: Sure toggles aria-pressed true/false', () => {
    const items = getSubtopic('hist-ancient-ivc')!.mcqs.slice(0, 1);
    const root = document.createElement('div');
    mountQuiz(root, items, () => undefined);
    const sure = btnText(root, /^Sure$/)!;
    expect(sure.getAttribute('aria-pressed')).toBe('false');
    sure.click();
    expect(btnText(root, /^Sure$/)!.getAttribute('aria-pressed')).toBe('true');
  });
  it('mock runner: Sure / 50-50 / Guess are aria-pressed toggles (no radio roles)', () => {
    const src = readFileSync(resolve(__dirname, '../mock.ts'), 'utf8');
    const block = /const confSeg = el\([\s\S]*?\]\);/.exec(src)?.[0] ?? '';
    expect(block).toContain("'aria-pressed': String(active)");
    expect(block).not.toContain("role: 'radio'");
  });
});

describe('D28 — the hero never repeats its title in the context line', () => {
  it('strips a repeated title prefix', () => {
    expect(heroContext('Dress rehearsal', 'Dress rehearsal \u2014 practise the 2-hour format')).toBe('Practise the 2-hour format');
    expect(heroContext('Week test 1', 'Week test 1')).toBe('');
    expect(heroContext('Stone Age', 'Ancient India I')).toBe('Ancient India I');
  });
});

describe('D31 — Start-here phase ranges never overlap', () => {
  it('each phase ends the day before the next starts', () => {
    const root = document.createElement('div');
    start.render(root);
    const rows = [...root.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''));
    const when = rows.map((r) => r[1] ?? '').filter((w) => w.includes('\u2013'));
    for (let i = 0; i + 1 < when.length; i += 1) {
      const end = new Date(when[i]!.split('\u2013')[1]!.trim());
      const nextStart = new Date(when[i + 1]!.split('\u2013')[0]!.trim());
      expect(nextStart.getTime() - end.getTime()).toBe(24 * 3600 * 1000);
    }
  });
});

describe('D34 / D40 — #/notes redirects to Topics; defaults saved on first load', () => {
  it('#/notes → #/topics', () => {
    const root = app();
    navigate('/notes');
    expect(location.hash).toBe('#/topics');
    expect(viewOf(root).textContent).not.toMatch(/All notes/);
  });
  it('a fresh load writes appsc-g1-state', () => {
    localStorage.clear();
    __resetForTests();
    loadState();
    expect(localStorage.getItem('appsc-g1-state')).not.toBeNull();
  });
});
