/**
 * Planner/study-state fixes at the view level (LOGIC-AUDIT C1/C2/H2/M8,
 * FLOW-QA D4/D19/D20): the honest behind banner, Planner/Today agreement,
 * unit wrap-up gating, Sunday shape at the 360-min default, no tiny blocks and
 * the Mon–Sun "This week" table with what was done.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as today from '../today';
import * as planner from '../planner';
import { currentPlan } from '../../lib/plan';
import { behindBanner, MIN_BLOCK_MIN, planDayFor, type PlanSummary } from '../../engine/planner';
import { isTopicStudied, markTopicStudied } from '../../lib/study-status';
import { __resetForTests, loadState, setPlanStartDate } from '../../state/store';
import { addDaysISO, dayOfWeekISO } from '../../lib/dates';

const START = '2026-10-10';
const at = (iso: string): Date => new Date(`${iso}T10:00:00`);
const setClock = (iso: string): void => void vi.setSystemTime(at(iso));

function renderInto(view: { render: (r: HTMLElement) => void }): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  view.render(root);
  return root;
}

beforeEach(() => {
  localStorage.clear();
  __resetForTests();
  document.body.innerHTML = '';
  vi.useFakeTimers({ toFake: ['Date'] });
  setClock(START);
  setPlanStartDate(START);
});
afterEach(() => vi.useRealTimers());

describe('behind banner copy (D4)', () => {
  const base = (over: Partial<PlanSummary>): PlanSummary =>
    ({
      postPrelims: false,
      daysBehind: 3,
      daysLeft: 90,
      feasible: true,
      spills: [],
      recoveryChanges: ['moved 5 topics into the revision cycle\u2019s first week'],
      feasibilityOptions: [],
      coverageEndISO: '2026-12-06',
      coverageDays: 40,
      ...over,
    }) as PlanSummary;

  it('1–7 days: calm "plan adjusted", sentence case, finish-on-time only when feasible', () => {
    const b = behindBanner(base({}), '2026-10-20')!;
    expect(b.tone).toBe('calm');
    expect(b.title).toBe('You\u2019re 3 days behind \u2014 plan adjusted');
    expect(b.detail.startsWith('Moved 5 topics')).toBe(true);
    expect(b.detail).toContain('finish on time');
    const tight = behindBanner(base({ feasible: false }), '2026-10-20')!;
    expect(tight.detail).not.toContain('finish on time');
  });

  it('> 7 days: "here is the reduced plan" + concrete options; no restart after coverage end', () => {
    const b = behindBanner(base({ daysBehind: 46, feasible: false }), '2026-10-20')!;
    expect(b.tone).toBe('reduced');
    expect(b.title).toBe('You are 46 days behind \u2014 here is the reduced plan');
    expect(b.options.length).toBeGreaterThan(2);
    expect(b.detail).not.toContain('finish on time');
    expect(b.showRestart).toBe(true);
    expect(behindBanner(base({ daysBehind: 46, coverageDays: 0, coverageEndISO: '2026-12-13' }), '2026-12-07')!.showRestart).toBe(false);
    expect(behindBanner(base({ daysLeft: 1 }), '2027-01-23')).toBeNull();
    expect(behindBanner(base({ daysBehind: 0 }), '2026-10-20')).toBeNull();
  });

  it('Today and the Planner agree (H2): both behind, Planner header is not "On track"', () => {
    setClock('2026-10-14'); // nothing studied → behind
    const s = currentPlan(at('2026-10-14')).summary;
    expect(s.daysBehind).toBeGreaterThan(0);
    expect(s.onTrack).toBe(false);
    const t = renderInto(today);
    expect(t.textContent).toContain(`${s.daysBehind} days behind`);
    const p = renderInto(planner);
    expect(p.querySelector('.feasibility')?.textContent).not.toContain('On track');
    expect(p.textContent).toContain(`${s.daysBehind} days behind`);
  });

  it('banner is hidden after the exam-eve and the restart button disappears after coverage end', () => {
    setClock('2026-12-10');
    const t = renderInto(today);
    expect(t.textContent).toContain('behind');
    expect(t.textContent).not.toContain('restart my plan from today');
  });
});

describe('unit wrap-up gating (D19)', () => {
  it('a wrap-up row reads "Finish <unit> first" until every unit topic is studied', () => {
    const plan = currentPlan(at(START));
    const wrapDay = plan.days.find((d) => d.segment === 'coverage' && d.blocks.some((b) => b.kind === 'unit-wrapup'))!;
    const block = wrapDay.blocks.find((b) => b.kind === 'unit-wrapup')!;
    // An on-time learner: every earlier first pass studied on its own day.
    for (const d of plan.days) {
      if (d.dateISO >= wrapDay.dateISO) break;
      for (const id of [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]) markTopicStudied(id, true, d.dateISO);
    }
    setClock(wrapDay.dateISO);
    expect(currentPlan(at(wrapDay.dateISO)).summary.daysBehind).toBe(0);
    let root = renderInto(today);
    expect(root.textContent).toMatch(/Finish .+ first/);
    for (const id of block.unitTestSubtopicIds ?? []) if (!isTopicStudied(id)) markTopicStudied(id, true, wrapDay.dateISO);
    document.body.innerHTML = '';
    root = renderInto(today);
    expect(root.textContent).not.toMatch(/Finish .+ first/);
    expect(root.textContent).toContain('Unit wrap-up');
  });

  it('no flexible block is ever under MIN_BLOCK_MIN minutes (on time and far behind)', () => {
    for (const iso of [START, '2026-12-07']) {
      for (const d of currentPlan(at(iso)).days) {
        for (const b of d.blocks) {
          if (['revise', 'targeted-revision', 'catchup', 'weakest-area', 'weekly-revision', 'week-test-review', 'mock-review'].includes(b.kind)) {
            expect(b.minutes, `${b.kind} on ${d.dateISO} (today ${iso})`).toBeGreaterThanOrEqual(MIN_BLOCK_MIN);
          }
        }
      }
    }
  });
});

describe('Sunday shape at the 360-min default (D20)', () => {
  it('fresh state defaults Sunday to 360; a coverage Sunday is unit 240 + MA 30 + weekly 30 + CA 45 + Telugu 15', () => {
    expect(loadState().settings.sundayStudyMinutes).toBe(360);
    const plan = currentPlan(at(START));
    const sun = plan.days.find((d) => d.segment === 'coverage' && dayOfWeekISO(d.dateISO) === 0 && d.mockPaper === null)!;
    expect(sun.budgetMin).toBe(360);
    const kinds = sun.blocks.map((b) => b.kind);
    expect(kinds.slice(-4)).toEqual(['ment-practice', 'weekly-revision', 'ca-roundup', 'telugu']);
    const main = sun.blocks.filter((b) => b.kind === 'subject' || b.kind === 'unit-wrapup' || b.kind === 'catchup');
    expect(main.reduce((a, b) => a + b.minutes, 0)).toBe(240);
  });

  it('the fortnightly Mains answer is on the first December revision Sunday — also when behind', () => {
    const mainsOn = (iso: string): boolean =>
      planDayFor(currentPlan(at(iso)), '2026-12-13')?.blocks.some((b) => b.kind === 'mains-write') ?? false;
    expect(mainsOn(START)).toBe(true);
    setClock('2026-12-07'); // far behind → recovery spill on the revision Sundays
    expect(mainsOn('2026-12-07')).toBe(true);
  });
});

describe('Planner "This week" = the Mon–Sun calendar week with what was done (M8)', () => {
  it('shows all 7 days, past days with the topics studied that day', () => {
    setClock('2026-10-14'); // Wed
    markTopicStudied('hist-ancient-stone-age', true, '2026-10-12'); // Mon
    const root = renderInto(planner);
    const rows = root.querySelectorAll('.planner-week-table tbody tr');
    expect(rows.length).toBe(7);
    expect(rows[0]!.textContent).toContain('Mon');
    expect(rows[0]!.textContent).toContain('\u2713');
    expect(rows[2]!.className).toContain('is-today');
    expect(addDaysISO('2026-10-12', 6)).toBe('2026-10-18');
  });
});
