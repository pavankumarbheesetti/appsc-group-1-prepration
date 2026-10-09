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
  WRAPUP_MIN_IDLE_MIN,
  WRAPUP_MAX_MIN,
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

  // WEEKLY SUBJECT UNITS — contiguous runs of each subject's sequence, authored
  // in an interleaved teaching order that (a) starts with a History unit (day-1
  // orientation), (b) keeps each subject's units in sequence order, and (c)
  // keeps the three History units chronological relative to one another.
  const h = order_['HIST']!;
  const units = [
    { id: 'u-hist-1', subjectCode: 'HIST', title: 'History I', why: 'ancient opening', topicIds: h.slice(0, 10) },
    { id: 'u-pol', subjectCode: 'POL', title: 'Polity', why: 'constitution', topicIds: order_['POL']! },
    { id: 'u-econ', subjectCode: 'ECON', title: 'Economy', why: 'concepts', topicIds: order_['ECON']! },
    { id: 'u-hist-2', subjectCode: 'HIST', title: 'History II', why: 'medieval', topicIds: h.slice(10, 20) },
    { id: 'u-geo', subjectCode: 'GEO', title: 'Geography', why: 'physical', topicIds: order_['GEO']! },
    { id: 'u-sci', subjectCode: 'SCI', title: 'Science & Tech', why: 'applied', topicIds: order_['SCI']! },
    { id: 'u-hist-3', subjectCode: 'HIST', title: 'History III', why: 'modern', topicIds: h.slice(20, 30) },
  ];

  return { subtopics, sequence: { order: order_, mentStreams, units } as PlanSequence };
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

describe('rhythm — WEEKLY SUBJECT UNITS (one unit at a time in the main block)', () => {
  it('teaches ONE unit per main block, in unit order, starting with the first (History) unit', () => {
    const opts = baseOpts();
    const { days } = buildPlan(opts);
    const subj = subjectOf(opts);
    const unitOfTopic = new Map<string, string>();
    for (const u of opts.sequence!.units!) for (const id of u.topicIds) unitOfTopic.set(id, u.id);
    // Day 1 (Sat 30 Sep is a weekday start → not orientation here) and every
    // coverage main block: all its first-pass subject topics belong to ONE unit.
    const unitSeen: string[] = [];
    for (const d of days) {
      const main = subjectBlockOf(d);
      const topicIds = (main?.topics ?? []).filter((t) => t.kind === 'topic').map((t) => t.subtopicId);
      const units = new Set(topicIds.map((id) => unitOfTopic.get(id)).filter(Boolean));
      expect(units.size).toBeLessThanOrEqual(1); // ONE unit per main block
      if (d.unitId && !unitSeen.includes(d.unitId)) unitSeen.push(d.unitId);
    }
    // Units are taught in the authored order, History first.
    const authored = opts.sequence!.units!.map((u) => u.id).filter((id) => unitSeen.includes(id));
    expect(unitSeen).toEqual(authored);
    expect(subj.get(opts.sequence!.units![0]!.topicIds[0]!)).toBe('HIST');
  });

  it('exposes the current unit on each coverage day (unitDay / unitDays / nextUnitTitle)', () => {
    const { days, summary } = buildPlan(baseOpts());
    // Every unit the plan reports has a contiguous date window and topic count.
    expect(summary.units.length).toBeGreaterThan(0);
    for (const u of summary.units) {
      expect(u.topicCount).toBeGreaterThan(0);
      if (u.startISO) expect(u.startISO <= u.endISO).toBe(true);
    }
    // A coverage day with a unit reports a 1-based day index within its run.
    const withUnit = days.filter((d) => d.unitId !== null && d.segment === 'coverage');
    expect(withUnit.length).toBeGreaterThan(0);
    for (const d of withUnit) {
      expect(d.unitDay).toBeGreaterThanOrEqual(1);
      expect(d.unitDay).toBeLessThanOrEqual(d.unitDays);
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
          // ≤ 3 new first-pass topics (4 if all QUICK) applies to the TEACHING
          // blocks ('subject'/'ment'); 'targeted-revision'/'revise' carry a
          // marks-based REVISIT set (more topics, lighter) and are bound only by
          // the Σ-minutes legality below.
          if (b.kind === 'subject' || b.kind === 'ment') {
            const allQuick = topics.every((t) => t.pass === 'quick');
            expect(topics.length).toBeLessThanOrEqual(allQuick ? 4 : 3);
          }
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

  it('first pass = WEEK TESTS + TWO dress rehearsals (P2 then P1); weekly full mocks from the last coverage Saturday (P2 first); final 3/week', () => {
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
      const wt = d.blocks.find((b) => b.kind === 'week-test')!;
      expect((wt.weekTestSubtopicIds ?? []).length).toBeGreaterThan(0);
    }
    expect(summary.weekTests).toBe(weekTestDays.length);

    // EXACTLY TWO dress rehearsals in the first pass (full mocks on coverage
    // Saturdays), the FIRST Paper-II and the SECOND Paper-I (STANDARDS §8a item 4).
    const schedule = buildMockSchedule('2026-09-30', A);
    const dressDates = [...schedule.entries()]
      .filter(([, m]) => m.kind === 'dress-rehearsal')
      .map(([d]) => d)
      .sort();
    expect(dressDates.length).toBe(2);
    for (const d of dressDates) {
      expect(dayOfWeekISO(d)).toBe(6);
      expect(d < A.revisionStartISO!).toBe(true);
    }
    expect(schedule.get(dressDates[0]!)!.paper).toBe('paper2');
    expect(schedule.get(dressDates[1]!)!.paper).toBe('paper1');
    expect(summary.dressRehearsalISO).toBe(dressDates[0]!);

    // Full-mock days (phase 'mock') pre-final are all Saturdays.
    const mockDays = days.filter((d) => d.phase === 'mock');
    for (const d of mockDays.filter((x) => x.dateISO < A.finalStartISO)) {
      expect(dayOfWeekISO(d.dateISO)).toBe(6);
    }

    // Weekly full mocks run every Saturday from the LAST coverage Saturday
    // through the revision cycle, alternating Paper-II first.
    const weeklySat = [...schedule.entries()]
      .filter(([d, m]) => m.kind === 'full' && d < A.finalStartISO)
      .map(([d]) => d)
      .sort();
    expect(weeklySat.length).toBeGreaterThan(0);
    expect(dayOfWeekISO(weeklySat[0]!)).toBe(6);
    expect(schedule.get(weeklySat[0]!)!.paper).toBe('paper2'); // Paper-II first
    for (let i = 1; i < weeklySat.length; i += 1) {
      expect(schedule.get(weeklySat[i]!)!.paper).not.toBe(schedule.get(weeklySat[i - 1]!)!.paper);
    }

    // Final window carries 3 full mocks per 7-day week.
    const finalMocks = mockDays.filter((d) => d.dateISO >= A.finalStartISO && d.dateISO < A.lightISO);
    expect(finalMocks.length).toBeGreaterThanOrEqual(3);
    const weeks = Math.max(1, Math.round(diffDaysISO(A.finalStartISO, A.lightISO) / 7));
    expect(finalMocks.length).toBeGreaterThanOrEqual(3 * weeks - 1);

    // Full-mock sittings stay within the non-repeating per-paper capacity.
    expect(summary.fullMockPaperCounts.paper1).toBeLessThanOrEqual(9);
    expect(summary.fullMockPaperCounts.paper2).toBeLessThanOrEqual(8);
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

/* -------------------------------------------------------------------------- */
/* UNIT WRAP-UP — fill the idle time on unit-end days (STANDARDS §8a)          */
/* -------------------------------------------------------------------------- */

describe('rhythm — UNIT WRAP-UP (consolidate a unit right after finishing it)', () => {
  const EXAM = '2027-01-24';

  it('leaves no first-pass main subject block ≥30 min idle (minutes == its topics)', () => {
    const { days } = buildPlan(longOpts(EXAM));
    let saw = 0;
    for (const d of days.filter((x) => x.segment === 'coverage')) {
      for (const b of d.blocks) {
        if (b.kind !== 'subject') continue;
        saw += 1;
        const tmin = (b.topics ?? []).filter((t) => t.kind === 'topic').reduce((a, t) => a + t.estMinutes, 0);
        // The teaching block carries NO ≥30-min idle — the leftover becomes a
        // wrap-up / next-unit block / 'Catch up or rest' instead.
        expect(b.minutes - tmin).toBeLessThan(WRAPUP_MIN_IDLE_MIN);
      }
    }
    expect(saw).toBeGreaterThan(0);
    // Every ≥30-min filler on a first-pass STUDY day (not the week-test Saturday,
    // which has its own catch-up) is explicitly a 'Catch up or rest' block.
    for (const d of days.filter((x) => x.segment === 'coverage')) {
      if (d.blocks.some((b) => b.kind === 'week-test')) continue;
      for (const b of d.blocks) {
        if (b.kind === 'catchup' && b.minutes >= WRAPUP_MIN_IDLE_MIN) expect(b.label).toBe('Catch up or rest');
      }
    }
  });

  it('gives EVERY first-pass unit exactly one wrap-up, each 30–90 min', () => {
    const { days, summary } = buildPlan(longOpts(EXAM));
    const wrapByUnit = new Map<string, number>();
    for (const d of days.filter((x) => x.segment === 'coverage')) {
      for (const b of d.blocks) {
        if (b.kind !== 'unit-wrapup') continue;
        expect(b.unitId).toBeTruthy();
        expect(b.minutes).toBeGreaterThanOrEqual(WRAPUP_MIN_IDLE_MIN);
        expect(b.minutes).toBeLessThanOrEqual(WRAPUP_MAX_MIN);
        wrapByUnit.set(b.unitId!, (wrapByUnit.get(b.unitId!) ?? 0) + 1);
      }
    }
    expect(summary.units.length).toBeGreaterThan(0);
    for (const u of summary.units) expect(wrapByUnit.get(u.id)).toBe(1); // exactly one each
    expect(wrapByUnit.size).toBe(summary.units.length);
  });

  it('scopes each unit test to ONLY its own topics, timed 1 Q/min (glance + review removed)', () => {
    const opts = longOpts(EXAM);
    const { days } = buildPlan(opts);
    const unitTopics = new Map(opts.sequence!.units!.map((u) => [u.id, new Set(u.topicIds)]));
    let seen = 0;
    for (const d of days.filter((x) => x.segment === 'coverage')) {
      for (const b of d.blocks) {
        if (b.kind !== 'unit-wrapup') continue;
        seen += 1;
        const pool = unitTopics.get(b.unitId!)!;
        expect((b.unitTestSubtopicIds ?? []).length).toBeGreaterThan(0);
        for (const id of b.unitTestSubtopicIds ?? []) expect(pool.has(id)).toBe(true);
        // Count = round(size − 15 glance − 15 review); timer = 1 min/question.
        expect(b.unitTestCount).toBe(Math.max(0, Math.round(b.minutes - 30)));
        expect(b.unitTestMinutes).toBe(b.unitTestCount);
        expect(b.unitTestDateISO).toBe(d.dateISO);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('starts the NEXT unit in the same block only after a wrap-up, as a separate one-unit block', () => {
    const opts = longOpts(EXAM);
    const { days } = buildPlan(opts);
    const unitOf = new Map<string, string>();
    for (const u of opts.sequence!.units!) for (const id of u.topicIds) unitOf.set(id, u.id);
    const unitOfBlock = (b: PlanDay['blocks'][number]): string | undefined => {
      const t = (b.topics ?? []).find((x) => x.kind === 'topic');
      return t ? unitOf.get(t.subtopicId) : undefined;
    };
    let sawTwoUnits = false;
    for (const d of days.filter((x) => x.segment === 'coverage')) {
      const subjectBlocks = d.blocks.filter((b) => b.kind === 'subject');
      // Each 'subject' block teaches exactly ONE unit.
      for (const b of subjectBlocks) {
        const us = new Set((b.topics ?? []).filter((t) => t.kind === 'topic').map((t) => unitOf.get(t.subtopicId)));
        expect(us.size).toBe(1);
      }
      if (subjectBlocks.length >= 2) {
        sawTwoUnits = true;
        const kinds = d.blocks.map((b) => b.kind);
        const first = kinds.indexOf('subject');
        const second = kinds.indexOf('subject', first + 1);
        // A wrap-up separates the finished unit from the newly started one.
        expect(kinds.slice(first, second)).toContain('unit-wrapup');
        expect(unitOfBlock(subjectBlocks[0]!)).not.toBe(unitOfBlock(subjectBlocks[1]!));
      }
    }
    // The fixture's long window has Sundays with room to start the next unit.
    expect(sawTwoUnits).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe('rhythm — a test block is FIXED, never scaled by the day budget', () => {
  // The real plan scenario from the mock-day bug report: start Sat 10 Oct 2026,
  // exam Sun 24 Jan 2027, weekday 240 / Sunday 360, the default festival days
  // off (incl. the 13–15 Jan Sankranti window). The 14 Jan final-window mock is
  // displaced off the holiday; it must NOT land back-to-back with the Sat 16 Jan
  // full mock (N3), and a full paper block is ALWAYS 120 min regardless of the
  // day budget.
  const EXAM = '2027-01-24';
  const DAYS_OFF = ['2026-11-08', '2027-01-13', '2027-01-14', '2027-01-15'];
  const scenario = (budget: number): BuildPlanOpts =>
    longOpts(EXAM, {
      startISO: '2026-10-10',
      todayISO: '2026-10-10',
      dailyBudgetMin: budget === 180 ? 180 : 240,
      weekendBudgetMin: budget,
      daysOff: DAYS_OFF,
    });

  it('fixes EVERY full-mock / dress-rehearsal block at 120 min and the review at 60, for budgets 180/240/360', () => {
    for (const budget of [180, 240, 360]) {
      const { days } = buildPlan(scenario(budget));
      const mockDays = days.filter((d) => d.phase === 'mock');
      expect(mockDays.length).toBeGreaterThan(0);
      for (const d of mockDays) {
        const mock = d.blocks.find((b) => b.kind === 'mock')!;
        const review = d.blocks.find((b) => b.kind === 'mock-review')!;
        expect(mock.minutes).toBe(120); // a full Prelims paper is ALWAYS 120 min
        expect(review.minutes).toBe(60); // review is fixed, never scaled
        // Extra budget flows to the weakest-area drill, never into the mock.
        const weakest = d.blocks.find((b) => b.kind === 'weakest-area');
        if (weakest) expect(mock.minutes + review.minutes + weakest.minutes).toBeLessThanOrEqual(d.budgetMin);
      }
    }
  });

  it('fixes EVERY week-test block at 55 min, for budgets 180/240/360', () => {
    for (const budget of [180, 240, 360]) {
      const { days } = buildPlan(scenario(budget));
      const weekTestBlocks = days
        .flatMap((d) => d.blocks)
        .filter((b) => b.kind === 'week-test');
      expect(weekTestBlocks.length).toBeGreaterThan(0);
      for (const b of weekTestBlocks) expect(b.minutes).toBe(55); // WEEK_TEST_MINUTES, never scaled
    }
  });

  it('never schedules two full mocks on consecutive days (festival-displaced mock, N3)', () => {
    const { days, summary } = buildPlan(scenario(360));
    const fulls = summary.mockList
      .filter((m) => m.kind !== 'week-test')
      .map((m) => m.dateISO)
      .sort();
    expect(fulls.length).toBeGreaterThan(0);
    // No two full mocks (full or dress-rehearsal) ever fall on consecutive days.
    for (let i = 1; i < fulls.length; i += 1) {
      const gapDays = (Date.parse(fulls[i]!) - Date.parse(fulls[i - 1]!)) / 86_400_000;
      expect(gapDays).toBeGreaterThanOrEqual(2);
    }
    // The Sat 16 Jan full mock survives; the Thu 14 Jan mock (displaced by the
    // 13–15 Jan Sankranti break) is NOT doubled onto Sun 17 Jan next to it.
    expect(fulls).toContain('2027-01-16');
    expect(fulls).not.toContain('2027-01-17');
    // A full-mock block is ALWAYS 120 min, even on a larger-budget Sunday.
    for (const d of days.filter((x) => x.phase === 'mock')) {
      expect(d.blocks.find((b) => b.kind === 'mock')!.minutes).toBe(120);
    }
  });
});

/**
 * RE-AUDIT 1 — N1 sequence-order invariant over the FIXTURE in a LONG window.
 * The beginner-ramp + days-off capacity deficit must be absorbed by SHIFTING
 * the remaining first passes forward in learning-sequence order (never by
 * pulling a subject's tail/mid topics out of order), so per subject the
 * first-pass dates are non-decreasing in sequence order — at budgets
 * 180 / 240 / 360, with and without days off.
 */
describe('re-audit 1 — N1 first-pass order non-decreasing (fixture, long window)', () => {
  const OFF = ['2026-11-08', '2027-01-13', '2027-01-14', '2027-01-15'];
  it('never first-passes a topic before an earlier sequence topic of its subject', () => {
    for (const budget of [180, 240, 360]) {
      for (const daysOff of [undefined, OFF]) {
        const opts = longOpts('2027-01-24', {
          dailyBudgetMin: budget,
          weekendBudgetMin: budget,
          daysOff: daysOff ? [...daysOff] : undefined,
        });
        const { days } = buildPlan(opts);
        const subj = subjectOf(opts);
        const seq = opts.sequence!.order;
        const fp = new Map<string, string>();
        for (const d of days) {
          for (const id of [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]) {
            if (!fp.has(id)) fp.set(id, d.dateISO);
          }
        }
        const bySubject = new Map<string, string[]>();
        for (const id of fp.keys()) {
          const code = subj.get(id)!;
          const arr = bySubject.get(code) ?? [];
          arr.push(id);
          bySubject.set(code, arr);
        }
        for (const [code, ids] of bySubject) {
          const order = seq[code] ?? [];
          const idx = new Map(order.map((id, i) => [id, i] as const));
          ids.sort((a, b) => (idx.get(a) ?? 0) - (idx.get(b) ?? 0));
          let prev = '';
          for (const id of ids) {
            const date = fp.get(id)!;
            expect(date >= prev, `${code} budget=${budget} off=${!!daysOff}: ${id} @${date} < ${prev}`).toBe(true);
            prev = date;
          }
        }
      }
    }
  });
});
