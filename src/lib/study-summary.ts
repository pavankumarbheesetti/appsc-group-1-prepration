/**
 * Study-status ROLL-UPS for Syllabus / Progress — "Studied N of 117" and the
 * per-subject studied counts. Every count is derived from the SAME per-topic
 * status the planner, Today and Learn use ({@link topicStudyFrom} in
 * `study-status.ts`), so the pages can never disagree. Mastery / accuracy is a
 * separate number and is NOT folded in here.
 *
 * The denominator is the PRELIMS scope (paper1 + paper2 subtopics, mains-only
 * subjects excluded) — the same set the planner counts in `prelimsTotal`.
 */
import { planSubtopics } from './plan';
import { topicStudyFrom, type StudyStatus } from './study-status';
import type { AppState } from '../state/store';
import { getCaUpdatedThrough } from '../content/loader';

/** Studied / in-progress counts over a set of subtopics. */
export interface StudyCounts {
  total: number;
  studied: number;
  inProgress: number;
  notStarted: number;
}

/** The overall + per-subject study roll-up. */
export interface StudySummary extends StudyCounts {
  /** subjectCode → counts over that subject's in-scope subtopics. */
  bySubject: Record<string, StudyCounts>;
}

/** The in-scope (Prelims: paper1 + paper2) subtopic ids with their subject. */
export function prelimsScope(): Array<{ id: string; subjectCode: string }> {
  return planSubtopics()
    .filter((s) => s.track !== 'mains')
    .map((s) => ({ id: s.id, subjectCode: s.subjectCode }));
}

/** Fold one status into a counts record. @internal */
function add(c: StudyCounts, status: StudyStatus): void {
  c.total += 1;
  if (status === 'studied') c.studied += 1;
  else if (status === 'in-progress') c.inProgress += 1;
  else c.notStarted += 1;
}

const zero = (): StudyCounts => ({ total: 0, studied: 0, inProgress: 0, notStarted: 0 });

/**
 * Count studied / in-progress topics over `scope` (default: the Prelims scope)
 * from a state snapshot.
 */
export function studySummary(
  state: AppState,
  scope: ReadonlyArray<{ id: string; subjectCode: string }> = prelimsScope(),
): StudySummary {
  const overall: StudySummary = { ...zero(), bySubject: {} };
  for (const { id, subjectCode } of scope) {
    const status = topicStudyFrom(state, id).status;
    add(overall, status);
    const sub = (overall.bySubject[subjectCode] ??= zero());
    add(sub, status);
  }
  return overall;
}

/** "Studied 6 of 117" — the shared headline wording. */
export function studiedLine(c: Pick<StudyCounts, 'studied' | 'total'>): string {
  return `Studied ${c.studied} of ${c.total}`;
}

/** True when the learner has studied/started ANY topic (status, not answers). */
export function anyStudyActivity(state: AppState): boolean {
  return Object.values(state.study).some((e) => e.mark === 'studied' || e.notesOpened === true);
}

/** "Up to date through Oct 2026" — the CA banks' coverage (N18). */
export function caUpToDateLine(): string {
  const [y, m] = getCaUpdatedThrough().split('-').map(Number);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Up to date through ${MONTHS[(m ?? 1) - 1]} ${y}`;
}
