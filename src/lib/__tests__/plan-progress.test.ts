/**
 * Progress-aware re-plan (LOGIC-AUDIT C1/C2/H2, FLOW-QA D1/D3) — a SIMULATED
 * LEARNER on the real content. Each simulated day builds the live plan for that
 * date, ticks every topic row Today shows (Mark as studied, dated that day),
 * then moves on. The plan must keep teaching NEW topics, never re-schedule a
 * topic studied on an earlier day, and report 0 days behind; skipping a day
 * makes it 1 behind and catching up returns it to 0.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { currentPlan } from '../plan';
import { planDayFor, type Plan, type PlanDay } from '../../engine/planner';
import { __resetForTests, setPlanStartDate, loadState } from '../../state/store';
import { markTopicStudied, topicStudyFrom } from '../study-status';
import { addDaysISO, dayOfWeekISO } from '../dates';

const START = '2026-10-10'; // Sat — the real plan start (day-1 orientation)

/** A local-midday Date for an ISO day (stable in any timezone). */
const at = (iso: string): Date => new Date(`${iso}T12:00:00`);

/** Every real (tickable) topic id on a Today day, in row order. */
function rowTopicIds(day: PlanDay): string[] {
  const out: string[] = [];
  for (const b of day.blocks) for (const t of b.topics ?? []) if (t.kind === 'topic' && t.pass !== 'deepen') out.push(t.subtopicId);
  return out;
}

/** Study every Today row of `iso` (returns the plan + the ids ticked). */
function studyDay(iso: string): { plan: Plan; ids: string[] } {
  const plan = currentPlan(at(iso));
  const day = planDayFor(plan, iso)!;
  const ids = rowTopicIds(day);
  for (const id of ids) markTopicStudied(id, true, iso);
  return { plan, ids };
}

describe('progress-aware re-plan — a learner who studies every Today row', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
    setPlanStartDate(START);
  });

  it('10 days: never re-taught, new topics every study day, daysBehind 0, Planner/Today agree', () => {
    const everStudied = new Map<string, string>();
    for (let i = 0; i < 10; i += 1) {
      const iso = addDaysISO(START, i);
      const { plan, ids } = studyDay(iso);
      // Never re-teach a topic studied on an EARLIER day.
      for (const id of ids) {
        const prev = everStudied.get(id);
        expect(prev === undefined || prev === iso, `${id} re-taught on ${iso} (studied ${prev})`).toBe(true);
      }
      // New topics every study day (Saturdays are week tests, no new topics).
      if (dayOfWeekISO(iso) !== 6 || i === 0) expect(ids.length, `no topics on ${iso}`).toBeGreaterThan(0);
      expect(plan.summary.daysBehind, `behind on ${iso}`).toBe(0);
      // H2 — one source of truth: the Planner header (onTrack) agrees with Today.
      expect(plan.summary.onTrack).toBe(plan.summary.daysBehind === 0);
      expect(plan.summary.behindBy).toBe(0);
      for (const id of ids) everStudied.set(id, iso);
    }
    // A studied topic shows ticked TODAY (studiedOn === today keeps it on the row).
    const last = addDaysISO(START, 9);
    const again = planDayFor(currentPlan(at(last)), last)!;
    const state = loadState();
    expect(rowTopicIds(again).every((id) => topicStudyFrom(state, id).status === 'studied')).toBe(true);
  });

  it('CA first passes are tickable rows (C2): the CA block carries its topic', () => {
    const plan = currentPlan(at(START));
    const day1 = planDayFor(plan, START)!;
    const ca = day1.blocks.find((b) => b.kind === 'ca');
    expect(ca?.topics?.[0]?.subtopicId).toBe(ca?.caSubtopicId);
    // Every first-pass id of every day is reachable from a block's topics.
    for (const d of plan.days) {
      const rowIds = new Set(rowTopicIds(d));
      for (const id of [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]) expect(rowIds.has(id), `${id} on ${d.dateISO}`).toBe(true);
    }
  });

  it('skip a day → 1 day behind; catch up → 0', () => {
    studyDay(START); // Sat
    studyDay(addDaysISO(START, 1)); // Sun
    const mon = addDaysISO(START, 2);
    const tue = addDaysISO(START, 3);
    // Mon skipped entirely. On Tue the learner is 1 day behind.
    const tuePlan = currentPlan(at(tue));
    expect(tuePlan.summary.daysBehind).toBe(1);
    expect(tuePlan.summary.onTrack).toBe(false);
    expect(tuePlan.summary.behindBy).toBeGreaterThan(0);
    // Monday's topics are now Tuesday's first rows (continued, not lost).
    const tueIds = rowTopicIds(planDayFor(tuePlan, tue)!);
    const monCanonical = rowTopicIds(planDayFor(currentPlan(at(mon)), mon)!);
    expect(tueIds.some((id) => monCanonical.includes(id))).toBe(true);
    // Catch up: study the missed Monday topics today.
    for (const id of monCanonical) markTopicStudied(id, true, tue);
    expect(currentPlan(at(tue)).summary.daysBehind).toBe(0);
  });

  it('"day N of M" counts days already spent on the unit (never resets to day 1)', () => {
    studyDay(START);
    studyDay(addDaysISO(START, 1));
    const mon = addDaysISO(START, 2);
    const day = planDayFor(currentPlan(at(mon)), mon)!;
    if (day.unitId === 'unit-ancient-1' || day.unitTitle?.startsWith('Ancient India I')) {
      expect(day.unitDay).toBeGreaterThan(1);
    }
    expect(day.unitDay).toBeLessThanOrEqual(day.unitDays);
  });
});
