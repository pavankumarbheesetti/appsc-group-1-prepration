/**
 * DAY TASKS — what finishes each of Today's rows, and the pure helpers behind
 * the catch-up / weakest-area / admin rows (FLOW-QA D5–D10, D17/D18; LOGIC-AUDIT
 * H1, H4, M1, L5).
 *
 * Topic rows finish through the study status ("Mark as studied"); tests finish
 * through the finished-test history; the Telugu lesson through its lesson
 * record. Every OTHER row (revise, CA set, review list, weak-area drill, Mains
 * answer, Start-here guide, light-day items …) finishes by a per-day KEY in
 * `state.blocksDone` (see {@link setBlockDone}).
 *
 * Some sessions run in another view (the flashcard runner, the scoped review
 * list). Today starts them with {@link beginTask}; that view calls
 * {@link completeActiveTask} when its session ends, which ticks the row that
 * launched it. Everything else here is PURE.
 */
import { isBlockDone, isBlockDoneEver, setBlockDone } from '../state/store';
import type { ProgressEntry } from '../state/store';
import { addDaysISO, todayISO } from './dates';
import { rankWeakAreas, type WeakRow, type WeakSubtopicInput } from './weak';

/* -------------------------------------------------------------------------- */
/* Row keys                                                                    */
/* -------------------------------------------------------------------------- */

/** The one-off Start-here guide (done once, on any day). */
export const START_HERE_KEY = 'start-here';
/** The light-day Mental Ability formula sheet. */
export const FORMULA_SHEET_KEY = 'light:formula';
/** The key of a Mains answer-writing row for question `id`. */
export function mainsKey(id: string): string {
  return `mains:${id}`;
}

/** Which out-of-Today session a row is waiting on. */
export type TaskSession = 'flashcards' | 'review';

/** The row whose session is running in another view. @internal */
interface ActiveTask {
  dateISO: string;
  key: string;
  session: TaskSession;
}
/** sessionStorage key: the running row task survives a reload of the tab. @internal */
const ACTIVE_KEY = 'appsc-g1-active-task';
let active: ActiveTask | null = null;

/** Persist (or clear) the running task for this tab. @internal */
function persist(task: ActiveTask | null): void {
  active = task;
  try {
    if (task) sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(task));
    else sessionStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* storage unavailable — in-memory only */
  }
}

/** The running task: in memory, else restored from this tab's sessionStorage. @internal */
function current(): ActiveTask | null {
  if (active) return active;
  try {
    const raw = sessionStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as Partial<ActiveTask>;
    if (typeof t.dateISO === 'string' && typeof t.key === 'string' && (t.session === 'flashcards' || t.session === 'review')) {
      active = { dateISO: t.dateISO, key: t.key, session: t.session };
    }
  } catch {
    /* ignore */
  }
  return active;
}

/** Remember that Today's row `key` (of `dateISO`) has started a `session`. */
export function beginTask(key: string, session: TaskSession, dateISO: string = todayISO()): void {
  persist({ dateISO, key, session });
}

/** The currently running row task, if any (tests / diagnostics). */
export function activeTask(): Readonly<ActiveTask> | null {
  return current();
}

/** Forget the running row task. */
export function clearActiveTask(): void {
  persist(null);
}

/**
 * A `session` ended in its own view: tick the Today row that launched it (if
 * one did, for the same kind of session). Returns whether a row was ticked.
 */
export function completeActiveTask(session: TaskSession): boolean {
  const task = current();
  if (!task || task.session !== session) return false;
  setBlockDone(task.dateISO, task.key, true);
  persist(null);
  return true;
}

/** Whether row `key` is finished on `dateISO`. */
export function isRowKeyDone(dateISO: string, key: string): boolean {
  return key === START_HERE_KEY ? isBlockDoneEver(key) : isBlockDone(dateISO, key);
}

/** Mark row `key` finished (or not) on `dateISO`. */
export function markRowKeyDone(dateISO: string, key: string, done = true): void {
  setBlockDone(dateISO, key, done);
}

/* -------------------------------------------------------------------------- */
/* Catch-up: the real missed first-pass topics (H4)                            */
/* -------------------------------------------------------------------------- */

/** The slice of a plan day the missed-topic scan needs. */
export interface FirstPassDay {
  dateISO: string;
  theorySubtopicIds: readonly string[];
  aptitudeSubtopicIds: readonly string[];
}

/** One missed first-pass topic and the on-time day it was due. */
export interface MissedTopic {
  id: string;
  dueISO: string;
}

/**
 * The MISSED topics: first-pass topics the ON-TIME plan (`days`, built from the
 * plan start) scheduled on days in `[startISO, todayISO)` that are still not
 * studied, in plan (= learning-sequence) order, minus `exclude` (topics already
 * on today's rows). PURE.
 */
export function missedTopics(
  days: readonly FirstPassDay[],
  startISO: string,
  today: string,
  isStudied: (id: string) => boolean,
  exclude: ReadonlySet<string> = new Set(),
): MissedTopic[] {
  const seen = new Set<string>();
  const out: MissedTopic[] = [];
  const ordered = [...days].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  for (const d of ordered) {
    if (d.dateISO < startISO || d.dateISO >= today) continue;
    for (const id of [...d.theorySubtopicIds, ...d.aptitudeSubtopicIds]) {
      if (seen.has(id) || exclude.has(id) || isStudied(id)) continue;
      seen.add(id);
      out.push({ id, dueISO: d.dateISO });
    }
  }
  return out;
}

/**
 * Take missed topics in order while they fit `minutes` (each costs
 * `minutesOf(id)`, at least one is always taken), capped at `max`. PURE.
 */
export function fitMissed(
  missed: readonly MissedTopic[],
  minutes: number,
  minutesOf: (id: string) => number,
  max = 6,
): MissedTopic[] {
  const out: MissedTopic[] = [];
  let used = 0;
  for (const m of missed) {
    if (out.length >= max) break;
    const cost = Math.max(1, minutesOf(m.id));
    if (out.length > 0 && used + cost > minutes) break;
    out.push(m);
    used += cost;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Weakest area (H4)                                                           */
/* -------------------------------------------------------------------------- */

/** Questions in a weakest-area drill. */
export const WEAK_DRILL_SIZE = 20;
/** Topics a weakest-area drill draws from. */
export const WEAK_DRILL_TOPICS = 3;

/**
 * The `n` STUDIED topics with the LOWEST accuracy (via {@link rankWeakAreas};
 * only attempted topics rank). Empty when nothing studied was attempted. PURE.
 */
export function weakestStudied(
  inputs: readonly WeakSubtopicInput[],
  progress: Readonly<Record<string, ProgressEntry>>,
  isStudied: (id: string) => boolean,
  n = WEAK_DRILL_TOPICS,
): WeakRow[] {
  return rankWeakAreas(inputs.filter((i) => isStudied(i.subtopicId)), progress).weak.slice(0, n);
}

/**
 * The question ids of a weak-area drill over `rows`: every topic's weak
 * (wrong / shaky) questions first, round-robin across the topics, then the
 * rest of their questions, capped at `size`. PURE.
 */
export function weakDrillIds(
  rows: readonly Pick<WeakRow, 'subtopicId' | 'wrongQuestionIds'>[],
  mcqIdsOf: (subtopicId: string) => readonly string[],
  size = WEAK_DRILL_SIZE,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const roundRobin = (lists: readonly (readonly string[])[]): void => {
    const longest = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < longest && out.length < size; i += 1) {
      for (const list of lists) {
        const id = list[i];
        if (id === undefined || seen.has(id) || out.length >= size) continue;
        seen.add(id);
        out.push(id);
      }
    }
  };
  roundRobin(rows.map((r) => r.wrongQuestionIds));
  roundRobin(rows.map((r) => mcqIdsOf(r.subtopicId)));
  return out;
}

/* -------------------------------------------------------------------------- */
/* Admin cards + exam day (D17/D18)                                            */
/* -------------------------------------------------------------------------- */

/** Application deadline (Notification 07/2026: 27/10/2026, 11:59 PM). */
export const APPLY_DEADLINE_ISO = '2026-10-27';
/** Last day the "missed the deadline?" reminder shows. */
export const APPLY_MISSED_UNTIL_ISO = '2026-10-31';
/** The hall-ticket card shows from this many days before the exam. */
export const HALL_TICKET_LEAD_DAYS = 12;

/** Which admin card to show (and in which wording). */
export type AdminCardId = 'apply-online' | 'apply-missed' | 'hall-ticket' | 'exam-day';

/**
 * The admin cards to show on `today` (in order). PURE.
 *  - Apply online: until the 27 Oct deadline, unless done; then, still not
 *    done, a "Missed the deadline?" reminder until 31 Oct; then hidden.
 *  - Hall ticket: from exam − 12 days (12 Jan) until the day BEFORE the exam,
 *    unless done.
 *  - Exam-day checklist: on the light day (exam − 1), unless done.
 */
export function adminCardsFor(
  today: string,
  examISO: string,
  done: (id: string) => boolean,
  isLightDay: boolean,
): AdminCardId[] {
  const out: AdminCardId[] = [];
  if (!done('apply-online')) {
    if (today <= APPLY_DEADLINE_ISO) out.push('apply-online');
    else if (today <= APPLY_MISSED_UNTIL_ISO) out.push('apply-missed');
  }
  if (today >= addDaysISO(examISO, -HALL_TICKET_LEAD_DAYS) && today < examISO && !done('hall-ticket')) {
    out.push('hall-ticket');
  }
  if (isLightDay && today < examISO && !done('exam-day')) out.push('exam-day');
  return out;
}

/** Whether `today` is the Prelims day itself. PURE. */
export function isExamDay(today: string, examISO: string): boolean {
  return today === examISO;
}

/* -------------------------------------------------------------------------- */
/* Current-affairs set sizes (D7/D8)                                           */
/* -------------------------------------------------------------------------- */

/** The day-1 "How current affairs is asked" starter set. */
export const CA_STARTER_SIZE = 10;
/** The Sunday weekly round-up set. */
export const CA_ROUNDUP_SIZE = 25;
/** A light-day CA set. */
export const CA_LIGHT_SIZE = 10;

/** Questions in a daily CA set of `minutes` (≈ 2.5 min each, 5–20). PURE. */
export function caSetSize(minutes: number): number {
  return Math.min(20, Math.max(5, Math.round(minutes / 2.5)));
}

/**
 * Order a set's candidate question ids: never-answered first (in the given
 * order), then the rest; take `size`. PURE.
 */
export function freshFirst(
  ids: readonly string[],
  progress: Readonly<Record<string, ProgressEntry>>,
  size: number,
): string[] {
  const fresh = ids.filter((id) => !(progress[id]?.seen));
  const seen = ids.filter((id) => (progress[id]?.seen ?? 0) > 0);
  return [...fresh, ...seen].slice(0, size);
}
