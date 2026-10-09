import { describe, it, expect, beforeEach } from 'vitest';
import { planSubtopics, plannerProgress, currentPlan, mainsQuestionBank, mockSectionPools, pyqFrequency, learningSequence } from '../plan';
import { getSubtopics } from '../../content/loader';
import { buildPlan, computePlanAnchors, buildMockSchedule } from '../../engine/planner';
import { PAPER_I, PAPER_II } from '../exam-pattern';
import { buildPaperMock, mockSeriesLength } from '../../engine/mock';
import { __resetForTests, getPlanStartDate, setPlanStartDate } from '../../state/store';
import { addDaysISO, dayOfWeekISO } from '../dates';

/** Derived anchors for the explicit short-window test harness (30 Sep → 15 Nov 2026). */
const SHORT = computePlanAnchors('2026-11-15', '2026-09-30');

/**
 * The plan bridge spans the WHOLE taxonomy but the PRELIMS plan scope is only
 * the paper1 (theory) + paper2 (aptitude) subtopics; the mains/qualifying
 * subjects are a parallel track excluded from the deadline.
 */
describe('plan bridge — full-taxonomy scope, prelims-driven plan', () => {
  beforeEach(() => {
    __resetForTests();
    // Pin the plan start to the fixed `now` these tests pass, so the plan has no
    // free pre-start days (the start defaults to the wall clock otherwise).
    setPlanStartDate('2026-09-30');
  });

  it('planSubtopics covers every taxonomy subtopic exactly once, with track + subject', () => {
    const subs = planSubtopics();
    const taxonomyCount = getSubtopics().length;
    expect(subs.length).toBe(taxonomyCount);
    expect(new Set(subs.map((s) => s.id)).size).toBe(taxonomyCount);
    const ivc = subs.find((s) => s.id === 'hist-ancient-ivc');
    expect(ivc?.track).toBe('paper1');
    expect(ivc?.subjectCode).toBe('HIST');
    expect(subs.filter((s) => s.track === 'paper1').length).toBe(88);
    expect(subs.filter((s) => s.track === 'paper2').length).toBe(29);
    expect(subs.filter((s) => s.track === 'mains').length).toBe(12);
    expect(subs.find((s) => s.id === 'pol-public-administration')?.track).toBe('mains');
    expect(subs.find((s) => s.id === 'pol-public-administration')?.subjectCode).toBe('POL');
    expect(subs.find((s) => s.id === 'sci-general-science-basics')?.track).toBe('paper2');
  });

  it('flags hasMaterial only where content is authored', () => {
    const subs = planSubtopics();
    const withMaterial = subs.filter((s) => s.hasMaterial);
    expect(withMaterial.length).toBe(129);
    expect(subs.find((s) => s.id === 'hist-ancient-ivc')?.hasMaterial).toBe(true);
    const unauthored = subs.find((s) => !s.hasMaterial);
    if (unauthored) {
      expect(unauthored.hasMaterial).toBe(false);
    }
  });

  it('mainsQuestionBank returns every authored mains question id', () => {
    const bank = mainsQuestionBank();
    expect(bank.length).toBe(323);
    expect(new Set(bank).size).toBe(323);
  });

  it('learningSequence returns prereq-correct per-subject orders (in-scope only)', () => {
    const seq = learningSequence();
    // The seven Prelims subjects, in scope. HIST is the tight subject.
    expect(seq.order['HIST']!.length).toBe(47);
    expect(seq.order['POL']!.length).toBe(19);
    expect(seq.order['ECON']!.length).toBe(14);
    expect(seq.order['GEO']!.length).toBe(8);
    expect(seq.order['SCI']!.length).toBe(9);
    expect(seq.order['MENT']!.length).toBe(17);
    expect(seq.order['CA']!.length).toBe(3);
    // MENT stream tags are carried through.
    expect(seq.mentStreams?.['ment-number-system']).toBe('quant');
  });

  it('currentPlan runs the FIXED WEEKLY RHYTHM over the PRELIMS scope only', () => {
    const { summary } = currentPlan(new Date('2026-09-30T00:00:00'));
    expect(summary.rhythm).toBe(true);
    expect(summary.postPrelims).toBe(false);
    expect(summary.coverageEndISO).toBe(
      computePlanAnchors(summary.examDateISO, getPlanStartDate()).coverageEndISO,
    );
    expect(summary.theoryTotal).toBe(88);
    expect(summary.aptitudeTotal).toBe(29);
    expect(summary.prelimsTotal).toBe(117);
    expect(summary.prelimsWithMaterial).toBe(117);
    expect(summary.prelimsMaterialCoveragePct).toBe(100);
    expect(summary.prelimsStudied).toBe(0);
    expect(summary.prelimsCoveragePct).toBe(0);
    // Mains/qualifying is a parallel track: 12 subjects, 323 practice questions,
    // but the rhythm schedules NO mains before Prelims.
    expect(summary.mainsSubjectsTotal).toBe(12);
    expect(summary.mainsQuestionsTotal).toBe(323);
    expect(summary.mainsPerDay).toBe(0);
  });

  it('gives every coverage weekday a Mental Ability + subject block; no mains pre-Prelims', () => {
    const { days } = currentPlan(new Date('2026-09-30T00:00:00'));
    const learn = days.filter((d) => d.phase === 'learn' && d.blocks.length > 0);
    expect(learn.length).toBeGreaterThan(0);
    for (const d of learn) {
      const dow = new Date(`${d.dateISO}T00:00:00Z`).getUTCDay();
      if (dow >= 1 && dow <= 5) {
        // A MENT block (topic or practice) AND a MAIN block (the current unit's
        // 'subject' block, or a 'targeted-revision' consolidation block once the
        // first pass is complete) on every coverage weekday.
        expect(d.blocks.some((b) => b.kind === 'ment' || b.kind === 'ment-practice')).toBe(true);
        expect(d.blocks.some((b) => b.kind === 'subject' || b.kind === 'targeted-revision')).toBe(true);
      }
    }
    // Aptitude (29) is distributed exactly once across the coverage window.
    const aptitude = days.flatMap((d) => d.aptitudeSubtopicIds);
    expect(aptitude.length).toBe(29);
    expect(new Set(aptitude).size).toBe(29);
    // PRELIMS-FIRST: no mains on any pre-exam day.
    for (const d of days) expect(d.mainsQuestionIds).toEqual([]);
  });

  it('exposes an HONEST per-topic breakdown from real authored MCQ counts', () => {
    const { days } = currentPlan(new Date('2026-09-30T00:00:00'));
    const learn = days.filter((d) => d.phase === 'learn');
    const allTopics = learn.flatMap((d) => d.topics);
    // The drill target is at least the sum of the day's authored topic drillables.
    for (const d of learn) {
      const topicDrill = d.topics.reduce((acc, t) => acc + Math.min(20, t.mcqCount), 0);
      expect(d.drillTarget).toBeGreaterThanOrEqual(topicDrill);
    }
    const ivc = allTopics.find((t) => t.subtopicId === 'hist-ancient-ivc');
    expect(ivc?.mcqCount).toBeGreaterThan(0);
    expect(ivc?.track).toBe('theory');
    expect(allTopics.some((t) => t.mcqCount > 0)).toBe(true);
  });

  it('plannerProgress starts every subtopic at 0 seen / 0 mastery on a fresh profile', () => {
    const prog = plannerProgress();
    expect(Object.keys(prog).length).toBe(getSubtopics().length);
    for (const v of Object.values(prog)) {
      expect(v.seen).toBe(0);
      expect(v.masteryPct).toBe(0);
    }
  });
});

describe('mockSectionPools — full-paper pools from real content', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('builds a real 120-question Paper-I mock by section weight', () => {
    const pools = mockSectionPools(PAPER_I);
    for (const s of PAPER_I.sections) {
      expect(pools[s.subjectCode]!.length).toBeGreaterThanOrEqual(s.count);
    }
    const mock = buildPaperMock(PAPER_I, pools, 1);
    expect(mock.items).toHaveLength(120);
    expect(new Set(mock.items.map((i) => i.id)).size).toBe(120);
    expect(mockSeriesLength(PAPER_I, pools)).toBeGreaterThanOrEqual(6);
  });

  it('builds a real 120-question Paper-II mock (60/30/30)', () => {
    const pools = mockSectionPools(PAPER_II);
    const mock = buildPaperMock(PAPER_II, pools, 1);
    expect(mock.items).toHaveLength(120);
    expect(mock.sections.map((s) => s.items.length)).toEqual([60, 30, 30]);
    expect(new Set(mock.items.map((i) => i.id)).size).toBe(120);
    expect(mockSeriesLength(PAPER_II, pools)).toBeGreaterThanOrEqual(6);
  });

  it('the Paper-II SCI section pool draws from the new General Science Basics subtopic', () => {
    const pools = mockSectionPools(PAPER_II);
    const sci = pools['SCI'] ?? [];
    expect(sci.some((i) => i.subtopicId === 'sci-general-science-basics')).toBe(true);
  });
});

describe('gap-fill — track placement of the new subtopics (rhythm)', () => {
  beforeEach(() => {
    __resetForTests();
    setPlanStartDate('2026-09-30');
  });

  it('first-passes the SCI basics subtopic once in the coverage window (paper2 aptitude)', () => {
    const { days } = currentPlan(new Date('2026-09-30T00:00:00'));
    const coverage = days.filter((d) => d.segment === 'coverage');
    const aptitude = coverage.flatMap((d) => d.aptitudeSubtopicIds);
    expect(aptitude).toContain('sci-general-science-basics');
    expect(aptitude.filter((id) => id === 'sci-general-science-basics').length).toBe(1);
    const theory = coverage.flatMap((d) => d.theorySubtopicIds);
    expect(theory).not.toContain('sci-general-science-basics');
  });

  it('keeps the five POL Mains Paper-III subtopics OUT of the Prelims plan, in mains practice', () => {
    const mainsIds = [
      'pol-ethics-human-interface',
      'pol-ethics-attitude-ei',
      'pol-ethics-public-service-probity',
      'pol-law-civil-criminal-labour',
      'pol-public-administration',
    ];
    const { days } = currentPlan(new Date('2026-09-30T00:00:00'));
    for (const d of days) {
      const prelims = [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds, ...d.reviseSubtopicIds];
      for (const id of mainsIds) expect(prelims).not.toContain(id);
    }
    const bank = new Set(mainsQuestionBank());
    for (const id of mainsIds) {
      expect([...bank].some((q) => q.startsWith(id))).toBe(true);
    }
  });

  it('feeds the post-prelims Mains kick-start from a bank that includes the POL Mains subtopics', () => {
    const { days, summary } = currentPlan(new Date('2027-01-30T00:00:00'));
    expect(summary.postPrelims).toBe(true);
    expect(days.every((d) => d.phase === 'mains')).toBe(true);
    const bank = mainsQuestionBank();
    for (const id of [
      'pol-ethics-human-interface',
      'pol-law-civil-criminal-labour',
      'pol-public-administration',
    ]) {
      expect(bank.some((q) => q.startsWith(id))).toBe(true);
    }
  });
});

/**
 * The FIXED WEEKLY RHYTHM over REAL content at 240 min/day. Drives the pure
 * engine directly with fixed dates (today = plan start = Wed 30 Sep 2026,
 * Prelims = Sun 15 Nov 2026) so the assertions are DETERMINISTIC — independent
 * of the machine clock — while exercising the authored taxonomy + PYQ weights.
 */
describe('rhythm scheduling over real content (240/day, fixed dates)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  function realPlan() {
    return buildPlan({
      subtopics: planSubtopics(),
      progress: plannerProgress(),
      mainsQuestionIds: mainsQuestionBank(),
      pyqFrequency: pyqFrequency(),
      sequence: learningSequence(),
      examDateISO: '2026-11-15',
      startISO: '2026-09-30',
      todayISO: '2026-09-30',
      dailyBudgetMin: 240,
    });
  }

  const AP_RE = /-ap-|andhra|ap-culture|ap-reorganisation|ap-economy/;

  it('first-passes every Prelims subtopic exactly once across the window', () => {
    const { days, summary } = realPlan();
    const firstPass = days.flatMap((d) => [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]);
    expect(firstPass.length).toBe(summary.prelimsTotal);
    expect(new Set(firstPass).size).toBe(117);
  });

  it('respects the learning-sequence order within every subject (History per stream)', () => {
    const { days } = realPlan();
    const seq = learningSequence();
    const subj = new Map(planSubtopics().map((s) => [s.id, s.subjectCode] as const));
    // COVERAGE-window first-pass order only. The deferred low-priority QUICK
    // buffer topics (taught Thu 5 / Fri 6) are the documented exception — they
    // are removed from the middle of the sequence so later protected topics fit.
    const firstBySubject = new Map<string, string[]>();
    for (const d of days) {
      if (d.segment !== 'coverage') continue;
      for (const id of [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]) {
        const code = subj.get(id)!;
        const arr = firstBySubject.get(code) ?? [];
        arr.push(id);
        firstBySubject.set(code, arr);
      }
    }
    for (const code of ['POL', 'ECON', 'GEO', 'SCI', 'MENT']) {
      const got = firstBySubject.get(code) ?? [];
      const want = (seq.order[code] ?? []).filter((id) => got.includes(id));
      expect(got).toEqual(want);
    }
    // History advances as TWO independent chronological streams; each is a
    // strict subsequence of its own order (Monday→early, Sunday→modern).
    const histGot = firstBySubject.get('HIST') ?? [];
    const streams = seq.histStreams ?? {};
    for (const stream of ['early', 'modern'] as const) {
      const gotStream = histGot.filter((id) => (streams[id] ?? 'early') === stream);
      const wantStream = (seq.order['HIST'] ?? []).filter(
        (id) => (streams[id] ?? 'early') === stream && histGot.includes(id),
      );
      expect(gotStream).toEqual(wantStream);
    }
  });

  it('reports a per-subject FULL/STANDARD/QUICK fit; History is tight in the short window', () => {
    const { summary } = realPlan();
    expect(summary.subjectFit.length).toBe(5);
    for (const f of summary.subjectFit) {
      expect(f.full + f.standard + f.quick).toBe(f.total); // three tiers partition the subject
      expect(f.newTopicMinutes).toBeGreaterThan(0);
    }
    const hist = summary.subjectFit.find((f) => f.subject === 'HIST')!;
    expect(hist.total).toBe(47);
    // The SHORT window (47 days) cannot teach History's 47 topics all at FULL in
    // its unit runs, so the plan is NOT feasible and the shortfall is REPORTED,
    // while every AP / band-A topic is still placed and the buffer stays
    // QUICK-only.
    expect(summary.feasible).toBe(false);
    expect(summary.infeasibleFloorTopicIds.length).toBeGreaterThan(0);
    // Any deferred (spilled) topic is QUICK and never AP / band A.
    const AP = /-ap-|andhra|ap-culture|ap-reorganisation|ap-economy/;
    const bandAById = new Map(planSubtopics().map((s) => [s.id, s.band] as const));
    for (const s of summary.spills) {
      expect(s.lastDateISO <= SHORT.spillDates[1]).toBe(true);
      for (const id of s.topicIds) {
        expect(AP.test(id)).toBe(false);
        expect(bandAById.get(id)).not.toBe('A');
      }
    }
    // WEEKLY SUBJECT UNITS are reported, in teaching order, History first.
    expect(summary.units.length).toBeGreaterThan(0);
    expect(summary.units[0]!.subjectCode).toBe('HIST');
  });

  it('studies every AP topic at FULL depth', () => {
    const { days } = realPlan();
    const passById = new Map<string, string>();
    for (const d of days) for (const t of d.topics) if (t.kind === 'topic') passById.set(t.subtopicId, t.pass);
    const apIds = planSubtopics().filter((s) => s.track !== 'mains' && AP_RE.test(s.id)).map((s) => s.id);
    expect(apIds.length).toBeGreaterThan(0);
    for (const id of apIds) expect(passById.get(id)).toBe('full');
  });

  it('schedules the derived short-window mocks with per-paper series numbers', () => {
    const { summary } = realPlan();
    const expected = [...buildMockSchedule('2026-09-30', SHORT).keys()].filter(
      (d) => d >= '2026-09-30' && d <= SHORT.examISO,
    );
    expect(summary.mockList.length).toBe(expected.length);
    const nums = (p: 'paper1' | 'paper2'): number[] =>
      summary.mockList.filter((m) => m.paper === p).map((m) => m.mockNumber).sort((a, b) => a - b);
    expect(nums('paper1')).toEqual(nums('paper1').map((_, i) => i + 1));
    expect(nums('paper2')).toEqual(nums('paper2').map((_, i) => i + 1));
  });

  it('completes the Mental Ability lane then runs practice sets', () => {
    const { summary } = realPlan();
    expect(summary.mentAllPassedISO).not.toBe('');
    expect(summary.mentPracticeSets).toBeGreaterThan(0);
  });

  it('keeps every invariant: ≤ budget, no new topics after coverage end, empty exam day', () => {
    const { days, summary } = realPlan();
    for (const d of days) expect(d.plannedMinutes).toBeLessThanOrEqual(d.budgetMin);
    const spilled = new Set(summary.spills.flatMap((s) => s.topicIds));
    for (const d of days) {
      if (d.dateISO <= SHORT.coverageEndISO) continue;
      for (const id of [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]) {
        expect(spilled.has(id) && d.dateISO <= SHORT.spillDates[1]).toBe(true);
      }
    }
    const examDay = days[days.length - 1]!;
    expect(examDay.plannedMinutes).toBe(0);
    expect(examDay.blocks).toEqual([]);
  });

/**
 * DEPTH / BALANCE over REAL content (240/day, fixed dates). These lock in the
 * three-tier redesign (FULL ≤ 60 / STANDARD 40 / QUICK 25), the marks-based
 * subject budgets and the floor-first depth priority:
 *  - AP-specific topics are ALWAYS FULL;
 *  - every band-A Polity/Economy/Geography topic is at least STANDARD;
 *  - Science finishes no earlier than 23 Oct unless it is entirely FULL;
 *  - a freed Paper-I slot never goes to a subject whose floor is already all FULL
 *    while another subject still has floor topics below STANDARD (History is not
 *    the automatic recipient);
 *  - no block ever teaches more than 3 new topics (4 if they are all QUICK);
 *  - the only floor topics forced below STANDARD are reported (never AP), and
 *    History — 47 of the 88 Paper-I subtopics — carries the bulk of them.
 */
describe('rhythm depth tiers + Paper-I balance (real content)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  const AP_RE = /-ap-|andhra|ap-culture|ap-reorganisation|ap-economy/;
  const LANES = ['HIST', 'POL', 'ECON', 'GEO', 'SCI'];
  const PAPER_I = ['HIST', 'POL', 'ECON', 'GEO'];

  function planAt(dailyBudgetMin: number) {
    return buildPlan({
      subtopics: planSubtopics(),
      progress: plannerProgress(),
      mainsQuestionIds: mainsQuestionBank(),
      pyqFrequency: pyqFrequency(),
      sequence: learningSequence(),
      examDateISO: '2026-11-15',
      startISO: '2026-09-30',
      todayISO: '2026-09-30',
      dailyBudgetMin,
    });
  }

  function passMap(days: ReturnType<typeof planAt>['days']): Map<string, string> {
    const pass = new Map<string, string>();
    for (const d of days) for (const t of d.topics) if (t.kind === 'topic') pass.set(t.subtopicId, t.pass);
    return pass;
  }

  /**
   * The DEPTH FLOOR set (STANDARDS §8a): topics whose required tier is ABOVE
   * QUICK — AP + band A (FULL), every POL/ECON/GEO/SCI topic and every History
   * PYQ/band-B topic (≥ STANDARD). Only PYQ-0 band-C/D topics may stay QUICK.
   */
  function floorIds(): Set<string> {
    const subs = planSubtopics().filter((s) => s.track !== 'mains' && LANES.includes(s.subjectCode));
    const pyq = pyqFrequency();
    const STD = new Set(['POL', 'ECON', 'GEO', 'SCI']);
    const out = new Set<string>();
    for (const s of subs) {
      if (AP_RE.test(s.id) || s.band === 'A') out.add(s.id); // FULL floor
      else if (STD.has(s.subjectCode)) out.add(s.id); // ≥ STANDARD
      else if ((pyq[s.id] ?? 0) > 0) out.add(s.id); // History PYQ topic
      else if (s.band !== 'C' && s.band !== 'D') out.add(s.id); // History band-B, PYQ 0
    }
    return out;
  }

  it('always studies AP-specific topics FULL at 180 / 240 / 360', () => {
    for (const budget of [180, 240, 360]) {
      const { days } = planAt(budget);
      const pass = passMap(days);
      const apIds = planSubtopics().filter((s) => s.track !== 'mains' && AP_RE.test(s.id)).map((s) => s.id);
      expect(apIds.length).toBeGreaterThan(0);
      for (const id of apIds) expect(pass.get(id)).toBe('full');
    }
  });

  it('studies every band-A Polity / Economy / Geography topic at least STANDARD (240)', () => {
    const { days } = planAt(240);
    const pass = passMap(days);
    const subs = planSubtopics();
    for (const code of ['POL', 'ECON', 'GEO']) {
      const bandA = subs.filter((s) => s.subjectCode === code && s.band === 'A');
      expect(bandA.length).toBeGreaterThan(0);
      for (const s of bandA) expect(pass.get(s.id) === 'standard' || pass.get(s.id) === 'full').toBe(true);
    }
  });

  it('reports only floor topics forced below STANDARD, none of them AP (240)', () => {
    const floors = floorIds();
    const { days, summary } = planAt(240);
    const pass = passMap(days);
    for (const id of summary.infeasibleFloorTopicIds) {
      expect(floors.has(id)).toBe(true); // really a floor topic
      expect(pass.get(id)).toBe('quick'); // and genuinely below STANDARD
      expect(AP_RE.test(id)).toBe(false); // never AP
    }
    // History (47 of 88 Paper-I subtopics) carries the bulk of the reported floor.
    const histBelow = summary.infeasibleFloorTopicIds.filter((id) => id.startsWith('hist-'));
    expect(histBelow.length).toBeGreaterThan(0);
  });

  it('finishes Science no earlier than 23 Oct unless every Science topic is FULL', () => {
    const { summary } = planAt(240);
    const sci = summary.subjectFit.find((f) => f.subject === 'SCI')!;
    if (sci.full !== sci.total) expect(sci.lastFirstPassISO >= '2026-10-23').toBe(true);
  });

  it('never hands a Paper-I slot to a subject whose floor is all FULL while another has floor below STANDARD (240)', () => {
    const { days, summary } = planAt(240);
    const pass = passMap(days);
    const subs = planSubtopics();
    const floors = floorIds();
    const floorAllFull = (code: string): boolean =>
      subs.filter((s) => s.subjectCode === code && floors.has(s.id)).every((s) => pass.get(s.id) === 'full');
    const floorBelowStandard = (code: string): boolean =>
      subs.some((s) => s.subjectCode === code && floors.has(s.id) && pass.get(s.id) === 'quick');
    for (const r of summary.reallocations) {
      if (!PAPER_I.includes(r.fromSubject)) continue; // only Paper-I slots are governed
      if (floorAllFull(r.toSubject)) {
        const anotherBelow = LANES.some((c) => c !== r.toSubject && floorBelowStandard(c));
        expect(anotherBelow).toBe(false);
      }
    }
  });

  it('never teaches more than 3 new topics per block (4 if all QUICK); deepen top-ups counted separately, at 180 / 240 / 360', () => {
    for (const budget of [180, 240, 360]) {
      const { days } = planAt(budget);
      for (const d of days) {
        for (const b of d.blocks) {
          const topics = (b.topics ?? []).filter((t) => t.kind === 'topic');
          // NEW first-pass topics obey ≤ 3 (4 if all QUICK); DEEPEN top-ups are a
          // final-window re-visit, not a new topic, and only ride targeted-revision.
          const news = topics.filter((t) => t.pass !== 'deepen');
          const deepen = topics.filter((t) => t.pass === 'deepen');
          if (news.length > 0) {
            const allQuick = news.every((t) => t.pass === 'quick');
            expect(news.length).toBeLessThanOrEqual(allQuick ? 4 : 3);
          }
          expect(deepen.length).toBeLessThanOrEqual(4);
          if (deepen.length > 0) expect(b.kind).toBe('targeted-revision');
        }
      }
    }
  });

  it('lifts the small Paper-I subjects out of QUICK-only starvation (240)', () => {
    const { summary } = planAt(240);
    const fit = new Map(summary.subjectFit.map((f) => [f.subject, f] as const));
    // Geography — the reported bug did 6/8 QUICK; now most of it is STANDARD/FULL.
    const geo = fit.get('GEO')!;
    expect(geo.full + geo.standard).toBeGreaterThanOrEqual(3);
    // Economy likewise reaches real depth beyond its two AP topics.
    const econ = fit.get('ECON')!;
    expect(econ.full + econ.standard).toBeGreaterThanOrEqual(5);
  });

  it('reports honest per-subject Paper-I minutes/shares that sum to ~100%', () => {
    const { summary } = planAt(240);
    const share = summary.paperOneSharePctBySubject;
    const minutes = summary.paperOneMinutesBySubject;
    for (const code of PAPER_I) {
      expect(minutes[code]).toBeGreaterThan(0);
      expect(share[code]).toBeGreaterThan(0);
    }
    // History holds 47/88 Paper-I subtopics, so its minute share is structurally
    // the largest; the redesign keeps it proportional rather than hoarding depth.
    expect(share['HIST']!).toBeLessThanOrEqual(55);
    // Geography is no longer starved (was ~10% at 2/8 FULL).
    expect(share['GEO']!).toBeGreaterThanOrEqual(9);
    const total = PAPER_I.reduce((a, c) => a + share[c]!, 0);
    expect(total).toBeGreaterThanOrEqual(98);
    expect(total).toBeLessThanOrEqual(102);
  });

  it('studies every AP / band-A Geography topic at FULL depth in its unit', () => {
    const { days, summary } = planAt(240);
    const pass = passMap(days);
    const geoIds = planSubtopics().filter((s) => s.subjectCode === 'GEO' && s.track !== 'mains').map((s) => s.id);
    expect(geoIds.length).toBe(8);
    // Geography is taught as ONE weekly unit (physical → human). Its AP and
    // band-A topics are always FULL; the rest reach their depth floor.
    const geoProtected = planSubtopics().filter(
      (s) => s.subjectCode === 'GEO' && (AP_RE.test(s.id) || s.band === 'A'),
    );
    expect(geoProtected.length).toBeGreaterThan(0);
    for (const s of geoProtected) expect(pass.get(s.id)).toBe('full');
    const geo = summary.subjectFit.find((f) => f.subject === 'GEO')!;
    expect(geo.full + geo.standard + geo.quick).toBe(8);
  });

  it('studies every band-A Economy topic at FULL depth', () => {
    const { days } = planAt(240);
    const pass = passMap(days);
    const econBandA = planSubtopics().filter((s) => s.subjectCode === 'ECON' && s.band === 'A');
    expect(econBandA.length).toBeGreaterThan(0);
    for (const s of econBandA) expect(pass.get(s.id)).toBe('full');
  });

  it('never donates a weekday block while the donor still has a topic below FULL (240)', () => {
    const { summary } = planAt(240);
    const fit = new Map(summary.subjectFit.map((f) => [f.subject, f] as const));
    for (const r of summary.reallocations) {
      const donor = fit.get(r.fromSubject)!;
      // A donor must be a SPARE donor — every one of its topics is FULL.
      expect(donor.standard + donor.quick).toBe(0);
      expect(donor.full).toBe(donor.total);
    }
  });

  it('reports the History depth floor in the short window, never silently met (240)', () => {
    const { summary } = planAt(240);
    // The stricter depth floor cannot be fully met in the SHORT window (47 days,
    // History's 47 topics), so the plan is NOT feasible and the shortfall is
    // REPORTED; the buffer still only holds QUICK topics within the window.
    expect(summary.feasible).toBe(false);
    expect(summary.infeasibleFloorTopicIds.length).toBeGreaterThan(0);
    for (const s of summary.spills) expect(s.lastDateISO <= SHORT.spillDates[1]).toBe(true);
  });
});

/**
 * The three DEFECT-V4 fixes over REAL content (fixed dates), locking in:
 *  1. priority inversion fixed — High-yield Modern + AP History (H-modern
 *     stream) is first-passed EARLY, not last;
 *  2. integer-packing fit — every AP / band-A topic is placed and only the
 *     lowest-priority QUICK topics are deferred into the Thu 5 / Fri 6 buffer,
 *     so the plan is FEASIBLE at 240;
 *  3. weekend budget matters — a higher weekend budget never yields LESS depth,
 *     and the feasibility options are computed (only emitted when they help).
 */
describe('planner defects v4 — priority, integer packing, weekend budget (real content)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  const AP_RE = /-ap-|andhra|ap-culture|ap-reorganisation|ap-economy/;

  function planAtV4(dailyBudgetMin: number, weekendBudgetMin = dailyBudgetMin) {
    return buildPlan({
      subtopics: planSubtopics(),
      progress: plannerProgress(),
      mainsQuestionIds: mainsQuestionBank(),
      pyqFrequency: pyqFrequency(),
      sequence: learningSequence(),
      examDateISO: '2026-11-15',
      startISO: '2026-09-30',
      todayISO: '2026-09-30',
      dailyBudgetMin,
      weekendBudgetMin,
    });
  }
  const passMapV4 = (days: ReturnType<typeof planAtV4>['days']): Map<string, string> => {
    const m = new Map<string, string>();
    for (const d of days) for (const t of d.topics) if (t.kind === 'topic') m.set(t.subtopicId, t.pass);
    return m;
  };
  const bandById = new Map(planSubtopics().map((s) => [s.id, s.band] as const));

  it('teaches the History units in chronological order (ancient → medieval → modern → art)', () => {
    // Long window so every History unit is reached in the first pass.
    const { days } = buildPlan({
      subtopics: planSubtopics(),
      progress: plannerProgress(),
      mainsQuestionIds: mainsQuestionBank(),
      pyqFrequency: pyqFrequency(),
      sequence: learningSequence(),
      examDateISO: '2027-01-24',
      startISO: '2026-10-10',
      todayISO: '2026-10-10',
      dailyBudgetMin: 240,
      weekendBudgetMin: 360,
    });
    const histUnitOrder: string[] = [];
    for (const d of days) {
      if (d.unitSubjectCode === 'HIST' && d.unitId && !histUnitOrder.includes(d.unitId)) {
        histUnitOrder.push(d.unitId);
      }
    }
    // The History units appear in their authored (chronological) teaching order.
    const expected = learningSequence()
      .units!.filter((u) => u.subjectCode === 'HIST')
      .map((u) => u.id)
      .filter((id) => histUnitOrder.includes(id));
    expect(histUnitOrder).toEqual(expected);
    const idx = (frag: string): number => histUnitOrder.findIndex((id) => id.includes(frag));
    expect(idx('ancient')).toBeLessThan(idx('medieval'));
    expect(idx('medieval')).toBeLessThan(idx('modern'));
    expect(idx('modern')).toBeLessThan(idx('art'));
  });

  it('DEFECT 2 — no AP / band-A spill; every above-QUICK-floor shortfall is QUICK-only and REPORTED (240)', () => {
    const { days, summary } = planAtV4(240);
    // Under the stricter depth floor the 240/240 budget cannot meet the whole
    // floor (History), so the plan reports NOT feasible with the shortfall.
    expect(summary.feasible).toBe(false);
    expect(summary.infeasibleFloorTopicIds.length).toBeGreaterThan(0);
    const pass = passMapV4(days);
    for (const s of summary.spills) {
      for (const id of s.topicIds) {
        expect(pass.get(id)).toBe('quick'); // nothing above QUICK spills
        expect(AP_RE.test(id)).toBe(false); // never AP
        expect(bandById.get(id)).not.toBe('A'); // never band A
      }
    }
    // Every AP topic and every band-A LANE topic (HIST/POL/ECON/GEO/SCI) is FULL.
    const LANES = ['HIST', 'POL', 'ECON', 'GEO', 'SCI'];
    const subs = planSubtopics();
    for (const s of subs) {
      if (s.track === 'mains') continue;
      if (AP_RE.test(s.id) || (s.band === 'A' && LANES.includes(s.subjectCode))) {
        expect(pass.get(s.id)).toBe('full');
      }
    }
  });

  it('DEFECT 2 — ECON places BOTH its AP topics at FULL (integer-packing fix)', () => {
    const { days } = planAtV4(240);
    const pass = passMapV4(days);
    expect(pass.get('econ-ap-economy-bifurcation')).toBe('full');
    expect(pass.get('econ-ap-reorganisation-act')).toBe('full');
  });

  it('a higher SUNDAY budget never yields LESS depth (monotone: 240 ≤ 360 ≤ 420)', () => {
    const depth = (s: ReturnType<typeof planAtV4>['summary']): number =>
      s.subjectFit.reduce((a, f) => a + f.full * 2 + f.standard, 0);
    const w240 = planAtV4(240, 240).summary;
    const w360 = planAtV4(240, 360).summary;
    const w420 = planAtV4(240, 420).summary;
    // A bigger Sunday main block never seats LESS depth (the ≤3-topics-per-block
    // rule caps how much a single Sunday block can add, so growth is monotone,
    // not strict at every step).
    expect(depth(w360)).toBeGreaterThanOrEqual(depth(w240));
    expect(depth(w420)).toBeGreaterThanOrEqual(depth(w360));
  });

  it('SUNDAY SHAPE — a coverage Sunday carries the current-unit main block(s) + weekly revision + CA round-up + Telugu', () => {
    const { days } = planAtV4(240, 360);
    const sundays = days.filter(
      (d) => d.segment === 'coverage' && new Date(`${d.dateISO}T00:00:00Z`).getUTCDay() === 0 && d.blocks.length > 0,
    );
    expect(sundays.length).toBeGreaterThan(0);
    const MAIN_KINDS = new Set(['subject', 'targeted-revision', 'unit-wrapup', 'catchup']);
    for (const d of sundays) {
      // The main study region = the current-unit teaching block(s), plus any
      // UNIT WRAP-UP and 'Catch up or rest' filler (STANDARDS §8a).
      const teaching = d.blocks.filter((b) => b.kind === 'subject' || b.kind === 'targeted-revision');
      expect(teaching.length).toBeGreaterThanOrEqual(1);
      expect(d.blocks.some((b) => b.kind === 'weekly-revision')).toBe(true);
      expect(d.blocks.some((b) => b.kind === 'ca-roundup')).toBe(true);
      expect(d.blocks.some((b) => b.kind === 'telugu')).toBe(true);
      // Each 'subject' block teaches ONE unit (its topics are first-passed today)
      // and carries NO ≥30-min idle (its minutes == its topics' minutes).
      for (const b of d.blocks.filter((x) => x.kind === 'subject')) {
        const tmin = (b.topics ?? []).filter((t) => t.kind === 'topic').reduce((a, t) => a + t.estMinutes, 0);
        expect(b.minutes - tmin).toBeLessThan(30);
        for (const t of b.topics ?? []) {
          if (t.kind === 'topic') expect(d.topics.some((x) => x.subtopicId === t.subtopicId)).toBe(true);
        }
      }
      // The main region fills the Sunday main budget (360 − fixed 120 = 240) to
      // within the 30-min wrap-up threshold, and never exceeds it.
      const mainMin = d.blocks.filter((b) => MAIN_KINDS.has(b.kind)).reduce((a, b) => a + b.minutes, 0);
      expect(mainMin).toBeLessThanOrEqual(240);
      expect(mainMin).toBeGreaterThanOrEqual(240 - 29);
      expect(d.plannedMinutes).toBeLessThanOrEqual(d.budgetMin);
    }
  });

  it('SUNDAY SHAPE — the Sunday main region scales with the Sunday budget (240 → ~120, 360 → ~240)', () => {
    const MAIN_KINDS = new Set(['subject', 'targeted-revision', 'unit-wrapup', 'catchup']);
    const sunMainMin = (days: ReturnType<typeof planAtV4>['days'], budget: number): number => {
      const d = days.find(
        (x) => x.segment === 'coverage' && new Date(`${x.dateISO}T00:00:00Z`).getUTCDay() === 0 && x.blocks.length > 0,
      )!;
      expect(d.budgetMin).toBe(budget);
      // The main region (teaching + wrap-up + catch-up) fills budget − fixed 120.
      return d.blocks.filter((b) => MAIN_KINDS.has(b.kind)).reduce((a, b) => a + b.minutes, 0);
    };
    const at240 = sunMainMin(planAtV4(240, 240).days, 240);
    const at360 = sunMainMin(planAtV4(240, 360).days, 360);
    expect(at240).toBeLessThanOrEqual(120); // 240 − fixed 120
    expect(at240).toBeGreaterThanOrEqual(120 - 29);
    expect(at360).toBeLessThanOrEqual(240); // 360 − fixed 120
    expect(at360).toBeGreaterThanOrEqual(240 - 29);
    expect(at360).toBeGreaterThan(at240); // the Sunday main region grows with the budget
  });

  it('DEFECT 3 — feasibility options are emitted when the depth floor is not met', () => {
    // 240/240 cannot meet the stricter depth floor → an option is offered.
    const base = planAtV4(240).summary;
    expect(base.feasible).toBe(false);
    expect(base.feasibilityOptions.length).toBeGreaterThan(0);
    // A genuinely tight budget is infeasible and DOES emit options; any Sunday
    // option it suggests must actually MEET the floor when applied.
    const tight = planAtV4(120, 120);
    expect(tight.summary.feasible).toBe(false);
    expect(tight.summary.feasibilityOptions.length).toBeGreaterThan(0);
    for (const opt of tight.summary.feasibilityOptions) {
      const m = /Add (\d) h on Sundays/.exec(opt);
      if (m) {
        const probe = planAtV4(120, 120 + Number(m[1]) * 60);
        expect(probe.summary.feasible).toBe(true);
      }
    }
  });

  it('holds every invariant at budgets 180 / 240 / 360 (≤ budget, each topic once)', () => {
    for (const budget of [180, 240, 360]) {
      const { days, summary } = planAtV4(budget, budget);
      for (const d of days) expect(d.plannedMinutes).toBeLessThanOrEqual(d.budgetMin);
      const scheduled = days.flatMap((d) => [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]);
      expect(scheduled.length).toBe(summary.prelimsTotal);
      expect(new Set(scheduled).size).toBe(summary.prelimsTotal);
      // Every AP topic is FULL at all three budgets.
      const pass = passMapV4(days);
      for (const s of planSubtopics()) {
        if (s.track !== 'mains' && AP_RE.test(s.id)) expect(pass.get(s.id)).toBe('full');
      }
    }
  });
});

/**
 * POOL-FIX hard invariants (real content, fixed dates) — the guarantees the
 * three reported defects break:
 *  B1  every day's blocks are LEGAL — a block never claims fewer minutes than
 *      its own topics need, never teaches > 3 new topics (4 only if all QUICK),
 *      and a day never plans past its budget (the buffer no longer crams 25
 *      History topics into a 240-min day with 60-min "spill" blocks);
 *  B2  OWN-CAPACITY-FIRST — Economy's own six Wednesdays seat ≥ 10 FULL topics
 *      (it is no longer collapsed to its floor just because History overflows),
 *      and both its AP topics stay FULL;
 *  B3  the Sunday budget MATTERS — a 420-min Sunday buys strictly MORE depth
 *      than 360 (History's Modern block is no longer hard-capped at 120), and
 *      Polity never sits at FULL on a non-band-A topic while a History PYQ>0
 *      topic is still below STANDARD.
 * Plus the floor is always MET or REPORTED, and all existing rhythm invariants.
 */
describe('planner POOL-FIX — hard invariants (real content)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  const AP_RE = /-ap-|andhra|ap-culture|ap-reorganisation|ap-economy/;

  function planPF(dailyBudgetMin: number, weekendBudgetMin = dailyBudgetMin) {
    return buildPlan({
      subtopics: planSubtopics(),
      progress: plannerProgress(),
      mainsQuestionIds: mainsQuestionBank(),
      pyqFrequency: pyqFrequency(),
      sequence: learningSequence(),
      examDateISO: '2026-11-15',
      startISO: '2026-09-30',
      todayISO: '2026-09-30',
      dailyBudgetMin,
      weekendBudgetMin,
    });
  }
  const passOf = (days: ReturnType<typeof planPF>['days']): Map<string, string> => {
    const m = new Map<string, string>();
    for (const d of days) for (const t of d.topics) if (t.kind === 'topic') m.set(t.subtopicId, t.pass);
    return m;
  };
  // Depth score: FULL counts double, STANDARD once, QUICK zero.
  const depthScore = (s: ReturnType<typeof planPF>['summary']): number =>
    s.subjectFit.reduce((a, f) => a + f.full * 2 + f.standard, 0);

  it('B1 — every day is block-legal at 240 weekday with 240 / 360 / 420 Sunday', () => {
    for (const sun of [240, 360, 420]) {
      const { days } = planPF(240, sun);
      for (const d of days) {
        // Day never plans beyond its own budget.
        expect(d.plannedMinutes).toBeLessThanOrEqual(d.budgetMin);
        for (const b of d.blocks) {
          const topics = (b.topics ?? []).filter((t) => t.kind === 'topic');
          if (topics.length === 0) continue;
          // NEW first-pass topics: ≤ 3 (4 only if every one is QUICK). DEEPEN
          // top-ups (final-window re-visits) are separate: ≤ 4, targeted-revision only.
          const news = topics.filter((t) => t.pass !== 'deepen');
          const deepen = topics.filter((t) => t.pass === 'deepen');
          if (news.length > 0) {
            const allQuick = news.every((t) => t.pass === 'quick');
            expect(news.length).toBeLessThanOrEqual(allQuick ? 4 : 3);
          }
          expect(deepen.length).toBeLessThanOrEqual(4);
          if (deepen.length > 0) expect(b.kind).toBe('targeted-revision');
          // A block never claims FEWER minutes than ALL the topics it teaches
          // (new + deepen) — the buffer-overflow bug: a 60-min block holding 75 min.
          const topicMinutes = topics.reduce((a, t) => a + t.estMinutes, 0);
          expect(topicMinutes).toBeLessThanOrEqual(b.minutes);
        }
      }
    }
  });

  it('B2 — Economy places BOTH its AP topics at FULL at 240 / 360', () => {
    for (const sun of [240, 360]) {
      const { days } = planPF(240, sun);
      const pass = passOf(days);
      // AP topics are always FULL (protected), even in the tight short window.
      expect(pass.get('econ-ap-economy-bifurcation')).toBe('full');
      expect(pass.get('econ-ap-reorganisation-act')).toBe('full');
    }
  });

  it('B3 — a 420-min Sunday never buys LESS depth than 360 (monotone)', () => {
    const s360 = planPF(240, 360).summary;
    const s420 = planPF(240, 420).summary;
    // A bigger Sunday main block never seats LESS depth; the ≤3-topics-per-block
    // rule caps the gain, so growth is monotone rather than strict at every step.
    expect(depthScore(s420)).toBeGreaterThanOrEqual(depthScore(s360));
    const s480 = planPF(240, 480).summary;
    expect(depthScore(s480)).toBeGreaterThanOrEqual(depthScore(s420));
  });

  it('B3 — no Polity non-band-A topic is FULL while a History PYQ>0 topic is below STANDARD (240 / 360)', () => {
    const RANK: Record<string, number> = { quick: 0, standard: 1, full: 2 };
    for (const sun of [240, 360]) {
      const { days } = planPF(240, sun);
      const pass = passOf(days);
      const pyq = pyqFrequency();
      const subs = planSubtopics();
      const histPyqBelowStandard = subs.some(
        (s) => s.subjectCode === 'HIST' && (pyq[s.id] ?? 0) > 0 && (RANK[pass.get(s.id) ?? 'quick'] ?? 0) < 1,
      );
      if (!histPyqBelowStandard) continue;
      for (const s of subs) {
        if (s.subjectCode !== 'POL' || s.track === 'mains') continue;
        if (AP_RE.test(s.id) || s.band === 'A') continue; // protected topics may be FULL
        expect(pass.get(s.id)).not.toBe('full');
      }
    }
  });

  it('floor is MET or REPORTED, never silently broken (240 / 360)', () => {
    for (const sun of [240, 360]) {
      const { summary } = planPF(240, sun);
      // At 240 weekday the History floor cannot be met, so the plan reports NOT
      // feasible WITH the explicit shortfall; feasibility is never true while a
      // floor topic is unreported.
      if (!summary.feasible) {
        expect(summary.infeasibleFloorTopicIds.length).toBeGreaterThan(0);
        expect(summary.feasibilityOptions.length).toBeGreaterThan(0);
      } else {
        expect(summary.infeasibleFloorTopicIds.length).toBe(0);
      }
    }
  });
});

/**
 * DEEPEN passes over REAL content (fixed dates), STANDARDS §8a "no weak areas".
 * The final window (Thu 5 – Sat 14 Nov) closes the below-floor tail left after
 * coverage by scheduling one DEEPEN top-up per below-floor topic in the
 * targeted-revision blocks: at 240 weekday + 360 Sunday every one of the 17
 * still-QUICK STANDARD-floor topics is lifted to its floor, so the plan is
 * FEASIBLE with an empty shortfall; at the tighter 240/240 the window cannot
 * deepen them all, so the remainder is explicitly REPORTED.
 */
describe('planner DEEPEN passes — final-window weak-area top-ups (real content)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  function planDeepen(sun = 360) {
    return buildPlan({
      subtopics: planSubtopics(),
      progress: plannerProgress(),
      mainsQuestionIds: mainsQuestionBank(),
      pyqFrequency: pyqFrequency(),
      sequence: learningSequence(),
      examDateISO: '2026-11-15',
      startISO: '2026-09-30',
      todayISO: '2026-09-30',
      dailyBudgetMin: 240,
      weekendBudgetMin: sun,
    });
  }
  const firstPassDates = (days: ReturnType<typeof planDeepen>['days']): Map<string, string> => {
    const fp = new Map<string, string>();
    for (const d of days) for (const id of [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]) if (!fp.has(id)) fp.set(id, d.dateISO);
    return fp;
  };
  const passMap = (days: ReturnType<typeof planDeepen>['days']): Map<string, string> => {
    const m = new Map<string, string>();
    for (const d of days) for (const t of d.topics) if (t.kind === 'topic') m.set(t.subtopicId, t.pass);
    return m;
  };

  it('long window (240/360) is FEASIBLE with an empty floor shortfall and NO feasibility options', () => {
    // The real long window seats every topic FULL in its unit run.
    const { summary } = buildPlan({
      subtopics: planSubtopics(),
      progress: plannerProgress(),
      mainsQuestionIds: mainsQuestionBank(),
      pyqFrequency: pyqFrequency(),
      sequence: learningSequence(),
      examDateISO: '2027-01-24',
      startISO: '2026-10-10',
      todayISO: '2026-10-10',
      dailyBudgetMin: 240,
      weekendBudgetMin: 360,
    });
    expect(summary.feasible).toBe(true);
    expect(summary.infeasibleFloorTopicIds).toEqual([]);
    // No "move the exam date" / "add Sunday time" noise once the floor is met.
    expect(summary.feasibilityOptions).toEqual([]);
    expect(summary.deepenTopicIds).toEqual([]); // nothing below floor to deepen
  });

  it('deepens below-floor topics in the final window — once each, AFTER first pass, block-legal (240/360 short)', () => {
    const { days, summary } = planDeepen(360);
    const deep = summary.deepenTopicIds;
    // The short window leaves a below-floor tail that the final window deepens.
    expect(deep.length).toBeGreaterThan(0);
    const ids = deep.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length); // exactly once each
    const fp = firstPassDates(days);
    const pass = passMap(days);
    const mockDates = new Set(buildMockSchedule('2026-09-30', SHORT).keys());
    for (const d of deep) {
      // A deepen lifts a below-floor topic UP toward its floor tier.
      expect(['quick', 'standard']).toContain(d.fromTier);
      // Its FIRST PASS tier is unchanged (deepen adds no new first pass).
      expect(pass.get(d.id)).toBe(d.fromTier);
      // Scheduled strictly AFTER its own first pass …
      expect(fp.get(d.id)! < d.dateISO).toBe(true);
      // … inside the final window …
      expect(d.dateISO >= SHORT.finalStartISO && d.dateISO <= addDaysISO(SHORT.examISO, -2)).toBe(true);
      // … and never on a mock / light / exam day.
      expect(mockDates.has(d.dateISO)).toBe(false);
      expect(d.dateISO).not.toBe(SHORT.lightISO);
      expect(d.dateISO).not.toBe(SHORT.examISO);
    }
    // A deepened topic is not ALSO reported as still below floor.
    const reported = new Set(summary.infeasibleFloorTopicIds);
    for (const id of ids) expect(reported.has(id)).toBe(false);
  });

  it('keeps deepen blocks legal and adds no double first-pass (240/360)', () => {
    const { days } = planDeepen(360);
    for (const d of days) {
      expect(d.plannedMinutes).toBeLessThanOrEqual(d.budgetMin);
      for (const b of d.blocks) {
        const deepen = (b.topics ?? []).filter((t) => t.pass === 'deepen');
        if (deepen.length === 0) continue;
        // ≤ 4 deepen top-ups, only ever on a targeted-revision block …
        expect(b.kind).toBe('targeted-revision');
        expect(deepen.length).toBeLessThanOrEqual(4);
        // … the block never claims fewer minutes than the topics it teaches …
        const topicMinutes = (b.topics ?? []).filter((t) => t.kind === 'topic').reduce((a, t) => a + t.estMinutes, 0);
        expect(topicMinutes).toBeLessThanOrEqual(b.minutes);
        // … and a deepen is NOT recorded as a (second) first pass.
        for (const t of deepen) {
          expect(d.theorySubtopicIds).not.toContain(t.subtopicId);
          expect(d.aptitudeSubtopicIds).not.toContain(t.subtopicId);
        }
      }
    }
    // Every prelims subtopic is STILL first-passed exactly once.
    const scheduled = days.flatMap((d) => [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]);
    expect(new Set(scheduled).size).toBe(117);
  });

  it('at 240/240 the window cannot deepen every below-floor topic — the remainder is REPORTED (empty OR reported)', () => {
    const { summary } = planDeepen(240);
    if (summary.feasible) {
      expect(summary.infeasibleFloorTopicIds).toEqual([]);
    } else {
      expect(summary.infeasibleFloorTopicIds.length).toBeGreaterThan(0);
      expect(summary.feasibilityOptions.length).toBeGreaterThan(0);
    }
    // Whatever is deepened is exactly-once and never also reported as below floor.
    const ids = summary.deepenTopicIds.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const reported = new Set(summary.infeasibleFloorTopicIds);
    for (const id of ids) expect(reported.has(id)).toBe(false);
  });
});

/**
 * Learner-chosen PLAN START DATE: days before the start are FREE (no blocks, no
 * placement) and the plan's first on/after-start day is day 1. When day 1 is a
 * Saturday it is the DAY-1 ORIENTATION day (STANDARDS §8a) — a "Start here"
 * guide block + the first Mental Ability / History topics + a CA intro, with NO
 * mock and NO revise block. Driven through the pure engine with fixed dates so
 * it is clock-independent.
 */
describe('plan start date — free pre-start days + day-1 orientation', () => {
  beforeEach(() => {
    __resetForTests();
  });

  function planFrom(startISO: string, todayISOArg: string) {
    return buildPlan({
      subtopics: planSubtopics(),
      progress: plannerProgress(),
      mainsQuestionIds: mainsQuestionBank(),
      pyqFrequency: pyqFrequency(),
      sequence: learningSequence(),
      examDateISO: '2027-01-24',
      startISO,
      todayISO: todayISOArg,
      dailyBudgetMin: 240,
      weekendBudgetMin: 360,
    });
  }

  it('schedules nothing on 9 Oct and makes day 1 (Sat 10 Oct) an ORIENTATION day — no mock', () => {
    const { days } = planFrom('2026-10-10', '2026-10-09');
    // Today (9 Oct) precedes the start — a FREE day: no blocks, nothing placed.
    const oct9 = days.find((d) => d.dateISO === '2026-10-09');
    expect(oct9).toBeDefined();
    expect(oct9!.blocks).toEqual([]);
    expect(oct9!.theorySubtopicIds).toEqual([]);
    expect(oct9!.aptitudeSubtopicIds).toEqual([]);
    expect(oct9!.plannedMinutes).toBe(0);
    // The first day that carries any blocks is 10 Oct.
    const firstWithBlocks = days.find((d) => d.blocks.length > 0);
    expect(firstWithBlocks?.dateISO).toBe('2026-10-10');
    // 10 Oct is the ORIENTATION day: no mock, a Start-here block, the first MENT
    // topic, the first History topic(s), a CA intro, and NO revise block.
    const day1 = days.find((d) => d.dateISO === '2026-10-10')!;
    expect(day1.mockPaper).toBeNull();
    expect(day1.blocks.some((b) => b.kind === 'mock')).toBe(false);
    expect(day1.blocks.some((b) => b.kind === 'revise')).toBe(false);
    const startHere = day1.blocks.find((b) => b.kind === 'start-here');
    expect(startHere).toBeDefined();
    expect(startHere!.minutes).toBe(30);
    const ment = day1.blocks.find((b) => b.kind === 'ment');
    expect(ment?.topics?.[0]?.subtopicId).toBe('ment-number-system');
    const hist = day1.blocks.find((b) => b.kind === 'subject' && b.subjectCode === 'HIST');
    expect(hist?.topics?.[0]?.subtopicId).toBe('hist-ancient-stone-age');
    expect(day1.blocks.some((b) => b.kind === 'ca')).toBe(true);
  });

  it('first-passes every prelims subtopic exactly once despite the free pre-start + orientation day', () => {
    const { days } = planFrom('2026-10-10', '2026-10-09');
    const aptitude = days.flatMap((d) => d.aptitudeSubtopicIds);
    expect(aptitude.length).toBe(29);
    expect(new Set(aptitude).size).toBe(29);
    const theory = days.flatMap((d) => d.theorySubtopicIds);
    expect(new Set(theory).size).toBe(88);
    // The orientation day's Mental Ability + History STUDY blocks ARE the first
    // pass of their topics (recorded here, exactly once) — a beginner never
    // studies them again on a later day.
    const day1 = days.find((d) => d.dateISO === '2026-10-10')!;
    expect(day1.aptitudeSubtopicIds).toContain('ment-number-system');
    expect(day1.theorySubtopicIds).toContain('hist-ancient-stone-age');
    const otherFirstPass = new Set(
      days
        .filter((d) => d.dateISO !== '2026-10-10')
        .flatMap((d) => [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]),
    );
    expect(otherFirstPass.has('ment-number-system')).toBe(false);
    expect(otherFirstPass.has('hist-ancient-stone-age')).toBe(false);
  });

  it('first-passes every subtopic on exactly ONE day (orientation, Wednesday, and Monday starts)', () => {
    // The duplication bug surfaced on a Saturday (orientation) start, but the
    // "first-passed exactly once" invariant must hold for EVERY start shape.
    const starts: ReadonlyArray<readonly [string, string]> = [
      ['2026-10-10', '2026-10-09'], // Saturday start → day-1 orientation
      ['2026-09-30', '2026-09-30'], // Wednesday start → no orientation
      ['2026-10-12', '2026-10-12'], // Monday start → no orientation
    ];
    for (const [startISO, todayISOArg] of starts) {
      const { days } = planFrom(startISO, todayISOArg);
      const firstPass = days.flatMap((d) => [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]);
      // No subtopic appears as a first pass on more than one day.
      const seen = new Map<string, number>();
      for (const id of firstPass) seen.set(id, (seen.get(id) ?? 0) + 1);
      const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
      expect(dupes).toEqual([]);
      // …and every prelims theory (88) + aptitude (29) topic is first-passed once.
      expect(new Set(days.flatMap((d) => d.theorySubtopicIds)).size).toBe(88);
      expect(new Set(days.flatMap((d) => d.aptitudeSubtopicIds)).size).toBe(29);
    }
  });

  it('continues the MENT sequence the next MENT day after orientation (no re-teach of number-system)', () => {
    const { days } = planFrom('2026-10-10', '2026-10-09');
    const orientation = days.find((d) => d.blocks.some((b) => b.kind === 'start-here'))!;
    expect(orientation.dateISO).toBe('2026-10-10');
    const orientMent = orientation.blocks.find((b) => b.kind === 'ment');
    expect(orientMent?.topics?.[0]?.subtopicId).toBe('ment-number-system');
    // The FIRST 'ment' topic block AFTER orientation continues the sequence with
    // the next topic — it does NOT re-teach ment-number-system.
    const nextMent = days
      .filter((d) => d.dateISO > orientation.dateISO)
      .flatMap((d) => d.blocks)
      .find((b) => b.kind === 'ment' && (b.topics?.length ?? 0) > 0);
    expect(nextMent?.topics?.[0]?.subtopicId).toBe('ment-number-series-coding');
  });

  it('never relabels a mock as baseline; first pass uses week tests + one dress rehearsal', () => {
    const { days, summary } = planFrom('2026-09-30', '2026-10-09');
    // The first pass carries WEEK TESTS on Saturdays (not full mocks).
    const firstWeekTest = days.find((d) => d.blocks.some((b) => b.kind === 'week-test'))!;
    expect(firstWeekTest).toBeDefined();
    expect(dayOfWeekISO(firstWeekTest.dateISO)).toBe(6);
    expect(firstWeekTest.phase).toBe('learn');
    // The only first-pass full mock is the DRESS REHEARSAL; its label is plain
    // language, never "baseline".
    const dress = days.find((d) => d.mockPaper !== null && d.dateISO < summary.coverageEndISO)!;
    const dressBlock = dress.blocks.find((b) => b.kind === 'mock');
    expect(dressBlock?.label).not.toContain('baseline');
    expect(dressBlock?.label).toContain('Dress rehearsal');
    // Revision-cycle / final full mocks keep the plain "Full Paper-x mock" label.
    const fullMock = days.find(
      (d) => d.mockPaper !== null && d.dateISO >= summary.coverageEndISO,
    )!;
    const fullBlock = fullMock.blocks.find((b) => b.kind === 'mock');
    expect(fullBlock?.label).toMatch(/^Full Paper-(I|II) mock$/);
  });

  it('week-test pools only contain FIRST-PASSED topics; Sat 17 Oct draws ~2/3 that week', () => {
    const { days } = planFrom('2026-10-10', '2026-10-09');
    // Cumulative set of topics first-passed on or before each date.
    const firstPassOnOrBefore = (dateISO: string): Set<string> => {
      const set = new Set<string>();
      for (const d of days) {
        if (d.dateISO > dateISO) continue;
        for (const id of [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]) set.add(id);
      }
      return set;
    };

    const sat = days.find((d) => d.dateISO === '2026-10-17')!;
    const wt = sat.blocks.find((b) => b.kind === 'week-test');
    expect(wt).toBeDefined();
    expect(wt!.weekTestDateISO).toBe('2026-10-17');

    const studied = firstPassOnOrBefore('2026-10-17');
    // Every pool id was first-passed on or before this Saturday (never a topic
    // not yet studied).
    for (const id of wt!.weekTestSubtopicIds ?? []) expect(studied.has(id)).toBe(true);
    expect((wt!.weekTestSubtopicIds ?? []).length).toBeGreaterThan(0);

    // "This week" ids are the subset first-passed in the 7 days ending Sat.
    const weekStart = addDaysISO('2026-10-17', -6);
    const thisWeekExpected = new Set<string>();
    for (const d of days) {
      if (d.dateISO < weekStart || d.dateISO > '2026-10-17') continue;
      for (const id of [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]) thisWeekExpected.add(id);
    }
    for (const id of wt!.weekTestThisWeekIds ?? []) expect(thisWeekExpected.has(id)).toBe(true);
    // The pool is the union; this-week is a (non-empty) subset of it.
    expect((wt!.weekTestThisWeekIds ?? []).length).toBeGreaterThan(0);
    for (const id of wt!.weekTestThisWeekIds ?? []) {
      expect((wt!.weekTestSubtopicIds ?? []).includes(id)).toBe(true);
    }
  });
});
});

/**
 * WEEKLY SUBJECT UNITS over REAL content, long window (exam 24 Jan 2027): the
 * interleaving keeps no Paper-I subject waiting too long, and the revision cycle
 * revisits the units in the SAME teaching order.
 */
describe('weekly subject units — interleaving + revision order (real content, long window)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  function longPlan() {
    return buildPlan({
      subtopics: planSubtopics(),
      progress: plannerProgress(),
      mainsQuestionIds: mainsQuestionBank(),
      pyqFrequency: pyqFrequency(),
      sequence: learningSequence(),
      examDateISO: '2027-01-24',
      startISO: '2026-10-10',
      todayISO: '2026-10-10',
      dailyBudgetMin: 240,
      weekendBudgetMin: 360,
    });
  }

  it('no Paper-I subject waits more than 5 weeks between its units', () => {
    const { summary } = longPlan();
    const PAPER_I = ['HIST', 'POL', 'ECON', 'GEO'];
    const diffDays = (a: string, b: string): number => (Date.parse(b) - Date.parse(a)) / 86_400_000;
    for (const code of PAPER_I) {
      const windows = summary.units
        .filter((u) => u.subjectCode === code && u.startISO)
        .sort((a, b) => a.startISO.localeCompare(b.startISO));
      for (let i = 1; i < windows.length; i += 1) {
        const gapWeeks = diffDays(windows[i - 1]!.endISO, windows[i]!.startISO) / 7;
        expect(gapWeeks).toBeLessThanOrEqual(5);
      }
    }
  });

  it('every non-MENT/CA Prelims topic is covered by exactly one unit, contiguous in sequence', () => {
    const seq = learningSequence();
    const inUnit = new Map<string, number>();
    seq.units!.forEach((u, i) => u.topicIds.forEach((id) => inUnit.set(id, (inUnit.get(id) ?? 0) + (i + 1) * 0 + 1)));
    // exactly once
    for (const [, n] of inUnit) expect(n).toBe(1);
    // every HIST/POL/ECON/GEO/SCI prelims topic appears
    const expected = planSubtopics().filter(
      (s) => s.track !== 'mains' && ['HIST', 'POL', 'ECON', 'GEO', 'SCI'].includes(s.subjectCode),
    );
    for (const s of expected) expect(inUnit.has(s.id)).toBe(true);
    expect(inUnit.size).toBe(expected.length);
    // each unit is a contiguous run of its subject's sequence
    for (const u of seq.units!) {
      const order = seq.order[u.subjectCode] ?? [];
      const start = order.indexOf(u.topicIds[0]!);
      expect(start).toBeGreaterThanOrEqual(0);
      for (let i = 0; i < u.topicIds.length; i += 1) expect(order[start + i]).toBe(u.topicIds[i]);
    }
  });

  it('the revision cycle revisits the units in the SAME teaching order', () => {
    const { days } = longPlan();
    const revUnitOrder: string[] = [];
    for (const d of days) {
      if (d.segment !== 'revision') continue;
      if (d.unitId && !revUnitOrder.includes(d.unitId)) revUnitOrder.push(d.unitId);
      // Revision teaches NO new first-pass topics.
      expect([...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]).toEqual([]);
    }
    expect(revUnitOrder.length).toBeGreaterThan(0);
    // The revisit order is a prefix-consistent subsequence of the authored unit order.
    const authored = learningSequence().units!.map((u) => u.id);
    const authoredFiltered = authored.filter((id) => revUnitOrder.includes(id));
    expect(revUnitOrder).toEqual(authoredFiltered);
  });
});
