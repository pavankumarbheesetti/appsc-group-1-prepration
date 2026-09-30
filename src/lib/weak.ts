/**
 * Weak-area ranking — PURE derivation (no DOM, no store, no loader).
 *
 * Given each subtopic's authored MCQ ids plus the persisted per-question
 * progress map, this ranks the subtopics the learner is WEAKEST at (lowest
 * accuracy / most wrong among the ones they have actually attempted) and,
 * separately, lists the GAPS — subtopics not yet started at all. The view layer
 * turns each weak row into a one-tap "Drill these" (scoped to the subtopic's
 * wrong/low question ids via {@link WeakRow.wrongQuestionIds}) and a Learn link.
 *
 * Every number is REAL: accuracy is `correct / attempts` over the subtopic's
 * questions, `wrong` is the total wrong attempts, `mastery` reuses the shared
 * {@link subtopicMasteryPct}. Nothing here is fabricated or smoothed.
 */
import { weakQuestionIds } from '../engine/drill';
import { statusFromMastery, subtopicMasteryPct, type SubtopicStatus } from './metrics';
import type { Band } from '../content/taxonomy';
import type { ProgressEntry } from '../state/store';

/** The minimal per-subtopic input the ranking needs. */
export interface WeakSubtopicInput {
  subtopicId: string;
  name: string;
  band?: Band;
  /** The authored MCQ ids belonging to this subtopic. */
  mcqIds: readonly string[];
}

/** A ranked weak-area row (all values derived from real progress). */
export interface WeakRow {
  subtopicId: string;
  name: string;
  band?: Band;
  /** Authored MCQ count. */
  total: number;
  /** Distinct MCQs attempted at least once. */
  attempted: number;
  /** Total correct attempts across the subtopic. */
  correct: number;
  /** Total attempts (sum of `seen`). */
  seen: number;
  /** Total wrong attempts across the subtopic. */
  wrong: number;
  /** correct / seen in [0, 1]; 0 when nothing attempted. */
  accuracy: number;
  /** Learner-progress percent (mastery), 0–100. */
  mastery: number;
  status: SubtopicStatus;
  /**
   * The subtopic's WEAK question ids (attempted but not cleanly mastered) — the
   * scoped remediation set the "Drill these" action passes to `buildSession`'s
   * `restrictToIds`. Empty when there is nothing specific to re-drill.
   */
  wrongQuestionIds: string[];
}

/** The split ranking: attempted-but-weak, and not-started gaps. */
export interface WeakRanking {
  /** Attempted subtopics, ranked WEAKEST first. */
  weak: WeakRow[];
  /** Subtopics not started at all (coverage gaps), in input order. */
  gaps: WeakRow[];
}

/** Tally one subtopic's progress into a {@link WeakRow}. @internal */
function rowFor(
  input: WeakSubtopicInput,
  progress: Readonly<Record<string, ProgressEntry>>,
): WeakRow {
  let attempted = 0;
  let correct = 0;
  let seen = 0;
  let wrong = 0;
  for (const id of input.mcqIds) {
    const p = progress[id];
    if (p && p.seen > 0) {
      attempted += 1;
      seen += p.seen;
      correct += p.correct;
      wrong += p.wrong;
    }
  }
  const mastery = subtopicMasteryPct(progress, input.mcqIds);
  return {
    subtopicId: input.subtopicId,
    name: input.name,
    band: input.band,
    total: input.mcqIds.length,
    attempted,
    correct,
    seen,
    wrong,
    accuracy: seen > 0 ? correct / seen : 0,
    mastery,
    status: statusFromMastery(mastery),
    wrongQuestionIds: weakQuestionIds(progress, input.mcqIds),
  };
}

/**
 * Rank subtopics by WEAKNESS.
 *
 * A subtopic is "weak" (and rankable) once it has been ATTEMPTED (`attempted >
 * 0`); everything not yet started is returned separately as a `gaps` list so
 * the two are never conflated. Weak rows are ordered:
 *   1. lowest accuracy first (the core signal);
 *   2. then most wrong attempts (breaks accuracy ties toward higher volume);
 *   3. then lowest mastery;
 *   4. then name (stable, deterministic).
 *
 * PURE: inputs are never mutated.
 */
export function rankWeakAreas(
  inputs: readonly WeakSubtopicInput[],
  progress: Readonly<Record<string, ProgressEntry>>,
): WeakRanking {
  const rows = inputs.map((i) => rowFor(i, progress));
  const weak = rows
    .filter((r) => r.attempted > 0)
    .sort(
      (a, b) =>
        a.accuracy - b.accuracy ||
        b.wrong - a.wrong ||
        a.mastery - b.mastery ||
        a.name.localeCompare(b.name),
    );
  const gaps = rows.filter((r) => r.attempted === 0);
  return { weak, gaps };
}
