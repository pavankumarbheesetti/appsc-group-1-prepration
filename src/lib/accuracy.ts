/**
 * ONE accuracy definition for the whole app: `correct ÷ answered` over EVERY
 * recorded attempt of a topic's questions (drills, tests, reviews — all
 * attempts). Learn header, Topics / Syllabus rows, Progress and the weak-area
 * ranking all read this, so "12/15 correct" can never show as 38% elsewhere.
 * Unanswered questions in the bank do NOT lower it (that is coverage, not
 * accuracy). PURE.
 */
import type { ProgressEntry } from '../state/store';

/** A topic's accuracy tally. */
export interface Accuracy {
  /** Correct attempts. */
  correct: number;
  /** All attempts (answers given; a re-answer counts again). */
  answered: number;
  /** Whole percent 0–100, or `null` when nothing has been answered. */
  pct: number | null;
}

/** Whole-percent `correct ÷ answered`, `null` when `answered` is 0. */
export function accuracyPct(correct: number, answered: number): number | null {
  if (answered <= 0) return null;
  return Math.round((Math.max(0, Math.min(correct, answered)) / answered) * 100);
}

/** The accuracy over the questions `ids`, from the progress map. */
export function topicAccuracy(
  progress: Readonly<Record<string, ProgressEntry>>,
  ids: readonly string[],
): Accuracy {
  let correct = 0;
  let answered = 0;
  for (const id of ids) {
    const p = progress[id];
    if (!p || p.seen <= 0) continue;
    answered += p.seen;
    correct += p.correct;
  }
  return { correct, answered, pct: accuracyPct(correct, answered) };
}

/** Display text: `80%`, or an em-dash when nothing is answered. */
export function formatAccuracy(a: Pick<Accuracy, 'pct'>): string {
  return a.pct === null ? '\u2014' : `${a.pct}%`;
}

/** Caption with the raw tally, e.g. `80% · 12/15`. */
export function accuracyCaption(a: Accuracy): string {
  return a.pct === null ? 'not answered yet' : `${a.pct}% \u00b7 ${a.correct}/${a.answered}`;
}

/** The label used everywhere for this number. */
export const ACCURACY_LABEL = 'Accuracy';
