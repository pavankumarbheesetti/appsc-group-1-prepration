/**
 * Plan data-access — the thin bridge between the loaded content + persisted
 * store and the PURE {@link buildPlan} engine.
 *
 * It flattens the taxonomy into the engine's {@link PlanSubtopic} shape (id,
 * chronological order, band, authored `mcqCount`) and summarises the learner's
 * per-MCQ progress into the engine's per-subtopic `{ seen, masteryPct }` map —
 * so the engine itself never imports the loader or the store and stays
 * trivially testable. This is a selector, not pure logic: keep the arithmetic
 * in the engine and metrics modules.
 */
import { getBanks, getContentIndex, getLearningSequence, getSubjects, getSubtopic, getSubtopics, getUnits } from '../content/loader';
import { subtopicMasteryPct } from './metrics';
import { loadState } from '../state/store';
import { todayISO } from './dates';
import { buildSession } from '../engine/drill';
import type { MCQItem } from '../content/types';
import type { LearningStream, PlanUnit } from '../content/plan-types';
import type { ExamPattern } from './exam-pattern';
import type { SectionPools } from '../engine/mock';
import {
  buildPlan,
  type Plan,
  type PlanMainsPaper,
  type PlanSequence,
  type PlanSubtopic,
  type PlannerProgress,
} from '../engine/planner';
import { isMainsNote } from '../engine/flashcards';

/**
 * All taxonomy subtopics as engine inputs, joined with authored MCQ counts and
 * their subject's exam TRACK (paper1 theory / paper2 aptitude / mains parallel).
 */
export function planSubtopics(): PlanSubtopic[] {
  return getSubjects().flatMap((s) =>
    getSubtopics(s.code).map((meta) => {
      const view = getSubtopic(meta.id);
      const notes = view?.notes.length ?? 0;
      const mcqs = view?.mcqs.length ?? 0;
      const mains = view?.mains.length ?? 0;
      return {
        id: meta.id,
        name: meta.name,
        order: meta.order,
        subjectCode: meta.subjectCode,
        track: meta.track ?? s.track,
        band: meta.band,
        mcqCount: mcqs,
        examPointCount: meta.examPoints?.length ?? 0,
        hasMaterial: notes + mcqs + mains > 0,
        hasMainsAngleNote: (view?.notes ?? []).some(isMainsNote),
      };
    }),
  );
}

/**
 * The MAINS practice-question bank: every authored mains question id, in
 * deterministic bank-discovery order. The planner cycles a light 2–4/day quota
 * through this list as a parallel task (never part of the prelims deadline).
 */
export function mainsQuestionBank(): string[] {
  const out: string[] = [];
  for (const loaded of getBanks('mains')) {
    if (loaded.bank.kind !== 'mains') continue;
    for (const item of loaded.bank.items) out.push(item.id);
  }
  return out;
}

/** Human labels for the five descriptive Mains papers (I–V). @internal */
const MAINS_PAPER_TITLES: Record<string, string> = {
  'mains-1': 'Mains Paper I',
  'mains-2': 'Mains Paper II',
  'mains-3': 'Mains Paper III',
  'mains-4': 'Mains Paper IV',
  'mains-5': 'Mains Paper V',
};

/**
 * The POST-PRELIMS per-paper Mains-revision mapping (STANDARDS §8a): each Mains
 * paper (I–V) joined to the Prelims subtopics that cover it — read from
 * `content/audit/syllabus-map.json`'s `mains-1`..`mains-5` clauses — plus the
 * authored Mains question ids whose answers to write for that paper. A mapped
 * subtopic is kept only when it ACTUALLY has a "For Mains" angle note OR authored
 * Mains questions, so the kick-start never points at an empty topic. The planner
 * cycles one paper per day across the first four weeks of the kick-start.
 */
export function mainsRevisionPapers(): PlanMainsPaper[] {
  const map = getContentIndex().auditSyllabusMap;
  // Authored Mains question ids grouped by their owning subtopic.
  const qBySubtopic = new Map<string, string[]>();
  for (const loaded of getBanks('mains')) {
    if (loaded.bank.kind !== 'mains') continue;
    for (const item of loaded.bank.items) {
      if (!item.subtopicId) continue;
      const arr = qBySubtopic.get(item.subtopicId) ?? [];
      arr.push(item.id);
      qBySubtopic.set(item.subtopicId, arr);
    }
  }
  const hasMainsNote = (id: string): boolean => (getSubtopic(id)?.notes ?? []).some(isMainsNote);

  const out: PlanMainsPaper[] = [];
  for (const paper of ['mains-1', 'mains-2', 'mains-3', 'mains-4', 'mains-5'] as const) {
    const subtopicIds: string[] = [];
    const mainsQuestionIds: string[] = [];
    const seen = new Set<string>();
    for (const clause of map) {
      if (clause.paper !== paper) continue;
      for (const sid of clause.subtopicIds) {
        if (seen.has(sid)) continue;
        seen.add(sid);
        const qs = qBySubtopic.get(sid) ?? [];
        if (!hasMainsNote(sid) && qs.length === 0) continue; // skip empty topics
        subtopicIds.push(sid);
        mainsQuestionIds.push(...qs);
      }
    }
    if (subtopicIds.length === 0 && mainsQuestionIds.length === 0) continue;
    out.push({ paper, title: MAINS_PAPER_TITLES[paper]!, subtopicIds, mainsQuestionIds });
  }
  return out;
}

/**
 * Assemble the per-SECTION question pools a full-length mock draws from, keyed
 * by the section's `subjectCode`. Each pool is the whole authored MCQ set for
 * that subject in stable content order (via {@link buildSession} with no cap),
 * so the pure {@link buildPaperMock} engine can shuffle + window it into a
 * non-repeating series. A section whose subject has no bank yields `[]`.
 */
export function mockSectionPools(pattern: ExamPattern): SectionPools {
  const pools: Record<string, MCQItem[]> = {};
  for (const section of pattern.sections) {
    // Reuse the drill builder (stable ladder order, whole scope) per subject.
    pools[section.subjectCode] = buildSession({
      subjectCode: section.subjectCode,
      order: 'ladder',
    }).items;
  }
  return pools;
}

/**
 * Summarise the per-MCQ progress map into the engine's per-subtopic progress:
 * `seen` counts distinct MCQs attempted at least once; `masteryPct` reuses the
 * shared {@link subtopicMasteryPct} so "studied"/"mastered" match the rest of
 * the app exactly.
 */
export function plannerProgress(): PlannerProgress {
  const progress = loadState().progress;
  const out: Record<string, { seen: number; masteryPct: number }> = {};
  for (const s of getSubjects()) {
    for (const meta of getSubtopics(s.code)) {
      const view = getSubtopic(meta.id);
      const ids = view?.mcqs.map((m) => m.id) ?? [];
      let seen = 0;
      for (const id of ids) {
        const p = progress[id];
        if (p && p.seen > 0) seen += 1;
      }
      out[meta.id] = { seen, masteryPct: subtopicMasteryPct(progress, ids) };
    }
  }
  return out;
}

/**
 * Per-subtopic PYQ FREQUENCY — how strongly each subtopic recurs across past
 * papers, taken as the number of PYQ QUESTIONS (2019/2023/2024) mapped to it in
 * `content/audit/pyq-weights.json`. This is the TRUE per-subtopic question count
 * (summed across the 3-cycle corpus), NOT the flat one-gist-per-topic count that
 * `pyq-map.json` yields — so the single most-repeated topics (National Income,
 * President/Executive, …) carry real weight. The planner uses this to decide
 * which BAND-B topics to FAST-pass first (lowest frequency → fast first) and to
 * PROTECT the top-25% most-repeated topics from ever being fast-passed; band A
 * is never fast-passed regardless.
 */
export function pyqFrequency(): Record<string, number> {
  // The weights file already carries one entry per Prelims subtopic (0 allowed),
  // so we can return it directly as a fresh, mutable copy.
  return { ...getContentIndex().auditPyqWeights.weights };
}

/**
 * The pedagogical LEARNING SEQUENCE as the planner needs it: each Prelims
 * subject's ordered subtopic ids (prereq-correct, from
 * `content/plan/learning-sequence.json`) filtered to the in-scope
 * (paper1/paper2) subtopics, plus the MENT stream tags. The rhythm packs each
 * subject's topics strictly in this order (never before a prerequisite).
 */
export function learningSequence(): PlanSequence {
  const seq = getLearningSequence();
  // In-scope ids = every paper1/paper2 subtopic (mains excluded).
  const inScope = new Set(
    planSubtopics()
      .filter((s) => s.track !== 'mains')
      .map((s) => s.id),
  );
  const order: Record<string, string[]> = {};
  const mentStreams: Record<string, LearningStream> = {};
  const histStreams: Record<string, 'early' | 'modern'> = {};
  for (const [code, steps] of Object.entries(seq.subjects)) {
    order[code] = steps.filter((step) => inScope.has(step.id)).map((step) => step.id);
    if (code === 'MENT') {
      for (const step of steps) if (step.stream === 'quant' || step.stream === 'reasoning' || step.stream === 'abilities') mentStreams[step.id] = step.stream;
    }
    if (code === 'HIST') {
      for (const step of steps) if (step.stream === 'early' || step.stream === 'modern') histStreams[step.id] = step.stream;
    }
  }
  // The ordered WEEKLY SUBJECT UNITS the first pass teaches one at a time, each
  // filtered to its in-scope (paper1/paper2) subtopics. The engine packs units
  // in this order; MENT + CA remain their own daily lanes (not unitised).
  const units: PlanUnit[] = getUnits().units.map((u) => ({
    id: u.id,
    subjectCode: u.subjectCode,
    title: u.title,
    why: u.why,
    topicIds: u.topicIds.filter((id) => inScope.has(id)),
  }));
  return { order, mentStreams, histStreams, units };
}

/**
 * Build the current plan from live content + state. `now` is injectable for
 * tests; production passes the real clock.
 */
export function currentPlan(now: Date = new Date()): Plan {
  const settings = loadState().settings;
  return buildPlan({
    subtopics: planSubtopics(),
    progress: plannerProgress(),
    mainsQuestionIds: mainsQuestionBank(),
    mainsPapers: mainsRevisionPapers(),
    pyqFrequency: pyqFrequency(),
    sequence: learningSequence(),
    examDateISO: settings.examDate,
    startISO: settings.planStartDate,
    todayISO: todayISO(now),
    dailyBudgetMin: settings.dailyStudyMinutes,
    // The Sunday budget (Saturday is a mock day and follows the daily budget).
    // Passed on the planner's `weekendBudgetMin` opt, which the rhythm now treats
    // as the SUNDAY budget only.
    weekendBudgetMin: settings.sundayStudyMinutes,
    // Festival / holiday days off → LIGHT days (≤ 60 min, no mock/new topic);
    // mocks move off them and displaced work flows into the catch-up buffers.
    daysOff: settings.daysOff,
  });
}
