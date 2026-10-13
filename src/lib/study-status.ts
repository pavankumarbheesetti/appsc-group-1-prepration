/**
 * Per-SUBTOPIC study STATUS — the single answer to "has the learner covered this
 * topic?" used by the planner (days behind, recovery, coverage), Today (row
 * ticks, "Up now"), Revise (which curated cards are eligible) and Syllabus.
 *
 * Three states:
 *   - `not-started` — nothing done yet.
 *   - `in-progress` — the notes were opened or some practice was answered.
 *   - `studied`     — the learner tapped "Mark as studied", OR answered at least
 *                     {@link AUTO_STUDIED_ANSWERS} practice questions (or the whole
 *                     bank when it is smaller). "Mark as not studied" overrides
 *                     the automatic rule until the learner marks it studied again.
 *
 * Backward compatibility: older progress (questions answered, no study record)
 * derives `in-progress`, or `studied` once ≥ 10 were answered.
 *
 * {@link deriveStudyStatus} is PURE; the remaining helpers are thin selectors
 * over the store + loaded content (like `lib/plan.ts`).
 */
import { getSubtopic } from '../content/loader';
import {
  loadState,
  setTopicStudied,
  stampTopicStudiedOn,
  type AppState,
  type TopicStudyEntry,
} from '../state/store';
import { todayISO } from './dates';

/** The three study states of a subtopic. */
export type StudyStatus = 'not-started' | 'in-progress' | 'studied';

/** Answering this many practice questions marks a topic studied automatically. */
export const AUTO_STUDIED_ANSWERS = 10;

/**
 * How many answered questions make a topic auto-studied: {@link
 * AUTO_STUDIED_ANSWERS}, or the whole bank when it is smaller. A topic with no
 * questions can only be marked studied by hand (returns `Infinity`).
 */
export function autoStudiedThreshold(bankSize: number): number {
  return bankSize > 0 ? Math.min(AUTO_STUDIED_ANSWERS, bankSize) : Number.POSITIVE_INFINITY;
}

/**
 * Derive the status from the stored record + how many distinct questions of a
 * `bankSize`-question bank were answered. PURE.
 */
export function deriveStudyStatus(
  entry: TopicStudyEntry | undefined,
  answered: number,
  bankSize: number,
): StudyStatus {
  const started = answered > 0 || entry?.notesOpened === true;
  if (entry?.mark === 'studied') return 'studied';
  if (entry?.mark === 'not-studied') return started ? 'in-progress' : 'not-started';
  if (answered >= autoStudiedThreshold(bankSize)) return 'studied';
  return started ? 'in-progress' : 'not-started';
}

/** Distinct questions in `mcqIds` answered at least once. PURE. */
export function answeredCount(progress: AppState['progress'], mcqIds: readonly string[]): number {
  let n = 0;
  for (const id of mcqIds) if ((progress[id]?.seen ?? 0) > 0) n += 1;
  return n;
}

/** Everything a view needs about one subtopic's study state. */
export interface TopicStudyInfo {
  status: StudyStatus;
  /** Distinct practice questions answered. */
  answered: number;
  /** Practice questions authored for the topic. */
  bankSize: number;
  /** ISO date it became studied, when known. */
  studiedOn?: string;
  /** True when the studied state came from an explicit "Mark as studied". */
  manual: boolean;
}

/** The study info of subtopic `id` from a given state snapshot. */
export function topicStudyFrom(state: AppState, id: string): TopicStudyInfo {
  const ids = getSubtopic(id)?.mcqs.map((m) => m.id) ?? [];
  const answered = answeredCount(state.progress, ids);
  const entry = state.study[id];
  const status = deriveStudyStatus(entry, answered, ids.length);
  return {
    status,
    answered,
    bankSize: ids.length,
    studiedOn: status === 'studied' ? entry?.studiedOn : undefined,
    manual: entry?.mark === 'studied',
  };
}

/** The live study info of subtopic `id`. */
export function topicStudy(id: string): TopicStudyInfo {
  return topicStudyFrom(loadState(), id);
}

/** The live status of subtopic `id`. */
export function topicStatus(id: string): StudyStatus {
  return topicStudy(id).status;
}

/** Whether subtopic `id` is studied (the planner's / Today's "done"). */
export function isTopicStudied(id: string): boolean {
  return topicStatus(id) === 'studied';
}

/**
 * Whether subtopic `id`'s curated flashcards may be reviewed: the topic is
 * studied, or in progress with at least one practice question answered. Cards
 * of a never-studied topic are never due.
 */
export function isRevisable(id: string, state: AppState = loadState()): boolean {
  const info = topicStudyFrom(state, id);
  return info.status === 'studied' || (info.status === 'in-progress' && info.answered >= 1);
}

/** Mark subtopic `id` studied / not studied (explicit learner choice). */
export function markTopicStudied(id: string, studied: boolean, dateISO: string = todayISO()): void {
  setTopicStudied(id, studied, dateISO);
}

/**
 * After practice answers were recorded, stamp today's date on any of
 * `subtopicIds` that just crossed the automatic threshold (so early revision
 * knows WHEN it was studied). Cheap no-op otherwise.
 */
export function syncAutoStudied(subtopicIds: Iterable<string>, dateISO: string = todayISO()): void {
  for (const id of new Set(subtopicIds)) {
    const state = loadState();
    const entry = state.study[id];
    if (entry?.studiedOn || entry?.mark === 'not-studied') continue;
    if (topicStudyFrom(state, id).status === 'studied') stampTopicStudiedOn(id, dateISO);
  }
}
