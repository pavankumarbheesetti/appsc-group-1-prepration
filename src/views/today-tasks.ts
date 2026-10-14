/**
 * TODAY TASKS — the row model behind Today's checklist and the Planner's day
 * cells (FLOW-QA D2, D5–D10; LOGIC-AUDIT H1, H4, M1, L5).
 *
 * Every plan block becomes one or more ROWS. Each row has:
 *  - a clear task + amount (label / detail / minutes),
 *  - ONE destination matching its label ({@link rowView} `onClick`),
 *  - a completion state ({@link rowDone}).
 *
 * Topic rows finish through the study status ("Mark as studied"); tests
 * through the finished-test history; the Telugu lesson through its lesson
 * record; every other row through a per-day key in `state.blocksDone`
 * (`lib/day-tasks.ts`). Rows whose session runs in another view (flashcards,
 * the review list) register with {@link beginTask}; that view ticks the row
 * when its session ends.
 *
 * Today and the Planner both build rows here, so a Planner block opens exactly
 * what the same Today row opens (D2).
 */
import { getBanks, getCards, getSubjects, getSubtopic, getSubtopics } from '../content/loader';
import type { MCQItem, MainsItem } from '../content/types';
import { planDayFor, type PlanBlock, type PlanDay, type PlanTopic } from '../engine/planner';
import { WEEK_TEST_COUNT, WEEK_TEST_MINUTES } from '../engine/mock';
import { navigate, pushUrl } from '../router/router';
import { getTeluguLessonsDone, loadState } from '../state/store';
import { isTopicStudied, markTopicStudied, studiedTopicIds, topicStudyFrom } from '../lib/study-status';
import { lessonForDay, lessonHeadline, lessonProgressLine, lessonTarget } from '../lib/telugu';
import { currentPlan, onTimePlan } from '../lib/plan';
import { addDaysISO, todayISO } from '../lib/dates';
import { liveFlashcardDue, flashcardTodayLine } from '../lib/due';
import {
  attemptDay,
  dayReviewIds,
  MOCK_KINDS,
  testedOn,
  WEEK_TEST_KINDS,
  type ReviewableAttempt,
} from '../lib/review-scope';
import {
  beginTask,
  CA_LIGHT_SIZE,
  CA_ROUNDUP_SIZE,
  CA_STARTER_SIZE,
  caSetSize,
  FORMULA_SHEET_KEY,
  fitMissed,
  freshFirst,
  isRowKeyDone,
  mainsKey,
  markRowKeyDone,
  missedTopics,
  START_HERE_KEY,
  WEAK_DRILL_SIZE,
  weakDrillIds,
  weakestStudied,
} from '../lib/day-tasks';
import type { WeakSubtopicInput } from '../lib/weak';
import { openLearn } from './learn';
import { openMainsQuestion } from './mains';
import { openPaperMock, openTestResults, openUnitTest, openWeekTest } from './mock';
import { weekTestNumber } from '../lib/test-number';
import { openScopedReview } from './notebook';
import { openReviseScope, openRevisionSession, weekMistakeIds } from './revise';
import { openTelugu, openTeluguLesson } from './telugu';
import { openEnglish } from './english';
import { howCurrentAffairsIsAsked } from './start';
import { mountQuiz } from './quiz';
import { el, mount, type Child } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';

/* -------------------------------------------------------------------------- */
/* Revise context (moved from today.ts; re-exported there)                      */
/* -------------------------------------------------------------------------- */

/**
 * The REVISE context for a day. Before ~10 curated cards are due for a scheduled
 * recall, the weekday Revise block becomes an EARLY-REVISE block scoped to what
 * the learner has ACTUALLY studied: `previous` (earlier days, newest first),
 * `today` (today's studied topics) or `waiting` (nothing studied yet). `none` =
 * not early (the block opens the whole studied-only daily deck).
 */
export interface ReviseCtx {
  early: boolean;
  mode: 'none' | 'previous' | 'today' | 'waiting';
  ids: string[];
  label: string;
  detail: string;
  mainTopicId?: string;
}

/** Names of `ids` as "A +N more". @internal */
export function namesLine(ids: readonly string[]): string {
  const names = ids.map((id) => getSubtopic(id)?.meta.name ?? id);
  if (names.length === 0) return '';
  return names.length > 1 ? `${names[0]} +${names.length - 1} more` : names[0]!;
}

/** The day's main topic: the first real topic of its subject block (else any block). @internal */
function mainTopicOf(day: PlanDay | undefined): string | undefined {
  if (!day) return undefined;
  const real = (b: PlanBlock): PlanTopic | undefined => (b.topics ?? []).find((t) => t.kind !== 'practice');
  const subject = day.blocks.find((b) => b.kind === 'subject' && real(b));
  return (subject ? real(subject) : day.blocks.map(real).find((t) => t !== undefined))?.subtopicId;
}

/** Build the revise context for `today` from the learner's STUDY STATUS. */
export function computeReviseCtx(today: string, day?: PlanDay): ReviseCtx {
  const EARLY_THRESHOLD = 10;
  const early = liveFlashcardDue().scheduled < EARLY_THRESHOLD;
  const mainTopicId = mainTopicOf(day);
  if (!early) return { early, mode: 'none', ids: [], label: '', detail: '', mainTopicId };

  const state = loadState();
  const studied = getSubtopics()
    .filter((s) => getCards(s.id).length > 0)
    .map((s) => ({ id: s.id, info: topicStudyFrom(state, s.id) }))
    .filter((x) => x.info.status === 'studied');

  const previous = studied
    .filter((x) => (x.info.studiedOn ?? '') < today)
    .sort((a, b) => (b.info.studiedOn ?? '').localeCompare(a.info.studiedOn ?? ''));
  if (previous.length > 0) {
    const ids = previous.map((x) => x.id);
    const newest = previous[0]!.info.studiedOn;
    const label = newest === addDaysISO(today, -1)
      ? 'Review yesterday\u2019s flashcards'
      : 'Review flashcards of what you studied';
    return { early, mode: 'previous', ids, label, detail: namesLine(ids), mainTopicId };
  }

  const todays = studied.filter((x) => x.info.studiedOn === today || x.info.studiedOn === undefined).map((x) => x.id);
  if (todays.length > 0) {
    const ids = mainTopicId && todays.includes(mainTopicId) ? [mainTopicId, ...todays.filter((id) => id !== mainTopicId)] : todays;
    return { early, mode: 'today', ids, label: 'Flashcards for today\u2019s topic', detail: namesLine(ids), mainTopicId };
  }

  const mainName = mainTopicId ? getSubtopic(mainTopicId)?.meta.name ?? mainTopicId : 'today\u2019s topic';
  return {
    early,
    mode: 'waiting',
    ids: [],
    label: 'Flashcards for today\u2019s topic \u2014 after you mark it studied',
    detail: `Cards only come from topics you have studied. Mark ${mainName} studied and its flashcards open here.`,
    mainTopicId,
  };
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

/** What finishes a row (and so which tick it carries). */
export type RowTask =
  | 'topic' // Mark as studied
  | 'missed' // a missed topic on the catch-up block — Mark as studied
  | 'revisit' // a revision-cycle revisit — Mark revised
  | 'practice' // a Mental Ability practice set — submit
  | 'ca' // a CA set — submit
  | 'light-ca' // a light-day CA set — submit
  | 'start-here' // I've read this
  | 'flashcards' // the flashcard session ends
  | 'test' // submitted
  | 'review' // the review list is cleared
  | 'telugu' // the lesson pass
  | 'mains' // I've written it
  | 'formula' // the formula sheet — I've read it
  | 'weak' // the weakest-area drill — submit
  | 'language' // post-Prelims Telugu / English block — Mark done
  | 'flag'; // anything else — Mark done

/** One checklist ROW of a day. */
export interface DayRow {
  block: PlanBlock;
  /** Index of the block in its day (keys are per block). */
  blockIndex: number;
  task: RowTask;
  /** The `blocksDone` key for key-finished rows. */
  key: string;
  /** The topic this row teaches / revisits (topic, missed, revisit, CA first pass). */
  topic?: PlanTopic;
  /** Minutes for split rows (else the block's / topic's). */
  minutes?: number;
  /** For a missed topic: the day it was due on the on-time plan. */
  dueISO?: string;
  /** For a weak row on the catch-up block with nothing missed. */
  nothingMissed?: boolean;
  /** The catch-up block's revision row (this week's topics), N10. */
  weekRevision?: boolean;
  /** For split light-day rows: which CA bank the set uses. */
  caSubtopicId?: string;
  /** For language rows. */
  language?: 'telugu' | 'english' | 'essay';
}

/** A synthetic topic for a missed id (from the on-time plan when possible). @internal */
function topicFor(id: string): PlanTopic {
  for (const d of onTimePlan().days) {
    const t = d.topics.find((x) => x.subtopicId === id);
    if (t) return t;
  }
  const view = getSubtopic(id);
  return {
    subtopicId: id,
    name: view?.meta.name ?? id,
    track: 'theory',
    mcqCount: view?.mcqs.length ?? 0,
    pass: 'full',
    estMinutes: 30,
    kind: 'topic',
  } as PlanTopic;
}

/**
 * The catch-up rows for `day`: the ACTUAL missed first-pass topics (on-time
 * plan days before today still unstudied, in sequence order) that fit the
 * block's minutes. A topic studied TODAY stays listed (ticked) so the row does
 * not vanish the moment it is done. Topics already on the day's rows are left
 * out. @internal
 */
export function catchupTopics(day: PlanDay, minutes: number, today: string = todayISO()): Array<{ topic: PlanTopic; dueISO: string }> {
  const state = loadState();
  const exclude = new Set<string>();
  for (const b of day.blocks) for (const t of b.topics ?? []) if (t.kind !== 'practice') exclude.add(t.subtopicId);
  const studiedBefore = (id: string): boolean => {
    const info = topicStudyFrom(state, id);
    return info.status === 'studied' && info.studiedOn !== today;
  };
  const days = onTimePlan().days.map((d) => ({
    dateISO: d.dateISO,
    theorySubtopicIds: d.theorySubtopicIds,
    aptitudeSubtopicIds: d.aptitudeSubtopicIds,
  }));
  const missed = missedTopics(days, state.settings.planStartDate, today, studiedBefore, exclude);
  const topics = new Map(missed.map((m) => [m.id, topicFor(m.id)] as const));
  return fitMissed(missed, minutes, (id) => topics.get(id)?.estMinutes ?? 30).map((m) => ({ topic: topics.get(m.id)!, dueISO: m.dueISO }));
}

/** Flatten a day's blocks into checklist rows. */
export function dayRows(day: PlanDay, today: string = todayISO()): DayRow[] {
  const out: DayRow[] = [];
  day.blocks.forEach((block, blockIndex) => {
    const base = `${block.kind}:${blockIndex}`;
    const row = (task: RowTask, extra: Partial<DayRow> = {}): DayRow => ({ block, blockIndex, task, key: base, ...extra });
    const topics = block.topics ?? [];
    switch (block.kind) {
      case 'catchup': {
        const missed = catchupTopics(day, block.minutes, today);
        if (missed.length === 0) {
          // N10: a 20-question drill is ~30–40 min, not the whole block; the
          // rest becomes an explicit revision row of this week's topics.
          const drillMin = Math.min(block.minutes, WEAK_DRILL_MINUTES);
          out.push(row('weak', { nothingMissed: true, minutes: drillMin }));
          const rest = block.minutes - drillMin;
          if (rest >= 15) out.push(row('flashcards', { key: `${base}:revise`, minutes: rest, weekRevision: true }));
        }
        else for (const m of missed) out.push(row('missed', { topic: m.topic, dueISO: m.dueISO, key: `missed:${m.topic.subtopicId}`, minutes: m.topic.estMinutes }));
        return;
      }
      case 'weakest-area':
        out.push(row('weak'));
        return;
      case 'light': {
        const examEve = !day.dayOff && /formula/i.test(block.label);
        const parts: Array<Partial<DayRow> & { task: RowTask }> = examEve
          ? [
              { task: 'formula', key: FORMULA_SHEET_KEY },
              { task: 'light-ca', key: 'light:ca', caSubtopicId: 'ca-regional' },
              { task: 'flashcards', key: 'light:flashcards' },
            ]
          : [
              { task: 'flashcards', key: 'light:flashcards' },
              { task: 'light-ca', key: 'light:ca', caSubtopicId: 'ca-regional' },
            ];
        const each = Math.max(5, Math.round(block.minutes / parts.length));
        for (const p of parts) out.push(row(p.task, { ...p, minutes: each }));
        return;
      }
      case 'ca':
      case 'ca-refresh':
      case 'ca-roundup':
        out.push(row('ca', topics[0] ? { topic: topics[0] } : {}));
        return;
      case 'start-here':
        out.push(row('start-here', { key: START_HERE_KEY }));
        return;
      case 'revise':
      case 'weekly-revision':
        out.push(row('flashcards'));
        return;
      case 'targeted-revision': {
        const real = topics.filter((t) => t.kind !== 'practice');
        if (real.length === 0) out.push(row('flashcards'));
        else for (const t of real) out.push(row('revisit', { topic: t, key: `revised:${t.subtopicId}`, minutes: t.estMinutes || block.minutes }));
        return;
      }
      case 'week-test':
      case 'unit-wrapup':
      case 'mock':
        out.push(row('test'));
        return;
      case 'mock-review':
      case 'week-test-review':
        out.push(row('review'));
        return;
      case 'telugu':
        out.push(row('telugu'));
        return;
      case 'mains-write':
        out.push(row('mains', block.mainsQuestionId ? { key: mainsKey(block.mainsQuestionId) } : {}));
        return;
      case 'ment-practice':
        out.push(row('practice', topics[0] ? { topic: topics[0] } : {}));
        return;
      default: {
        const real = topics.filter((t) => t.kind !== 'practice');
        if (real.length > 0) {
          for (const t of real) out.push(row('topic', { topic: t, minutes: t.estMinutes || block.minutes }));
        } else if (topics[0]?.kind === 'practice') {
          out.push(row('practice', { topic: topics[0] }));
        } else {
          out.push(row('flag'));
        }
      }
    }
  });
  return out;
}

/** The post-Prelims language / essay rows of a kick-start day (M9). */
export function languageRows(day: PlanDay | undefined): DayRow[] {
  if (!day) return [];
  const block: PlanBlock = { kind: 'telugu', label: 'Qualifying languages', minutes: 30 };
  const out: DayRow[] = [];
  if (day.languageBlock === 'telugu') out.push({ block, blockIndex: -1, task: 'language', key: 'lang:telugu', language: 'telugu', minutes: 30 });
  if (day.languageBlock === 'english') out.push({ block, blockIndex: -1, task: 'language', key: 'lang:english', language: 'english', minutes: 30 });
  if (day.essayPractice) {
    const essay = essayQuestionFor(day.dateISO);
    out.push({
      block: { kind: 'mains-write', label: 'General Essay', minutes: 60, ...(essay ? { mainsQuestionId: essay.id } : {}) },
      blockIndex: -1,
      task: 'language',
      key: essay ? mainsKey(essay.id) : 'lang:essay',
      language: 'essay',
      minutes: 60,
    });
  }
  return out;
}

/** The Paper-I (General Essay) question for a day, rotating through the bank. @internal */
function essayQuestionFor(dateISO: string): MainsItem | undefined {
  const items = getBanks('mains').flatMap((b) => (b.bank.kind === 'mains' ? b.bank.items : [])).filter((m) => m.paper === 'mains-1');
  if (items.length === 0) return undefined;
  const n = Math.abs(Math.floor(Date.parse(`${dateISO}T00:00:00Z`) / 86_400_000));
  return items[n % items.length];
}

/** Finished tests of `kinds` on `dateISO`. @internal */
function attemptsOn(dateISO: string, kinds: readonly string[]): ReviewableAttempt[] {
  return (loadState().testAttempts as ReviewableAttempt[]).filter((a) => attemptDay(a) === dateISO && kinds.includes(a.kind));
}

/** Runner kinds that finish a test row. @internal */
function testKinds(block: PlanBlock): readonly string[] {
  if (block.kind === 'week-test') return ['week-test'];
  if (block.kind === 'unit-wrapup') return ['unit-test'];
  return MOCK_KINDS;
}

/** Whether a row is FINISHED on `dateISO`. */
export function rowDone(row: DayRow, dateISO: string): boolean {
  switch (row.task) {
    case 'topic':
    case 'missed':
      return row.topic !== undefined && isTopicStudied(row.topic.subtopicId);
    case 'telugu':
      return lessonForDay(getTeluguLessonsDone(), dateISO).doneToday;
    case 'test':
      return attemptsOn(dateISO, testKinds(row.block)).length > 0;
    case 'review': {
      if (isRowKeyDone(dateISO, row.key)) return true;
      // Nothing wrong or guessed in the day's test → nothing to clear.
      const kinds = row.block.kind === 'mock-review' ? MOCK_KINDS : WEEK_TEST_KINDS;
      const attempts = loadState().testAttempts as ReviewableAttempt[];
      return testedOn(attempts, dateISO, kinds) && dayReviewIds(attempts, dateISO, kinds).length === 0;
    }
    case 'language':
      if (row.language === 'telugu' && lessonForDay(getTeluguLessonsDone(), dateISO).doneToday) return true;
      return isRowKeyDone(dateISO, row.key);
    default:
      return isRowKeyDone(dateISO, row.key);
  }
}

/** Whether the row's tick can be toggled by hand (else it is a status box). */
export function rowManual(row: DayRow): boolean {
  return row.task !== 'test' && row.task !== 'telugu' && row.task !== 'review';
}

/** Toggle a row's tick by hand. */
export function toggleRow(row: DayRow, dateISO: string): void {
  const done = rowDone(row, dateISO);
  if ((row.task === 'topic' || row.task === 'missed') && row.topic) {
    markTopicStudied(row.topic.subtopicId, !done, dateISO);
    return;
  }
  markRowKeyDone(dateISO, row.key, !done);
}

/* -------------------------------------------------------------------------- */
/* Row view: label, amount, destination                                         */
/* -------------------------------------------------------------------------- */

/** What a row shows + does. */
export interface RowView {
  label: string;
  /** Hero title. */
  title: string;
  /** Hero context line. */
  context: string;
  /** The amount / what to do. */
  detail: string;
  minutes: number;
  onClick: () => void;
  hint: string;
  /** Tick text once done. */
  doneText: string;
  /** Tick action label (accessible name stem). */
  tickVerb: string;
}

/** The short unit name (before the em-dash). */
export function unitShortTitle(title: string): string {
  const i = title.indexOf('\u2014');
  return (i > 0 ? title.slice(0, i) : title).trim();
}

/** A topic's display name. @internal */
function topicName(t: PlanTopic): string {
  return t.name || getSubtopic(t.subtopicId)?.meta.name || t.subtopicId;
}

/** A CA bank's display name. @internal */
function caBankName(id: string | undefined): string {
  return (id && getSubtopic(id)?.meta.name) || 'Current affairs';
}

/** Format minutes as `1 h 20 m` / `50 m`. */
export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

/** The score line of the latest finished test of the row (done rows). @internal */
function testScoreLine(row: DayRow, dateISO: string): string {
  const a = attemptsOn(dateISO, testKinds(row.block)).at(-1);
  if (!a) return '';
  const net = Math.round(a.net * 100) / 100;
  return `Score ${net} net \u00b7 ${a.correct}/${a.total} correct`;
}

/** The CA set a CA row runs (ids + title + lead). @internal */
function caSetFor(row: DayRow, dateISO: string): { title: string; lead: string; ids: string[]; notesId?: string; intro?: HTMLElement } {
  const progress = loadState().progress;
  const block = row.block;
  if (row.task === 'light-ca') {
    const sid = row.caSubtopicId ?? 'ca-regional';
    return {
      title: `Current affairs set \u2014 ${CA_LIGHT_SIZE} questions`,
      lead: `${CA_LIGHT_SIZE} questions from ${caBankName(sid)}. Skim its notes if a fact is new.`,
      ids: freshFirst(mcqIdsOf(sid), progress, CA_LIGHT_SIZE),
      notesId: sid,
    };
  }
  if (block.kind === 'ca-roundup') {
    const banks = weekCaIds(dateISO, block.caSubtopicId);
    const lists = banks.map((id) => freshFirst(mcqIdsOf(id), progress, CA_ROUNDUP_SIZE));
    const ids: string[] = [];
    for (let i = 0; ids.length < CA_ROUNDUP_SIZE && lists.some((l) => i < l.length); i += 1) {
      for (const l of lists) if (l[i] !== undefined && ids.length < CA_ROUNDUP_SIZE) ids.push(l[i]!);
    }
    return {
      title: `Weekly current-affairs round-up \u2014 ${ids.length} questions`,
      lead: `A mixed ${ids.length}-question set from this week\u2019s current affairs: ${banks.map(caBankName).join(', ')}.`,
      ids,
    };
  }
  const sid = block.caSubtopicId ?? 'ca-regional';
  if (block.caIntro) {
    return {
      title: `How current affairs is asked \u2014 then ${CA_STARTER_SIZE} starter questions`,
      lead: `Read how CA is asked, then a ${CA_STARTER_SIZE}-question starter set from ${caBankName(sid)}.`,
      ids: freshFirst(mcqIdsOf(sid), progress, CA_STARTER_SIZE),
      notesId: sid,
      intro: howCurrentAffairsIsAsked(),
    };
  }
  const n = caSetSize(block.minutes);
  return {
    title: `${caBankName(sid)} \u2014 ${n} questions`,
    lead: `Today\u2019s CA set: ${n} questions from ${caBankName(sid)}. Skim its notes if a fact is new, then do the set.`,
    ids: freshFirst(mcqIdsOf(sid), progress, n),
    notesId: sid,
  };
}

/** The CA banks of the week ending `dateISO` (plan CA blocks), else every CA bank. @internal */
function weekCaIds(dateISO: string, own?: string): string[] {
  const from = addDaysISO(dateISO, -6);
  const ids = new Set<string>();
  for (const d of currentPlan().days) {
    if (d.dateISO < from || d.dateISO > dateISO) continue;
    for (const b of d.blocks) if ((b.kind === 'ca' || b.kind === 'ca-refresh') && b.caSubtopicId) ids.add(b.caSubtopicId);
  }
  if (own) ids.add(own);
  if (ids.size < 2) for (const s of getSubtopics('CA')) ids.add(s.id);
  return [...ids].filter((id) => mcqIdsOf(id).length > 0);
}

/** Authored MCQ ids of a subtopic. @internal */
function mcqIdsOf(id: string): string[] {
  return getSubtopic(id)?.mcqs.map((m) => m.id) ?? [];
}

/** Minutes a weakest-area drill takes (20 Q ≈ 30–40 min), N10. */
export const WEAK_DRILL_MINUTES = 35;

/** Topics studied on a day in `[fromISO, toISO]` (inclusive). @internal */
function topicsStudiedSince(fromISO: string, toISO: string): string[] {
  const state = loadState();
  const out: string[] = [];
  for (const s of getSubjects()) {
    for (const meta of getSubtopics(s.code)) {
      const info = topicStudyFrom(state, meta.id);
      if (info.status === 'studied' && info.studiedOn !== undefined && info.studiedOn >= fromISO && info.studiedOn <= toISO) out.push(meta.id);
    }
  }
  return out;
}

/** Weak-area ranking inputs. @internal */
function weakInputs(): WeakSubtopicInput[] {
  return getSubjects().flatMap((s) =>
    getSubtopics(s.code).map((meta) => ({
      subtopicId: meta.id,
      name: meta.name,
      band: meta.band,
      mcqIds: mcqIdsOf(meta.id),
    })),
  );
}

/** The weakest-area drill for a day: topics named, or today's topics. */
export function weakDrillFor(day: PlanDay | undefined): { names: string[]; ids: string[]; fromWeak: boolean } {
  const state = loadState();
  const rows = weakestStudied(weakInputs(), state.progress, isTopicStudied);
  if (rows.length > 0) {
    return { names: rows.map((r) => r.name), ids: weakDrillIds(rows, mcqIdsOf, WEAK_DRILL_SIZE), fromWeak: true };
  }
  const todays = (day?.blocks ?? []).flatMap((b) => (b.topics ?? []).filter((t) => t.kind !== 'practice').map((t) => t.subtopicId));
  const pool = [...new Set(todays)].flatMap(mcqIdsOf);
  return { names: [...new Set(todays)].map((id) => getSubtopic(id)?.meta.name ?? id), ids: freshFirst(pool, state.progress, WEAK_DRILL_SIZE), fromWeak: false };
}

/** Context a row view needs. */
export interface RowCtx {
  reviseCtx: ReviseCtx;
  /** The row's day (keys are written against it). */
  day: PlanDay;
}

/** Resolve a row's labels, amount and destination. */
export function rowView(row: DayRow, ctx: RowCtx): RowView {
  const { block, topic } = row;
  const dateISO = ctx.day.dateISO;
  const minutes = row.minutes ?? (topic?.estMinutes || block.minutes);
  const base = { minutes, context: block.label, doneText: 'Done \u2713', tickVerb: 'Mark done' };
  switch (row.task) {
    case 'topic':
    case 'missed': {
      const t = topic!;
      const name = topicName(t);
      const mains = t.mainsAngle ? ' \u00b7 incl. For Mains note (+5 min)' : '';
      const detail = row.task === 'missed'
        ? `Catch up \u00b7 missed from ${prettyDowDate(row.dueISO ?? dateISO)} \u00b7 notes + practice`
        : `${unitShortTitle(block.label)}${mains} \u00b7 notes + practice`;
      return {
        ...base,
        label: name,
        title: name,
        context: row.task === 'missed' ? 'Catch up on missed items' : block.label,
        detail,
        onClick: () => openLearn(t.subtopicId),
        hint: 'Read the notes, do the practice, then tap Mark as studied',
        doneText: 'Studied \u2713',
        tickVerb: 'Mark as studied',
      };
    }
    case 'revisit': {
      const t = topic!;
      const name = topicName(t);
      return {
        ...base,
        label: `Revise ${name}`,
        title: `Revise ${name}`,
        detail: `Re-read the notes${t.mainsAngle ? ' + the For Mains note' : ''}, then redo the practice`,
        onClick: () => openLearn(t.subtopicId, { tab: 'notes' }),
        hint: 'Re-read the notes, redo the practice, then tap Mark revised.',
        doneText: 'Revised \u2713',
        tickVerb: 'Mark revised',
      };
    }
    case 'practice': {
      const ids = topic?.practiceSubtopicIds ?? block.practiceSubtopicIds ?? [];
      const q = topic && topic.mcqCount > 0 ? Math.min(topic.mcqCount, 20) : 20;
      const studied = studiedTopicIds(ids);
      return {
        ...base,
        label: 'Mental Ability practice set',
        title: 'Mental Ability practice set',
        detail: studied.length > 0 ? `${q} questions from ${namesLine(studied)}` : 'Study a Mental Ability topic first',
        onClick: () => startPracticeDrill(ids, q, { key: row.key, dateISO }),
        hint: `${q} mixed questions from Mental Ability topics you have studied. Done when you finish the set.`,
      };
    }
    case 'ca':
    case 'light-ca': {
      const set = caSetFor(row, dateISO);
      const label = row.task === 'light-ca' ? 'Current affairs \u2014 key facts set' : block.label;
      return {
        ...base,
        label,
        title: label,
        detail: set.lead,
        onClick: () => runSet({ ...set, key: row.key, dateISO, studyTopicId: topic?.subtopicId }),
        hint: set.lead,
      };
    }
    case 'start-here':
      return {
        ...base,
        label: block.label,
        title: 'Start here',
        detail: 'Read the guide, then tap \u201cI\u2019ve read this\u201d at the end',
        onClick: () => navigate('/start'),
        hint: 'How the exam and this app work \u2014 tap \u201cI\u2019ve read this\u201d at the end.',
      };
    case 'flashcards':
      return flashcardsView(row, ctx, base);
    case 'test': {
      const v = testView(row, dateISO, base);
      return rowDone(row, dateISO) ? { ...v, hint: 'Submitted \u2014 tap to see your results and review every answer. Retake is on the results page.' } : v;
    }
    case 'review': {
      const mock = block.kind === 'mock-review';
      const kinds = mock ? MOCK_KINDS : WEEK_TEST_KINDS;
      const attempts = loadState().testAttempts as ReviewableAttempt[];
      const n = dayReviewIds(attempts, dateISO, kinds).length;
      return {
        ...base,
        label: block.label,
        title: mock ? 'Review the mock' : 'Review the week test',
        detail: testedOn(attempts, dateISO, kinds)
          ? `${n} wrong or guessed answer${n === 1 ? '' : 's'} to clear`
          : `Opens after the ${mock ? 'mock' : 'week test'} \u2014 its wrong + guessed answers`,
        onClick: () => {
          beginTask(row.key, 'review', dateISO);
          openTestReview(kinds, mock ? 'mock' : 'week test', dateISO);
        },
        hint: 'Work through every wrong and guessed answer. Done when the list is cleared.',
      };
    }
    case 'telugu':
      return teluguView(row, dateISO, base);
    case 'mains': {
      const qid = block.mainsQuestionId;
      const q = qid ? mainsItem(qid) : undefined;
      return {
        ...base,
        label: block.label,
        title: 'Write one Mains answer',
        detail: q ? truncate(q.question, 90) : 'One answer on a topic you have studied',
        onClick: () => (qid ? openMainsQuestion(qid) : navigate('/mains')),
        hint: 'Write it by hand in 25 minutes, then tap \u201cI\u2019ve written it\u201d.',
        doneText: 'Written \u2713',
      };
    }
    case 'formula':
      return {
        ...base,
        label: 'Mental Ability formula sheet',
        title: 'Mental Ability formula sheet',
        detail: 'One printable page of every formula \u2014 read it once, calmly',
        onClick: () => navigate('/formula-sheet'),
        hint: 'Read (or print) the sheet, then tap \u201cI\u2019ve read it\u201d.',
      };
    case 'weak': {
      const drill = weakDrillFor(ctx.day);
      const label = row.nothingMissed
        ? 'Nothing to catch up \u2014 use this time for weak areas'
        : drill.fromWeak ? 'Weakest-area drill' : 'Practise today\u2019s topics';
      const detail = drill.fromWeak
        ? `${drill.ids.length} questions from your 3 weakest topics: ${drill.names.join(', ')}`
        : drill.ids.length > 0
          ? `${drill.ids.length} questions from today\u2019s topics: ${drill.names.join(', ')}`
          : 'Practise today\u2019s topics';
      return {
        ...base,
        label,
        title: label,
        detail,
        onClick: () =>
          drill.ids.length > 0
            ? runSet({ title: label, lead: detail, ids: drill.ids, key: row.key, dateISO })
            : navigate('/practice'),
        hint: detail,
      };
    }
    case 'language': {
      if (row.language === 'essay') {
        const qid = block.mainsQuestionId;
        const q = qid ? mainsItem(qid) : undefined;
        return {
          ...base,
          label: 'General Essay \u2014 write one essay',
          title: 'General Essay',
          detail: q ? truncate(q.question, 90) : 'One essay',
          onClick: () => (qid ? openMainsQuestion(qid) : navigate('/mains')),
          hint: 'Plan for 10 minutes, write for 50, then tap \u201cI\u2019ve written it\u201d.',
          doneText: 'Written \u2713',
        };
      }
      const telugu = row.language === 'telugu';
      return {
        ...base,
        label: telugu ? 'Telugu (qualifying) \u2014 30 min' : 'English (qualifying) \u2014 30 min',
        title: telugu ? 'Telugu (qualifying)' : 'English (qualifying)',
        detail: telugu ? 'One lesson pass + a short composition' : 'One grammar set + a short writing task',
        onClick: () => (telugu ? openTelugu() : openEnglish()),
        hint: 'Qualifying paper: keep it steady, 30 minutes.',
      };
    }
    default:
      return {
        ...base,
        label: block.label,
        title: block.label,
        detail: blockDetail(block),
        onClick: () => navigate('/plan'),
        hint: blockDetail(block),
      };
  }
}

/** The flashcard rows (Revise, weekly revision, light-day flashcards). @internal */
function flashcardsView(row: DayRow, ctx: RowCtx, base: Pick<RowView, 'minutes' | 'context' | 'doneText' | 'tickVerb'>): RowView {
  const dateISO = ctx.day.dateISO;
  const rc = ctx.reviseCtx;
  const begin = (): void => beginTask(row.key, 'flashcards', dateISO);
  if (row.weekRevision) {
    const week = topicsStudiedSince(addDaysISO(dateISO, -6), dateISO);
    const detail = week.length > 0
      ? `Flashcards of this week\u2019s topics: ${namesLine(week)}`
      : 'Re-read the notes of the topics you studied most recently';
    return {
      ...base,
      label: 'Revision \u2014 this week\u2019s topics',
      title: 'Revision \u2014 this week\u2019s topics',
      detail,
      onClick: () => {
        begin();
        if (week.length > 0) openReviseScope(week);
        else navigate('/revise');
      },
      hint: 'Recall each answer before you peek. Done when the session ends.',
    };
  }
  const line = flashcardTodayLine(liveFlashcardDue());
  if (row.block.kind === 'revise' && rc.early) {
    const ids = rc.ids;
    const main = rc.mainTopicId;
    return {
      ...base,
      label: rc.label,
      title: rc.label,
      detail: rc.mode === 'waiting' ? rc.detail : `${rc.detail} \u00b7 done when the session ends`,
      onClick: rc.mode === 'waiting'
        ? () => (main ? openLearn(main) : navigate('/revise'))
        : () => {
            begin();
            openReviseScope(ids);
          },
      hint: rc.mode === 'waiting' ? rc.detail : 'Recall each answer before you peek.',
    };
  }
  const label = row.key === 'light:flashcards'
    ? 'Flashcards \u2014 due cards of topics you studied'
    : row.block.label;
  const withMistakes = row.key !== 'light:flashcards' && (row.block.kind === 'weekly-revision' || row.block.kind === 'revise');
  const mistakes = withMistakes ? weekMistakeIds().length : 0;
  return {
    ...base,
    label,
    title: label,
    detail: withMistakes
      ? `${line || 'Due cards of topics you have studied'} \u00b7 ${mistakes} mistake${mistakes === 1 ? '' : 's'} from this week \u00b7 done when both are done`
      : `${line || 'Due cards of topics you have studied'} \u00b7 done when the session ends`,
    onClick: () => {
      begin();
      // N15: the revision rows that promise mistakes open ONE session of due
      // flashcards + this week's mistakes; light-day rows are flashcards only.
      if (withMistakes) openRevisionSession(label);
      else navigate('/revise/flashcards');
    },
    hint: line || 'Recall each answer before you peek.',
  };
}

/** Test rows: week test / unit test / mock / dress rehearsal. @internal */
function testView(row: DayRow, dateISO: string, base: Pick<RowView, 'minutes' | 'context' | 'doneText' | 'tickVerb'>): RowView {
  const block = row.block;
  const done = rowDone(row, dateISO);
  const score = done ? testScoreLine(row, dateISO) : '';
  const doneText = 'Submitted \u2713';
  // A SUBMITTED test row opens that sitting's RESULTS (never a new attempt);
  // "Retake" is offered there as a separate secondary action.
  const last = done ? attemptsOn(dateISO, testKinds(block)).at(-1) : undefined;
  const openOr = (start: () => void): (() => void) =>
    last ? () => openTestResults(last.at, start) : start;
  if (block.kind === 'unit-wrapup') {
    const ids = block.unitTestSubtopicIds ?? [];
    const left = ids.filter((id) => !isTopicStudied(id));
    const unit = unitShortTitle(block.unitTitle ?? block.label.replace(/^Unit wrap-up \u00b7 /, ''));
    if (left.length > 0 && !done) {
      const label = `Finish ${unit} first`;
      return {
        ...base,
        label,
        title: label,
        detail: `${left.length} ${left.length === 1 ? 'topic' : 'topics'} left: ${namesLine(left)}`,
        onClick: () => openLearn(left[0]!),
        hint: 'The unit test opens once every topic of the unit is studied.',
        doneText,
      };
    }
    const q = block.unitTestCount ?? 0;
    return {
      ...base,
      label: block.label,
      title: `Unit test \u00b7 ${unit}`,
      detail: score || (q > 0 ? `Recap + ${q}-question unit test` : 'Recap your finished unit'),
      onClick: openOr(() => openUnitTest({ ...block, unitTestSubtopicIds: studiedTopicIds(ids) })),
      hint: 'Timed, \u22121/3 for a wrong answer. Done when you submit.',
      doneText,
    };
  }
  if (block.kind === 'week-test') {
    // Numbered from the learner's OWN first week test (not the schedule's).
    const n = weekTestNumber(block.weekTestDateISO ?? dateISO, loadState().testAttempts as ReviewableAttempt[], loadState().settings.planStartDate);
    return {
      ...base,
      label: `Week test ${n}`,
      title: `Week test ${n}`,
      context: `${WEEK_TEST_COUNT} questions`,
      detail: score || `${WEEK_TEST_COUNT} questions \u00b7 ${WEEK_TEST_MINUTES} min \u00b7 from topics you studied`,
      onClick: openOr(() => openWeekTest(block)),
      hint: 'Timed, \u22121/3 for a wrong answer. Done when you submit.',
      doneText,
    };
  }
  const paper = block.mockPaper;
  const dress = block.label.includes('Dress rehearsal');
  const title = dress ? 'Dress rehearsal' : paper === 'paper1' ? 'Full Paper-I mock' : paper === 'paper2' ? 'Full Paper-II mock' : 'Full mock';
  return {
    ...base,
    label: block.label,
    title,
    detail: score || `${title} \u00b7 exam timing`,
    onClick: openOr(() => (paper ? openPaperMock(paper) : navigate('/practice/mock'))),
    hint: 'Exam conditions: one sitting, timed. Done when you submit.',
    doneText,
  };
}

/** The Telugu lesson row. @internal */
function teluguView(row: DayRow, dateISO: string, base: Pick<RowView, 'minutes' | 'context' | 'doneText' | 'tickVerb'>): RowView {
  const { lesson } = lessonForDay(getTeluguLessonsDone(), dateISO);
  if (lesson) {
    const id = lesson.id;
    return {
      ...base,
      label: lessonProgressLine(lesson),
      title: lessonHeadline(lesson),
      context: lessonProgressLine(lesson),
      detail: `${lessonHeadline(lesson)} \u00b7 ${lessonTarget(lesson)}`,
      onClick: () => openTeluguLesson(id),
      hint: `Target: ${lessonTarget(lesson)}`,
    };
  }
  return {
    ...base,
    label: row.block.label,
    title: 'Telugu practice',
    detail: 'All lessons done \u2014 trace words and sentences',
    onClick: () => openTelugu('words'),
    hint: 'Keep your hand in: trace a few words and sentences.',
  };
}

/** A plain-language detail line for an unusual block. @internal */
function blockDetail(block: PlanBlock): string {
  if (block.kind === 'subject' || block.kind === 'ment') return 'Study block';
  return block.label;
}

/* -------------------------------------------------------------------------- */
/* Destinations that run inside the view                                        */
/* -------------------------------------------------------------------------- */

/** The view mount. @internal */
function viewEl(): HTMLElement | null {
  return document.getElementById('view');
}

/** MCQ items by id across `ids`' subtopics (order of `ids`). @internal */
function itemsFor(ids: readonly string[]): MCQItem[] {
  const want = new Set(ids);
  const byId = new Map<string, MCQItem>();
  for (const s of getSubtopics()) {
    const view = getSubtopic(s.id);
    if (!view) continue;
    for (const m of view.mcqs) if (want.has(m.id)) byId.set(m.id, m as MCQItem);
  }
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/** A question set run from a Today row. */
export interface SetSpec {
  title: string;
  lead: string;
  ids: string[];
  key: string;
  dateISO: string;
  /** Optional notes to skim (Learn → Notes). */
  notesId?: string;
  /** Optional intro shown above the start button (D7). */
  intro?: HTMLElement;
  /** A first-pass topic the set also marks studied (CA first pass, C2). */
  studyTopicId?: string;
}

/**
 * Run a question SET for a row: a short brief (what, how many, the notes to
 * skim), then the quiz; finishing (or ending) it after ≥ 1 answer ticks the
 * row and shows "Set done" with the score and a way back to Today.
 */
export function runSet(spec: SetSpec): void {
  const route = setRoute(spec);
  setSpecs.set(route, spec);
  // A fresh tap on the row starts the set again (its last result is kept only
  // while the learner is away from the set page).
  if (!reconstructing) setResults.delete(route);
  // N11: every set has its OWN URL, so Back / Today / reload work and the
  // result survives navigation.
  const view = viewEl();
  if (!view) return;
  drawSet(view, route);
  // The set is drawn; give it its URL (no re-render) so Back returns to Today.
  if (normalizeHashPath(location.hash) !== route) pushUrl(route);
}

/** Specs of the sets opened this session, by route. @internal */
const setSpecs = new Map<string, SetSpec>();
/** Last result of each set route (results survive navigation). @internal */
const setResults = new Map<string, { correct: number; total: number }>();
/** True while a set route rebuilds its spec from the Today row. @internal */
let reconstructing = false;

/** `#/set/<kind>/<date>` for a set (kind = the row key, `:` → `~`). */
export function setRoute(spec: Pick<SetSpec, 'key' | 'dateISO'>): string {
  return `/set/${encodeURIComponent(spec.key.replace(/:/g, '~'))}/${spec.dateISO}`;
}

/** The path part of a hash (`#/a/b?x` → `/a/b`). @internal */
function normalizeHashPath(hash: string): string {
  const raw = hash.replace(/^#/, '') || '/';
  const q = raw.indexOf('?');
  return q >= 0 ? raw.slice(0, q) : raw;
}

/**
 * Route handler for `#/set/:kind/:date` (N11): draw the set (or its last
 * result). After a reload the spec is rebuilt from that day's Today row.
 */
export function renderSetRoute(root: HTMLElement): void {
  const route = normalizeHashPath(location.hash);
  if (!setSpecs.has(route)) {
    const m = /^\/set\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/.exec(route);
    if (m) {
      const kind = decodeURIComponent(m[1]!);
      const dateISO = m[2]!;
      const day = planDayFor(currentPlan(), dateISO) ?? planDayFor(onTimePlan(), dateISO);
      const row = day ? dayRows(day, dateISO).find((r) => r.key.replace(/:/g, '~') === kind) : undefined;
      if (day && row) {
        reconstructing = true;
        try {
          rowView(row, { reviseCtx: computeReviseCtx(dateISO, day), day }).onClick();
        } finally {
          reconstructing = false;
        }
        // The row may lead elsewhere (e.g. nothing studied yet) — done.
        if (normalizeHashPath(location.hash) !== route || setSpecs.has(route)) return;
      }
    }
    mount(root, card({ title: 'Practice set' }, [
      el('p', { class: 'section-lead', text: 'This set is no longer available \u2014 open it again from Today.' }),
      el('div', { class: 'hero-actions' }, [button({ label: 'Back to Today', variant: 'primary', onClick: () => navigate('/') })]),
    ]));
    return;
  }
  drawSet(root, route);
}

/** Draw a set's brief, or its last result, into `view`. @internal */
function drawSet(view: HTMLElement, route: string): void {
  const spec = setSpecs.get(route)!;
  const items = itemsFor(spec.ids);
  const back = button({ label: 'Back to Today', variant: 'ghost', onClick: () => navigate('/') });
  const showResult = (score: { correct: number; total: number }): void => {
    mount(view, card({ title: spec.title }, [
      el('div', { class: 'empty-state', attrs: { 'data-state': 'set-done' } }, [
        el('h3', { text: score.total > 0 ? 'Set done \u2713' : 'Set not started' }),
        el('p', { text: score.total > 0 ? `${score.correct} of ${score.total} correct.` : 'Answer at least one question to finish the set.' }),
        el('div', { class: 'hero-actions', attrs: { style: 'justify-content:center' } }, [
          button({ label: 'Back to Today', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/') }),
          button({
            label: 'Practise this set again',
            variant: 'ghost',
            onClick: () => {
              setResults.delete(route);
              drawSet(view, route);
            },
          }),
        ]),
      ]),
    ]));
  };
  const last = setResults.get(route);
  if (last) {
    showResult(last);
    return;
  }
  if (items.length === 0) {
    mount(view, card({ title: spec.title }, [
      el('p', { class: 'section-lead', text: 'No questions are available for this set yet.' }),
      el('div', { class: 'hero-actions' }, [back]),
    ]));
    return;
  }
  const start = (): void =>
    mountQuiz(view, items, (score) => {
      if (score.total > 0) {
        markRowKeyDone(spec.dateISO, spec.key, true);
        if (spec.studyTopicId && !isTopicStudied(spec.studyTopicId)) markTopicStudied(spec.studyTopicId, true, spec.dateISO);
      }
      const result = { correct: score.correct, total: score.total };
      setResults.set(route, result);
      showResult(result);
    }, { allowEndSession: true });
  const kids: Child[] = [];
  if (spec.intro) kids.push(spec.intro);
  kids.push(card({ title: spec.title, subtitle: `${items.length} questions` }, [
    el('p', { class: 'section-lead', text: spec.lead }),
    el('div', { class: 'hero-actions' }, [
      button({ label: `Start the ${items.length}-question set`, variant: 'primary', iconName: 'arrow-right', onClick: start }),
      spec.notesId ? button({ label: 'Skim the notes', variant: 'secondary', onClick: () => openLearn(spec.notesId!, { tab: 'notes' }) }) : null,
      back,
    ]),
  ]));
  mount(view, ...kids);
}

/**
 * Launch a mixed Mental Ability practice drill over the STUDIED topics among
 * `subtopicIds`, sized to `questions`. With `track`, finishing the set ticks
 * that row. With none studied, points at the first unstudied MA topic.
 */
export function startPracticeDrill(
  subtopicIds: readonly string[],
  questions: number,
  track?: { key: string; dateISO: string },
): void {
  const view = viewEl();
  if (!view) return;
  const studied = subtopicIds.filter((id) => isTopicStudied(id));
  if (studied.length === 0) {
    const firstMent = getSubtopics('MENT').find((s) => !isTopicStudied(s.id))?.id;
    mount(
      view,
      card({ title: 'Mental Ability practice' }, [
        el('p', { class: 'section-lead', text: 'Do today\u2019s Mental Ability topic first \u2014 practice sets only use topics you have studied.' }),
        el('div', { class: 'hero-actions' }, [
          firstMent ? button({ label: 'Open the topic', variant: 'primary', iconName: 'arrow-right', onClick: () => openLearn(firstMent) }) : null,
          button({ label: 'Back to Today', variant: 'ghost', onClick: () => navigate('/') }),
        ]),
      ]),
    );
    return;
  }
  const pool = studied.flatMap(mcqIdsOf);
  if (pool.length === 0) {
    navigate('/practice');
    return;
  }
  const ids = freshFirst(pool, loadState().progress, questions);
  runSet({
    title: 'Mental Ability practice set',
    lead: `${ids.length} questions from ${namesLine(studied)}.`,
    ids,
    key: track?.key ?? 'ment-practice:adhoc',
    dateISO: track?.dateISO ?? todayISO(),
  });
}

/**
 * Open the scoped review list for a review block: the wrong + guessed answers
 * of `dateISO`'s tests of `kinds`, else the most recent test day's list.
 */
export function openTestReview(kinds: readonly string[], what: string, dateISO: string = todayISO()): void {
  const attempts = loadState().testAttempts as ReviewableAttempt[];
  const days = attempts.filter((a) => kinds.includes(a.kind)).map(attemptDay);
  const day = days.includes(dateISO) ? dateISO : days.sort().at(-1);
  if (day === undefined) {
    openScopedReview([], `No ${what} taken yet`, `Sit the ${what} first \u2014 its wrong and guessed answers will be listed here.`);
    return;
  }
  const ids = dayReviewIds(attempts, day, kinds);
  const when = day === dateISO ? 'today\u2019s' : `the ${prettyDowDate(day)}`;
  openScopedReview(ids, `Review ${when} ${what}`, 'Every wrong answer plus every Guess / 50-50 answer \u2014 even the lucky correct ones.');
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

/** A Mains item by id. @internal */
function mainsItem(id: string): MainsItem | undefined {
  for (const b of getBanks('mains')) {
    if (b.bank.kind !== 'mains') continue;
    const m = b.bank.items.find((x) => x.id === id);
    if (m) return m;
  }
  return undefined;
}

/** Truncate with an ellipsis. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}\u2026`;
}

/** `Sat 10 Oct`. */
export function prettyDowDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (!y || !m || !d) return iso;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${dows[dow]} ${d} ${months[m - 1]}`;
}

/** A compact done chip. @internal */
export function doneChip(text: string): HTMLElement {
  return chip({ text, tone: 'ok' });
}
