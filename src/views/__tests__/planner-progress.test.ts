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
    // N6: only questions of studied topics are practised.
    markTopicStudied('econ-agriculture', true, START);
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

describe('Mains practice scope + revision-cycle labels + live behind count (N6/N7/D29)', () => {
  it('Mains practice only picks questions of studied topics (pre- and post-Prelims)', async () => {
    const { getBanks } = await import('../../content/loader');
    const subOf = new Map<string, string>();
    for (const l of getBanks('mains')) if (l.bank.kind === 'mains') for (const it of l.bank.items) if (it.subtopicId) subOf.set(it.id, it.subtopicId);
    // Nothing studied → no Mains answer row anywhere in the plan.
    expect(currentPlan(at(START)).days.some((d) => d.blocks.some((b) => b.kind === 'mains-write'))).toBe(false);
    markTopicStudied('econ-agriculture', true, START);
    const pre = currentPlan(at(START)).days.flatMap((d) => d.blocks).filter((b) => b.kind === 'mains-write');
    expect(pre.length).toBeGreaterThan(0);
    for (const b of pre) expect(subOf.get(b.mainsQuestionId!)).toBe('econ-agriculture');
    setClock('2027-01-25');
    const post = currentPlan(at('2027-01-25'));
    expect(post.summary.postPrelims).toBe(true);
    const ids = post.days.flatMap((d) => d.mainsQuestionIds);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(subOf.get(id)).toBe('econ-agriculture');
    for (const d of post.days) {
      const p = d.mainsPaperRevision;
      if (p) for (const sid of p.subtopicIds) expect(sid).toBe('econ-agriculture');
    }
  });

  it('December labels: "Revise · X" days hold revisits, recovery days say "Catch up · X (new topics)", never day 0 of 0 / (spill)', () => {
    setClock('2026-12-07'); // nothing studied → recovery moves new topics into the revision cycle
    const plan = currentPlan(at('2026-12-07'));
    const dec = plan.days.filter((d) => d.dateISO >= '2026-12-07' && d.dateISO <= '2026-12-20');
    expect(dec.length).toBeGreaterThan(0);
    let catchUp = 0;
    for (const d of dec) {
      for (const b of d.blocks) expect(b.label).not.toContain('(spill)');
      if (!d.unitId) continue;
      expect(d.unitDays, d.dateISO).toBeGreaterThan(0);
      expect(d.unitDay).toBeGreaterThan(0);
      const fresh = d.blocks.some((b) => b.kind === 'subject' && (b.topics ?? []).length > 0);
      if (d.unitTitle?.startsWith('Revise \u00b7 ') && d.unitId !== 'revise-studied') {
        expect(fresh, d.dateISO).toBe(false);
        expect(d.blocks.some((b) => b.kind === 'targeted-revision' && (b.topics ?? []).length > 0), d.dateISO).toBe(true);
      }
      if (fresh) {
        expect(d.unitTitle, d.dateISO).toMatch(/^Catch up \u00b7 .+ \(new topics\)$/);
        catchUp += 1;
      }
    }
    expect(catchUp).toBeGreaterThan(0);
    const root = renderInto(planner);
    expect(root.textContent).not.toContain('(spill)');
    expect(root.textContent).not.toMatch(/day 0 of 0/i);
    const t = renderInto(today);
    expect(t.textContent).not.toMatch(/day 0 of 0/i);
  });

  it('the behind count keeps moving with nothing studied after the on-time coverage end, and >14 days shows the far-behind options', () => {
    const a = currentPlan(at('2026-12-14')).summary.daysBehind;
    setClock('2026-12-21');
    const b = currentPlan(at('2026-12-21')).summary;
    expect(b.daysBehind).toBeGreaterThan(a);
    const banner = behindBanner(b, '2026-12-21')!;
    expect(banner.tone).toBe('reduced');
    const opts = banner.options.join(' | ');
    expect(opts).toMatch(/study time/i);
    // N22 — the exam date is fixed by APPSC: never offered.
    expect(opts).not.toMatch(/exam date/i);
    expect(opts).toMatch(/quick pass/i);
    expect(opts).not.toMatch(/Saturday catch-up/);
  });
});
