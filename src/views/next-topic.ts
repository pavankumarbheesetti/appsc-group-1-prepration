/**
 * "What next?" — the step after finishing something (NAV spec §3.5).
 *
 * The next topic always comes from the planner's queue for TODAY — the same
 * rows Today's "Up now" walks ({@link dayRows} / {@link rowDone}). A topic row
 * is preferred; otherwise the next unfinished row of any kind; when every row
 * is done: `Today's plan done ✓ — Revise N cards`.
 */
import { planDayFor } from '../engine/planner';
import { currentPlan } from '../lib/plan';
import { todayISO } from '../lib/dates';
import { liveFlashcardDue } from '../lib/due';
import { navigate } from '../router/router';
import { computeReviseCtx, dayRows, fmtDuration, rowDone, rowView } from './today-tasks';
import { openLearn } from './learn';
import { PATHS } from './shell';

/** One "next" action. */
export interface NextStep {
  /** `topic` = another topic's notes; `row` = another Today row; `done` = the day is done. */
  kind: 'topic' | 'row' | 'done';
  /** Button label, e.g. `Next: Number System (1 h)`. */
  label: string;
  /** The topic name (topic steps only). */
  name?: string;
  /** The subtopic id (topic steps only). */
  subtopicId?: string;
  /** Go there. */
  go: () => void;
}

/**
 * The next step after `currentId` (a subtopic just practised / studied, if
 * any), from today's plan.
 */
export function nextStep(currentId?: string, now: Date = new Date()): NextStep {
  const today = todayISO(now);
  let day;
  try {
    day = planDayFor(currentPlan(now), today);
  } catch {
    day = undefined;
  }
  const rows = day ? dayRows(day, today) : [];
  const open = rows.filter((r) => !rowDone(r, today));
  const topicRow = open.find(
    (r) => (r.task === 'topic' || r.task === 'missed') && r.topic !== undefined && r.topic.subtopicId !== currentId,
  );
  if (topicRow?.topic) {
    const t = topicRow.topic;
    const minutes = topicRow.minutes ?? t.estMinutes;
    return {
      kind: 'topic',
      label: `Next: ${t.name}${minutes ? ` (${fmtDuration(minutes)})` : ''}`,
      name: t.name,
      subtopicId: t.subtopicId,
      go: () => openLearn(t.subtopicId, { tab: 'notes' }),
    };
  }
  const other = open.find((r) => !((r.task === 'topic' || r.task === 'missed') && r.topic?.subtopicId === currentId));
  if (other && day) {
    const view = rowView(other, { reviseCtx: computeReviseCtx(today, day), day });
    return { kind: 'row', label: `Next: ${view.title}`, go: view.onClick };
  }
  const due = liveFlashcardDue(now.getTime()).today;
  return due > 0
    ? { kind: 'done', label: `Today\u2019s plan done \u2713 \u2014 Revise ${due} card${due === 1 ? '' : 's'}`, go: () => navigate(PATHS.flashcards) }
    : { kind: 'done', label: 'Today\u2019s plan done \u2713 \u2014 back to Today', go: () => navigate(PATHS.today) };
}
