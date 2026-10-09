import { describe, it, expect } from 'vitest';
import {
  buildPlan,
  feasibilityLine,
  planDayFor,
  availableDrill,
  subtopicMinutes,
  fastPassMinutes,
  TIME,
  PER_TOPIC_DRILL_QUOTA,
  MAINS_PER_DAY,
  POST_PRELIMS_HORIZON_DAYS,
  computePlanAnchors,
  buildMockSchedule,
  QUICK_MIN,
  type BuildPlanOpts,
  type PlanDay,
  type PlanSequence,
  type PlanSubtopic,
} from '../planner';
import { daysUntilExam, dayOfWeekISO, addDaysISO, diffDaysISO } from '../../lib/dates';
import type { LearningStream } from '../../content/plan-types';

/**
 * A rhythm FIXTURE mirroring the real Prelims subject shape: History is the
 * TIGHT subject (many topics), the others are smaller, plus MENT (three streams)
 * and CA (three rotating topics). It exercises weekday→subject mapping,
 * reallocation of a finished subject's slot, sequence order, FULL/QUICK depth
 * and the MENT lane. Orders are globally ascending; a handful of `*-ap-*` ids
 * exercise the AP-first FULL rule. Returns both the subtopics and the matching
 * learning sequence the planner packs in.
 */
const AP_RE = /-ap-|andhra|ap-culture|ap-reorganisation|ap-economy/;

function makeFixture(): { subtopics: PlanSubtopic[]; sequence: PlanSequence } {
  const bands: Array<PlanSubtopic['band']> = ['A', 'B', 'C', 'D'];
  let order = 1;
  const order_: Record<string, string[]> = {};
  const mentStreams: Record<string, LearningStream> = {};
  const subtopics: PlanSubtopic[] = [];

  const build = (
    code: string,
    track: 'paper1' | 'paper2',
    n: number,
    apIdx: number[] = [],
  ): void => {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const id = apIdx.includes(i) ? `${code.toLowerCase()}-ap-${i}` : `${code.toLowerCase()}-${i}`;
      ids.push(id);
      subtopics.push({
        id,
        name: `${code} ${i}`,
        order: order++,
        subjectCode: code,
        track,
        band: bands[i % 4],
        mcqCount: (i % 5) * 8,
        examPointCount: i % 4,
      });
    }
    order_[code] = ids;
  };

  build('HIST', 'paper1', 30, [10, 20, 29]);
  build('POL', 'paper1', 12);
  build('ECON', 'paper1', 10, [8, 9]);
  build('GEO', 'paper1', 6, [5]);
  build('SCI', 'paper2', 7);
  // MENT with three interleaved streams (ordering must be preserved per stream).
  {
    const streams: LearningStream[] = ['quant', 'reasoning', 'abilities'];
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const id = `ment-${i}`;
      ids.push(id);
      const stream = streams[i % 3]!;
      mentStreams[id] = stream;
      subtopics.push({
        id,
        name: `MENT ${i}`,
        order: order++,
        subjectCode: 'MENT',
        track: 'paper2',
        band: bands[i % 4],
        mcqCount: (i % 4) * 6,
        examPointCount: i % 3,
      });
    }
    order_['MENT'] = ids;
  }
  // CA ids must match the fixed rotation focus ids the engine references.
  const caIds = ['ca-regional', 'ca-national', 'ca-international'];
  order_['CA'] = caIds;
  const caBands: Array<PlanSubtopic['band']> = ['A', 'B', 'C'];
  caIds.forEach((id, i) => {
    subtopics.push({ id, name: `CA ${i}`, order: order++, subjectCode: 'CA', track: 'paper2', band: caBands[i], mcqCount: 10, examPointCount: 2 });
  });

  return { subtopics, sequence: { order: order_, mentStreams } };
}

/** `count` MAINS-track subtopics — the parallel track (excluded from the rhythm). */
function makeMainsSubjects(count = 4): PlanSubtopic[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i + 1}`,
    order: 5000 + i,
    subjectCode: i % 2 === 0 ? 'TEL' : 'ENG',
    track: 'mains' as const,
    mcqCount: 0,
  }));
}

const MAINS_BANK = ['q1', 'q2', 'q3', 'q4', 'q5'];

/** Base opts anchored on the real exam window (today = Wed 30 Sep 2026). */
function baseOpts(overrides: Partial<BuildPlanOpts> = {}): BuildPlanOpts {
  const fx = makeFixture();
  return {
    subtopics: [...fx.subtopics, ...makeMainsSubjects()],
    sequence: fx.sequence,
    progress: {},
    mainsQuestionIds: MAINS_BANK,
    pyqFrequency: Object.fromEntries(fx.subtopics.map((s) => [s.id, s.order])),
    startISO: '2026-09-30',
    todayISO: '2026-09-30',
    examDateISO: '2026-11-15',
    ...overrides,
  };
}

/** All coverage days (before the coverage-end date), the weekday subject block. */
function subjectBlockOf(day: PlanDay): PlanDay['blocks'][number] | undefined {
  return day.blocks.find((b) => b.kind === 'subject' || b.kind === 'catchup');
}

/**
 * The derived anchors for the fixture window (today = start = Wed 30 Sep 2026,
 * exam = Sun 15 Nov 2026). 47 days < 8 weeks → the SHORT-WINDOW fallback, which
 * reproduces the old calendar exactly (coverage-end 4 Nov, final start 5 Nov,
 * light 14 Nov, exam 15 Nov). Used in place of the retired hardcoded constants.
 */
const FX = computePlanAnchors('2026-11-15', '2026-09-30');

/** Map subtopic id → subjectCode for the fixture. */
function subjectOf(opts: BuildPlanOpts): Map<string, string> {
  return new Map(opts.subtopics.map((s) => [s.id, s.subjectCode] as const));
}

describe('availableDrill / PER_TOPIC_DRILL_QUOTA', () => {
  it('caps a topic at the per-topic quota and floors empty/negative at 0', () => {
    expect(PER_TOPIC_DRILL_QUOTA).toBeGreaterThanOrEqual(20);
    expect(PER_TOPIC_DRILL_QUOTA).toBeLessThanOrEqual(25);
    expect(availableDrill(62)).toBe(PER_TOPIC_DRILL_QUOTA);
    expect(availableDrill(PER_TOPIC_DRILL_QUOTA + 5)).toBe(PER_TOPIC_DRILL_QUOTA);
    expect(availableDrill(5)).toBe(5);
    expect(availableDrill(0)).toBe(0);
    expect(availableDrill(-3)).toBe(0);
  });
});

describe('rhythm — weekday subject mapping + reallocation', () => {
  it('maps Mon→HIST, Tue→POL, Wed→ECON, Thu→GEO, Fri→SCI in the first week', () => {
    const { days } = buildPlan(baseOpts());
    const byDate = new Map(days.map((d) => [d.dateISO, d] as const));
    // First week (before any subject finishes) the owner teaches its own slot.
    expect(subjectBlockOf(byDate.get('2026-09-30')!)?.subjectCode).toBe('ECON'); // Wed
    expect(subjectBlockOf(byDate.get('2026-10-01')!)?.subjectCode).toBe('GEO'); // Thu
    expect(subjectBlockOf(byDate.get('2026-10-02')!)?.subjectCode).toBe('SCI'); // Fri
    expect(subjectBlockOf(byDate.get('2026-10-05')!)?.subjectCode).toBe('HIST'); // Mon
    expect(subjectBlockOf(byDate.get('2026-10-06')!)?.subjectCode).toBe('POL'); // Tue
    // Sunday catch-up is a History block.
    expect(subjectBlockOf(byDate.get('2026-10-04')!)?.subjectCode).toBe('HIST');
  });

  it('reallocates a finished subject\u2019s weekday slot to the neediest subject', () => {
    const { days, summary } = buildPlan(baseOpts());
    expect(summary.reallocations.length).toBeGreaterThan(0);
    const byDate = new Map(days.map((d) => [d.dateISO, d] as const));
    for (const r of summary.reallocations) {
      const dow = dayOfWeekISO(r.dateISO);
      // The slot's calendar owner is NOT the subject that actually taught it.
      const owner = ({ 1: 'HIST', 2: 'POL', 3: 'ECON', 4: 'GEO', 5: 'SCI' } as Record<number, string>)[dow] ?? 'HIST';
      expect(r.fromSubject).toBe(owner);
      expect(r.toSubject).not.toBe(owner);
      expect(subjectBlockOf(byDate.get(r.dateISO)!)?.subjectCode).toBe(r.toSubject);
    }
  });
});

describe('rhythm — sequence order respected', () => {
  it('first-passes every subject in learning-sequence order (MENT streams too)', () => {
    const opts = baseOpts();
    const { days } = buildPlan(opts);
    const subj = subjectOf(opts);
    const seq = opts.sequence!.order;
    // Per subject, the chronological first-pass order equals the sequence order.
    const firstPassBySubject = new Map<string, string[]>();
    for (const d of days) {
      for (const id of [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]) {
        const code = subj.get(id)!;
        const arr = firstPassBySubject.get(code) ?? [];
        arr.push(id);
        firstPassBySubject.set(code, arr);
      }
    }
    for (const code of ['HIST', 'POL', 'ECON', 'GEO', 'SCI', 'MENT']) {
      const got = firstPassBySubject.get(code) ?? [];
      const want = (seq[code] ?? []).filter((id) => got.includes(id));
      expect(got).toEqual(want);
    }
    // Each MENT stream is itself in order (a subsequence of the MENT order).
    const mentOrder = seq['MENT'] ?? [];
    const streams = opts.sequence!.mentStreams!;
    const mentFirst = firstPassBySubject.get('MENT') ?? [];
    for (const stream of ['quant', 'reasoning', 'abilities'] as const) {
      const wantStream = mentOrder.filter((id) => streams[id] === stream);
      const gotStream = mentFirst.filter((id) => streams[id] === stream);
      expect(gotStream).toEqual(wantStream);
    }
  });
});

describe('rhythm — mock schedule (derived from exam date, no hardcoded calendar)', () => {
  it('schedules exactly the DERIVED mocks (buildMockSchedule), alternating from Paper-II', () => {
    const { days, summary } = buildPlan(baseOpts());
    const schedule = buildMockSchedule('2026-09-30', FX);
    const inWindow = [...schedule.keys()].filter((d) => d >= '2026-09-30' && d <= FX.examISO).sort();
    const mockDays = days.filter((d) => d.phase === 'mock');
    expect(mockDays.map((d) => d.dateISO).sort()).toEqual(inWindow);
    for (const d of mockDays) expect(d.mockPaper).toBe(schedule.get(d.dateISO)!.paper);
    // No non-mock day carries a mock paper.
    for (const d of days.filter((d) => d.phase !== 'mock')) expect(d.mockPaper).toBeNull();
    // Short-window fallback → every mock is a Saturday, series starts Paper-II.
    for (const dateISO of inWindow) expect(dayOfWeekISO(dateISO)).toBe(6);
    expect(schedule.get(inWindow[0]!)!.paper).toBe('paper2');
    // Per-paper series numbers are 1..N, non-repeating.
    const nums = (p: 'paper1' | 'paper2'): number[] =>
      summary.mockList.filter((m) => m.paper === p).map((m) => m.mockNumber).sort((a, b) => a - b);
    expect(nums('paper2')).toEqual(nums('paper2').map((_, i) => i + 1));
    expect(nums('paper1')).toEqual(nums('paper1').map((_, i) => i + 1));
    expect(summary.mockList.length).toBe(inWindow.length);
  });
});

describe('rhythm — coverage end / final window / exam', () => {
  it('introduces no new topics after the coverage-end date (except reported spill)', () => {
    const { days, summary } = buildPlan(baseOpts());
    const spilledIds = new Set(summary.spills.flatMap((s) => s.topicIds));
    for (const d of days) {
      if (d.dateISO <= FX.coverageEndISO) continue;
      for (const id of [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]) {
        expect(spilledIds.has(id)).toBe(true);
        expect(d.dateISO <= FX.spillDates[1]).toBe(true);
      }
    }
    expect(FX.finalStartISO > FX.coverageEndISO).toBe(true);
  });

  it('keeps the light day (exam − 1) LIGHT (≤ 90 min, no mock) and the exam day empty', () => {
    const { days } = buildPlan(baseOpts());
    const light = days.find((d) => d.dateISO === FX.lightISO)!;
    expect(light.light).toBe(true);
    expect(light.plannedMinutes).toBeLessThanOrEqual(90);
    expect(light.mockPaper).toBeNull();
    const exam = days.find((d) => d.dateISO === FX.examISO)!;
    expect(exam.plannedMinutes).toBe(0);
    expect(exam.blocks).toEqual([]);
  });
});

describe('rhythm — budget fitting', () => {
  it('never schedules a day beyond its budget, for 180 / 240 / 360', () => {
    for (const budget of [180, 240, 360]) {
      const { days, summary } = buildPlan(baseOpts({ dailyBudgetMin: budget, weekendBudgetMin: budget }));
      for (const d of days) {
        expect(d.plannedMinutes).toBeLessThanOrEqual(d.budgetMin);
        expect(d.budgetMin).toBeLessThanOrEqual(budget);
      }
      // Every prelims topic is still first-passed exactly once at each budget.
      const scheduled = days.flatMap((d) => [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]);
      expect(new Set(scheduled).size).toBe(summary.prelimsTotal);
    }
  });
});

describe('rhythm — every prelims topic first-passed exactly once', () => {
  it('covers the whole fixture scope once (theory + aptitude)', () => {
    const opts = baseOpts();
    const { days, summary } = buildPlan(opts);
    const scheduled = days.flatMap((d) => [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]);
    expect(scheduled.length).toBe(summary.prelimsTotal);
    expect(new Set(scheduled).size).toBe(summary.prelimsTotal);
    // Mains-track subtopics never appear in the schedule.
    const mainsIds = new Set(makeMainsSubjects().map((s) => s.id));
    for (const id of scheduled) expect(mainsIds.has(id)).toBe(false);
  });
});

describe('rhythm — AP topics FULL unless reported', () => {
  it('studies every AP topic at FULL depth (or lists it in the spill report)', () => {
    const opts = baseOpts();
    const { days, summary } = buildPlan(opts);
    const passById = new Map<string, string>();
    for (const d of days) for (const t of d.topics) if (t.kind === 'topic') passById.set(t.subtopicId, t.pass);
    const spilledIds = new Set(summary.spills.flatMap((s) => s.topicIds));
    const apIds = opts.subtopics.filter((s) => s.track !== 'mains' && AP_RE.test(s.id)).map((s) => s.id);
    expect(apIds.length).toBeGreaterThan(0);
    for (const id of apIds) {
      const full = passById.get(id) === 'full';
      expect(full || spilledIds.has(id)).toBe(true);
    }
  });
});

describe('rhythm — no Mains before Prelims', () => {
  it('schedules no mains questions and no essay on any pre-exam day', () => {
    const { days } = buildPlan(baseOpts());
    for (const d of days) {
      expect(d.mainsQuestionIds).toEqual([]);
      expect(d.essayPractice).toBe(false);
      expect(d.languageBlock).toBeNull();
    }
  });
});

describe('rhythm — Telugu on Tue/Thu/Sun', () => {
  it('flags teluguBlock exactly on non-mock Tue/Thu/Sun (coverage + final)', () => {
    const { days } = buildPlan(baseOpts());
    for (const d of days) {
      const dow = dayOfWeekISO(d.dateISO);
      const isTeluguDow = dow === 0 || dow === 2 || dow === 4;
      const eligible = isTeluguDow && d.phase !== 'mock' && !d.light && d.dateISO !== FX.examISO;
      expect(d.teluguBlock).toBe(eligible);
    }
  });
});

describe('rhythm — spaced revision (+3 / +10, AP/band-A +21)', () => {
  it('every revise list is drawn from topics first-passed 3, 10 or 21 days earlier', () => {
    const opts = baseOpts();
    const { days } = buildPlan(opts);
    const byId = new Map(opts.subtopics.map((s) => [s.id, s] as const));
    const isApA = (id: string): boolean => AP_RE.test(id) || byId.get(id)?.band === 'A';
    const firstPassByDate = new Map<string, string[]>();
    for (const d of days) {
      for (const id of [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]) {
        const arr = firstPassByDate.get(d.dateISO) ?? [];
        arr.push(id);
        firstPassByDate.set(d.dateISO, arr);
      }
    }
    const minus = (iso: string, n: number): string => {
      const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - n * 86400000;
      return new Date(t).toISOString().slice(0, 10);
    };
    let sawPlus3 = false;
    for (const d of days) {
      if (d.reviseSubtopicIds.length === 0) continue;
      const at3 = new Set(firstPassByDate.get(minus(d.dateISO, 3)) ?? []);
      const at10 = new Set(firstPassByDate.get(minus(d.dateISO, 10)) ?? []);
      const at21 = firstPassByDate.get(minus(d.dateISO, 21)) ?? [];
      const allowed = new Set<string>([...at3, ...at10, ...at21.filter(isApA)]);
      for (const id of d.reviseSubtopicIds) expect(allowed.has(id)).toBe(true);
      if (d.reviseSubtopicIds.some((id) => at3.has(id))) sawPlus3 = true;
    }
    expect(sawPlus3).toBe(true);
  });
});

describe('rhythm — Mental Ability lane', () => {
  it('first-passes all MENT topics then runs practice sets', () => {
    const { days, summary } = buildPlan(baseOpts());
    expect(summary.mentAllPassedISO).not.toBe('');
    expect(summary.mentPracticeSets).toBeGreaterThan(0);
    // After MENT is done, weekday MENT blocks are practice sets.
    const after = days.filter((d) => d.dateISO > summary.mentAllPassedISO && d.phase === 'learn');
    const withMentPractice = after.filter((d) => d.blocks.some((b) => b.kind === 'ment-practice'));
    expect(withMentPractice.length).toBeGreaterThan(0);
  });
});

describe('rhythm — summary read-out', () => {
  it('reports the rhythm fit fields and prelims scope', () => {
    const opts = baseOpts();
    const { summary } = buildPlan(opts);
    expect(summary.rhythm).toBe(true);
    expect(summary.postPrelims).toBe(false);
    expect(summary.coverageEndISO).toBe(FX.coverageEndISO);
    expect(summary.feasible).toBe(true);
    expect(summary.mockList.length).toBe(buildMockSchedule('2026-09-30', FX).size);
    expect(summary.subjectFit.length).toBe(5);
    for (const f of summary.subjectFit) {
      expect(f.full + f.quick).toBe(f.total);
      // The new depth-floor read-out is populated and self-consistent.
      expect(f.floorTotal).toBeGreaterThanOrEqual(0);
      expect(f.floorTotal).toBeLessThanOrEqual(f.total);
      expect(f.newTopicMinutes).toBeGreaterThan(0);
      for (const id of f.quickFloorTopicIds) expect(summary.infeasibleFloorTopicIds).toContain(id);
    }
    // Every reported infeasible floor is a real topic left at QUICK depth.
    const passById = new Map<string, string>();
    for (const d of buildPlan(opts).days) for (const t of d.topics) if (t.kind === 'topic') passById.set(t.subtopicId, t.pass);
    for (const id of summary.infeasibleFloorTopicIds) expect(passById.get(id)).not.toBe('full');
    // Paper-I minutes/shares are reported for the four theory subjects and sum to ~100%.
    const p1 = ['HIST', 'POL', 'ECON', 'GEO'];
    for (const code of p1) {
      expect(summary.paperOneMinutesBySubject[code]).toBeGreaterThan(0);
      expect(summary.paperOneSharePctBySubject[code]).toBeGreaterThan(0);
    }
    const shareSum = p1.reduce((a, c) => a + summary.paperOneSharePctBySubject[c]!, 0);
    expect(shareSum).toBeGreaterThanOrEqual(98);
    expect(shareSum).toBeLessThanOrEqual(102);
    // Prelims scope excludes the 4 mains subjects.
    expect(summary.mainsSubjectsTotal).toBe(4);
    expect(summary.mainsPerDay).toBe(0);
    // The QUICK depth constant is the documented flat pass.
    expect(QUICK_MIN).toBe(25);
  });

  it('computes inclusive daysLeft / daysTotal and matches the shared countdown', () => {
    const { summary } = buildPlan(baseOpts());
    expect(summary.daysLeft).toBe(daysUntilExam('2026-11-15', '2026-09-30'));
    expect(summary.daysTotal).toBe(summary.daysLeft); // start === today
  });

  it('reflects real prelims progress (mains progress excluded)', () => {
    const opts = baseOpts();
    const firstTheory = opts.subtopics.find((s) => s.track === 'paper1')!.id;
    const firstApt = opts.subtopics.find((s) => s.track === 'paper2')!.id;
    const progress = {
      [firstTheory]: { seen: 3, masteryPct: 100 },
      [firstApt]: { seen: 1, masteryPct: 85 },
      m1: { seen: 9, masteryPct: 100 }, // mains — must NOT count
    };
    const { summary } = buildPlan(baseOpts({ progress }));
    expect(summary.prelimsStudied).toBe(2);
    expect(summary.prelimsMastered).toBe(2);
  });
});

describe('planDayFor & feasibilityLine', () => {
  it('finds the plan day for a given ISO date', () => {
    const plan = buildPlan(baseOpts());
    expect(planDayFor(plan, '2026-09-30')?.status).toBe('today');
    expect(planDayFor(plan, '2020-01-01')).toBeUndefined();
  });

  it('renders an on-track rhythm feasibility line', () => {
    const { summary } = buildPlan(baseOpts());
    const line = feasibilityLine(summary);
    expect(line).toContain('Prelims:');
    expect(line).toMatch(/fixed weekly rhythm/);
    expect(line).toMatch(/On track/);
  });
});

describe('buildPlan — post-prelims MAINS kick-start (unchanged)', () => {
  it('flips to the Mains kick-start once the exam has passed', () => {
    const { days, summary } = buildPlan(
      baseOpts({ startISO: '2026-11-20', todayISO: '2026-11-20', examDateISO: '2026-11-15' }),
    );
    expect(summary.daysLeft).toBe(0);
    expect(summary.postPrelims).toBe(true);
    expect(summary.rhythm).toBe(false);
    expect(days.length).toBe(POST_PRELIMS_HORIZON_DAYS);
    expect(days.every((d) => d.phase === 'mains')).toBe(true);
    for (const d of days) {
      expect(d.mainsQuestionIds.length).toBeGreaterThanOrEqual(2);
      expect(d.languageBlock === 'telugu' || d.languageBlock === 'english').toBe(true);
    }
    expect(days[0]!.languageBlock).toBe('telugu');
    expect(days[1]!.languageBlock).toBe('english');
    expect(days.some((d) => d.essayPractice)).toBe(true);
    expect(MAINS_PER_DAY).toBe(3);
  });

  it('schedules no mains at all when the bank is empty', () => {
    const { days, summary } = buildPlan(
      baseOpts({ startISO: '2026-11-20', todayISO: '2026-11-20', examDateISO: '2026-11-15', mainsQuestionIds: [] }),
    );
    for (const d of days) expect(d.mainsQuestionIds).toEqual([]);
    expect(summary.mainsPerDay).toBe(0);
  });
});

describe('subtopicMinutes / fastPassMinutes / TIME model', () => {
  it('a heavier band and more material cost more minutes', () => {
    expect(subtopicMinutes('A', 10, 5)).toBeGreaterThan(subtopicMinutes('D', 10, 5));
    expect(subtopicMinutes('B', 20, 10)).toBeGreaterThan(subtopicMinutes('B', 0, 0));
    expect(subtopicMinutes(undefined, 0, 0)).toBeGreaterThan(0);
  });

  it('fast pass follows its formula and stays lighter than the full pass', () => {
    expect(fastPassMinutes(20, 10)).toBe(Math.round(10 + 15 + 5));
    expect(fastPassMinutes(0, 0)).toBe(10);
    expect(fastPassMinutes(30, 8)).toBeLessThan(subtopicMinutes('B', 30, 8));
  });

  it('exposes the shared minute-model constants', () => {
    expect(TIME.revisit).toBe(8);
    expect(TIME.mainsAnswer).toBe(20);
    expect(TIME.fullMock).toBe(150);
    expect(TIME.caRefresh).toBe(30);
  });

  it('every coverage-day topic carries a positive minute estimate', () => {
    const { days } = buildPlan(baseOpts());
    const topics = days.filter((d) => d.segment === 'coverage').flatMap((d) => d.topics);
    expect(topics.length).toBeGreaterThan(0);
    for (const t of topics) expect(t.estMinutes).toBeGreaterThan(0);
  });
});

describe('rhythm — POOL-FIX block-legality invariant (every block coherent)', () => {
  it('no block claims fewer minutes than its topics, ≤ 3 new topics (4 if all QUICK), day ≤ budget', () => {
    // The buffer-overflow defect (B1) recorded many spill topics in a day whose
    // blocks summed to the budget with 60-min blocks holding 3 QUICK (75 min).
    // Every block a day actually SHOWS must now be coherent, at 240 weekday with
    // 240 / 360 / 420 Sunday.
    for (const sun of [240, 360, 420]) {
      const { days } = buildPlan(baseOpts({ dailyBudgetMin: 240, weekendBudgetMin: sun }));
      for (const d of days) {
        expect(d.plannedMinutes).toBeLessThanOrEqual(d.budgetMin);
        for (const b of d.blocks) {
          const topics = (b.topics ?? []).filter((t) => t.kind === 'topic');
          if (topics.length === 0) continue;
          const allQuick = topics.every((t) => t.pass === 'quick');
          expect(topics.length).toBeLessThanOrEqual(allQuick ? 4 : 3);
          const topicMinutes = topics.reduce((a, t) => a + t.estMinutes, 0);
          expect(topicMinutes).toBeLessThanOrEqual(b.minutes);
        }
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* LONG WINDOW — Notification 07/2026: Prelims moved to 24 Jan 2027            */
/* -------------------------------------------------------------------------- */

/** Long-window opts: re-planned from today (9 Oct 2026), plan started 30 Sep. */
function longOpts(examDateISO: string, overrides: Partial<BuildPlanOpts> = {}): BuildPlanOpts {
  return baseOpts({
    startISO: '2026-09-30',
    todayISO: '2026-10-09',
    examDateISO,
    dailyBudgetMin: 240,
    weekendBudgetMin: 360,
    ...overrides,
  });
}

describe('calendar is DERIVED from the exam date (no hardcoded Nov-2026 constant)', () => {
  it('every anchor moves with the exam date — tested at 24 Jan 2027 AND 20 Dec 2026', () => {
    for (const exam of ['2027-01-24', '2026-12-20']) {
      const a = computePlanAnchors(exam, '2026-09-30');
      expect(a.shortWindow).toBe(false); // both are > 8 weeks out
      // Exam day empty; light day the day before; FINAL WINDOW = 21 days.
      expect(a.examISO).toBe(exam);
      expect(a.lightISO).toBe(addDaysISO(exam, -1));
      expect(a.finalStartISO).toBe(addDaysISO(exam, -21));
      expect(diffDaysISO(a.finalStartISO, a.examISO)).toBe(21);
      // Coverage ends a revision cycle (28 d) before the final window.
      expect(a.finalStartISO > a.coverageEndISO).toBe(true);
      expect(diffDaysISO(a.coverageEndISO, a.finalStartISO)).toBe(28);
      expect(a.revisionStartISO).toBe(addDaysISO(a.coverageEndISO, 1));
    }
    // The two dates genuinely differ (not a baked-in calendar).
    const jan = computePlanAnchors('2027-01-24', '2026-09-30');
    const dec = computePlanAnchors('2026-12-20', '2026-09-30');
    expect(jan.finalStartISO).not.toBe(dec.finalStartISO);
  });

  it('a tight exam (< 8 weeks) keeps the OLD compressed behaviour (no revision cycle)', () => {
    const a = computePlanAnchors('2026-11-15', '2026-09-30');
    expect(a.shortWindow).toBe(true);
    expect(a.revisionStartISO).toBeNull();
    expect(a.coverageEndISO).toBe('2026-11-04'); // the old constant
    expect(a.finalStartISO).toBe('2026-11-05');
    expect(a.lightISO).toBe('2026-11-14');
  });
});

describe('long window — phases, final window, revision cycle (exam 24 Jan 2027)', () => {
  const EXAM = '2027-01-24';
  const A = computePlanAnchors(EXAM, '2026-09-30');

  it('exam day empty, light day before it, no new topics in the final window', () => {
    const { days } = buildPlan(longOpts(EXAM));
    const exam = days.find((d) => d.dateISO === A.examISO)!;
    expect(exam.plannedMinutes).toBe(0);
    expect(exam.blocks).toEqual([]);
    const light = days.find((d) => d.dateISO === A.lightISO)!;
    expect(light.light).toBe(true);
    expect(light.plannedMinutes).toBeLessThanOrEqual(90);
    // Final window = the 21 days exam−21 … exam−2; NO first-pass topics there.
    const finalDays = days.filter((d) => d.dateISO >= A.finalStartISO && d.dateISO < A.lightISO);
    expect(finalDays.length).toBeGreaterThan(0);
    for (const d of finalDays) {
      expect([...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]).toEqual([]);
    }
  });

  it('runs a revision cycle between coverage and the final window', () => {
    const { days, summary } = buildPlan(longOpts(EXAM));
    expect(summary.revisionDays).toBeGreaterThan(0);
    const revDays = days.filter(
      (d) => d.dateISO >= A.revisionStartISO! && d.dateISO < A.finalStartISO,
    );
    expect(revDays.length).toBe(summary.revisionDays);
    for (const d of revDays) {
      expect(d.segment).toBe('revision');
      // Revision = no NEW first-pass topics (coverage already finished).
      expect([...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]).toEqual([]);
    }
  });

  it('finishes the first pass BEFORE the revision cycle starts', () => {
    const { days, summary } = buildPlan(longOpts(EXAM));
    const firstPassDates = days
      .filter((d) => [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds].length > 0)
      .map((d) => d.dateISO);
    for (const dateISO of firstPassDates) expect(dateISO <= summary.coverageEndISO).toBe(true);
    expect(summary.coverageEndISO).toBe(A.coverageEndISO);
  });

  it('first-passes every Prelims topic exactly once', () => {
    const { days, summary } = buildPlan(longOpts(EXAM));
    const scheduled = days.flatMap((d) => [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]);
    expect(scheduled.length).toBe(summary.prelimsTotal);
    expect(new Set(scheduled).size).toBe(summary.prelimsTotal);
  });

  it('reaches FULL depth for all non-exempt topics at 240/360 and is feasible', () => {
    const { summary } = buildPlan(longOpts(EXAM));
    expect(summary.feasible).toBe(true);
    expect(summary.infeasibleFloorTopicIds).toEqual([]);
  });

  it('first pass = WEEK TESTS on Saturdays + ONE dress rehearsal; revision + final are FULL mocks (Paper-II first in the cycle)', () => {
    const { days, summary } = buildPlan(longOpts(EXAM));

    // Coverage Saturdays are WEEK TESTS: they teach nothing, are not 'mock'
    // phase, and carry the week-test → review → catch-up block trio.
    const weekTestDays = days.filter((d) => d.blocks.some((b) => b.kind === 'week-test'));
    expect(weekTestDays.length).toBeGreaterThan(0);
    for (const d of weekTestDays) {
      expect(dayOfWeekISO(d.dateISO)).toBe(6);
      expect(d.dateISO < A.revisionStartISO!).toBe(true); // coverage region
      expect(d.phase).toBe('learn');
      expect([...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]).toEqual([]);
      expect(d.blocks.map((b) => b.kind)).toEqual(['week-test', 'week-test-review', 'catchup']);
      // The pool only ever contains topics first-passed on/before this Saturday.
      const wt = d.blocks.find((b) => b.kind === 'week-test')!;
      expect((wt.weekTestSubtopicIds ?? []).length).toBeGreaterThan(0);
    }
    expect(summary.weekTests).toBe(weekTestDays.length);

    // Exactly ONE dress rehearsal in the first pass (a full mock on a coverage Saturday).
    const dress = days.filter((d) =>
      d.blocks.some((b) => b.kind === 'mock' && b.label.includes('Dress rehearsal')),
    );
    expect(dress.length).toBe(1);
    expect(dress[0]!.dateISO < A.revisionStartISO!).toBe(true);
    expect(dayOfWeekISO(dress[0]!.dateISO)).toBe(6);
    expect(summary.dressRehearsalISO).toBe(dress[0]!.dateISO);
    expect(dress[0]!.phase).toBe('mock');

    // Full-mock days (phase 'mock') = dress + revision + final; all pre-final are Saturdays.
    const mockDays = days.filter((d) => d.phase === 'mock');
    for (const d of mockDays.filter((x) => x.dateISO < A.finalStartISO)) {
      expect(dayOfWeekISO(d.dateISO)).toBe(6);
    }

    // Revision-cycle full mocks alternate Paper-II first.
    const schedule = buildMockSchedule('2026-09-30', A, undefined, dress[0]!.mockPaper!);
    const revSat = [...schedule.entries()]
      .filter(([d, m]) => m.kind === 'full' && d >= A.revisionStartISO! && d < A.finalStartISO)
      .map(([d]) => d)
      .sort();
    expect(revSat.length).toBeGreaterThan(0);
    expect(schedule.get(revSat[0]!)!.paper).toBe('paper2');
    for (let i = 1; i < revSat.length; i += 1) {
      expect(schedule.get(revSat[i]!)!.paper).not.toBe(schedule.get(revSat[i - 1]!)!.paper);
    }

    // Final window carries 3 full mocks per 7-day week.
    const finalMocks = mockDays.filter((d) => d.dateISO >= A.finalStartISO && d.dateISO < A.lightISO);
    expect(finalMocks.length).toBeGreaterThanOrEqual(3);
    const weeks = Math.max(1, Math.round(diffDaysISO(A.finalStartISO, A.lightISO) / 7));
    expect(finalMocks.length).toBeGreaterThanOrEqual(3 * weeks - 1);
  });

  it('is progress-aware: a studied topic keeps its completion and is still first-passed once', () => {
    const opts = longOpts(EXAM);
    const firstTheory = opts.subtopics.find((s) => s.track === 'paper1')!.id;
    const firstApt = opts.subtopics.find((s) => s.track === 'paper2')!.id;
    const progress = {
      [firstTheory]: { seen: 4, masteryPct: 100 },
      [firstApt]: { seen: 2, masteryPct: 90 },
    };
    const { days, summary } = buildPlan(longOpts(EXAM, { progress }));
    expect(summary.prelimsStudied).toBe(2);
    expect(summary.prelimsMastered).toBe(2);
    const scheduled = days.flatMap((d) => [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]);
    expect(scheduled).toContain(firstTheory);
    expect(scheduled).toContain(firstApt);
    expect(new Set(scheduled).size).toBe(summary.prelimsTotal);
  });
});
