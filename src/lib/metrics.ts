/**
 * Dashboard metrics — PURE selector/derivation helpers (no DOM, no storage).
 *
 * These compute the numbers the new Dashboard surfaces (exam countdown, overall
 * mastery, coverage, due-today, best notebook streak, per-subject aggregates)
 * from already-loaded state + content. They take plain inputs (records/arrays)
 * rather than reaching into the loader/store, so they are trivially unit-tested
 * and never alter any existing engine/store behaviour.
 */
import type { SubjectCode, SyllabusMeta, Tier } from '../content/types';
import type { Band } from '../content/taxonomy';
import { isDue, type SrCard } from '../engine/spaced-repetition';
import type { NotebookEntry } from '../engine/notebook';
import type { ProgressEntry } from '../state/store';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Normalize an epoch-ms timestamp to local midnight. @internal */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Parse a `DD/MM/YYYY` date string (the format used in syllabus meta) into a
 * local `Date`, or `null` if it is malformed / not a real calendar date.
 */
export function parseDMY(s: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const d = new Date(year, month - 1, day);
  // Reject overflow (e.g. 31/02) — JS would silently roll it forward.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/**
 * Whole calendar days from `nowMs` until `targetMs` (negative once past).
 * Compared at local-midnight so partial days don't skew the count.
 */
export function daysUntil(targetMs: number, nowMs: number): number {
  return Math.round((startOfDay(targetMs) - startOfDay(nowMs)) / DAY_MS);
}

/** The exam-countdown readout shown in the hero. */
export interface Countdown {
  /** Days until the target date; null when the meta date can't be parsed. */
  days: number | null;
  /** The target date as originally written (DD/MM/YYYY). */
  targetDate: string;
  /** Human label clarifying WHAT the countdown targets. */
  label: string;
  /** True once the target date is in the past. */
  isPast: boolean;
}

/**
 * Compute the countdown to the application window opening.
 *
 * The 07/2026 "notification" is a MM/YYYY marker, so it is ambiguous as a
 * single day. Per the design brief we therefore count down to the application
 * window's `from` date (a concrete DD/MM/YYYY) and label it clearly.
 */
export function examCountdown(meta: SyllabusMeta, nowMs: number): Countdown {
  const targetDate = meta.applicationWindow.from;
  const parsed = parseDMY(targetDate);
  if (!parsed) {
    return { days: null, targetDate, label: 'until applications open', isPast: false };
  }
  const days = daysUntil(parsed.getTime(), nowMs);
  return {
    days,
    targetDate,
    label: 'until applications open',
    isPast: days < 0,
  };
}

/** Aggregate mastery across all answered questions. */
export interface Mastery {
  /** Total attempts recorded. */
  seen: number;
  /** Total correct attempts. */
  correct: number;
  /** Distinct questions answered at least once. */
  answered: number;
  /** correct / seen in [0, 1]; 0 when nothing seen. */
  accuracy: number;
}

/** Fold the progress map into an overall mastery summary. */
export function overallMastery(progress: Readonly<Record<string, ProgressEntry>>): Mastery {
  let seen = 0;
  let correct = 0;
  let answered = 0;
  for (const p of Object.values(progress)) {
    seen += p.seen;
    correct += p.correct;
    if (p.seen > 0) answered += 1;
  }
  return { seen, correct, answered, accuracy: seen > 0 ? correct / seen : 0 };
}

/** Fraction of the question pool answered at least once, in [0, 1]. */
export function coverageFraction(answered: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, answered / total);
}

/** Count SR cards that are due at `nowMs`. */
export function dueCount(sr: Readonly<Record<string, SrCard>>, nowMs: number): number {
  let n = 0;
  for (const card of Object.values(sr)) {
    if (isDue(card, nowMs)) n += 1;
  }
  return n;
}

/**
 * The best current graduation streak across active notebook entries (0 when
 * the notebook is empty). This is the honest "streak" the existing state can
 * support — there is no per-day history dimension to build a daily streak from.
 */
export function bestStreak(notebook: Readonly<Record<string, NotebookEntry>>): number {
  let best = 0;
  for (const e of Object.values(notebook)) {
    if (!e.graduated && e.consecutiveCorrect > best) best = e.consecutiveCorrect;
  }
  return best;
}

/** Per-subject rollup used by the mastery grid and activity chart. */
export interface SubjectAgg {
  code: SubjectCode;
  name: string;
  /** Total questions authored for the subject. */
  total: number;
  /** Distinct questions answered at least once. */
  answered: number;
  /** Total attempts. */
  seen: number;
  /** Total correct attempts. */
  correct: number;
  /** correct / seen in [0, 1]. */
  accuracy: number;
}

/**
 * Aggregate MCQ items by subject, joining in per-question progress. Preserves
 * first-seen subject order so the UI is stable across renders.
 */
export function aggregateSubjects(
  items: ReadonlyArray<{ id: string; subjectCode: SubjectCode }>,
  progress: Readonly<Record<string, ProgressEntry>>,
  subjectNames: Readonly<Record<SubjectCode, string>>,
): SubjectAgg[] {
  const order: SubjectCode[] = [];
  const map = new Map<SubjectCode, SubjectAgg>();

  for (const item of items) {
    let agg = map.get(item.subjectCode);
    if (!agg) {
      agg = {
        code: item.subjectCode,
        name: subjectNames[item.subjectCode],
        total: 0,
        answered: 0,
        seen: 0,
        correct: 0,
        accuracy: 0,
      };
      map.set(item.subjectCode, agg);
      order.push(item.subjectCode);
    }
    agg.total += 1;
    const p = progress[item.id];
    if (p && p.seen > 0) {
      agg.answered += 1;
      agg.seen += p.seen;
      agg.correct += p.correct;
    }
  }

  return order.map((code) => {
    const agg = map.get(code)!;
    agg.accuracy = agg.seen > 0 ? agg.correct / agg.seen : 0;
    return agg;
  });
}

/** Format a fraction in [0,1] as a whole-percent string, e.g. `72%`. */
export function pct(fraction: number): string {
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

/** Fraction of the plot a bar may occupy at the data max — the rest is headroom. */
const CHART_HEADROOM = 0.85;

/**
 * A "nice" axis ceiling at or above `dataMax`, chosen from a 1/2/5×10ⁿ ladder so
 * the tallest bar always keeps ~15% headroom. This guarantees a lone data point
 * (or an all-equal set) never scales to the full plot height — the old
 * `value / max = 1` behaviour that rendered a single subject as a solid block.
 * Always returns a value ≥ 1 so downstream division is safe.
 */
export function niceMax(dataMax: number): number {
  const m = Math.max(1, dataMax);
  // Target ceiling that leaves headroom above the tallest value.
  const target = m / CHART_HEADROOM;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const mult of [1, 2, 5]) {
    const cand = mult * pow;
    if (cand >= target) return cand;
  }
  return 10 * pow;
}

/* -------------------------------------------------------------------------- */
/* Subtopic coverage + mastery status (Syllabus tracker / Learn workspace)     */
/* -------------------------------------------------------------------------- */

/**
 * Target authored-MCQ count per priority band, driving the coverage bar.
 * Band A (highest exam weight) demands the deepest bank; D the shallowest.
 * A subtopic with no band defaults to the `D` target (see {@link targetForBand}).
 */
export const MCQ_TARGET_BY_BAND: Record<Band, number> = {
  A: 40,
  B: 25,
  C: 15,
  D: 10,
};

/** The target MCQ count for a band (undefined band → the `D` floor). */
export function targetForBand(band: Band | undefined): number {
  return band ? MCQ_TARGET_BY_BAND[band] : MCQ_TARGET_BY_BAND.D;
}

/**
 * Coverage percent for a subtopic: `min(100, mcqCount / target * 100)`, rounded.
 * Zero target is treated as fully covered when content exists, else 0%.
 */
export function coveragePct(mcqCount: number, target: number): number {
  if (target <= 0) return mcqCount > 0 ? 100 : 0;
  return Math.min(100, Math.round((mcqCount / target) * 100));
}

/**
 * EXAM-POINT coverage for a subtopic that declares an `examPoints` checklist.
 *
 * Coverage is the share of DISTINCT exam-points tested by at least one of the
 * subtopic's MCQs (via each item's `covers[]`): `round(100 * covered / total)`.
 * A `covers` entry that is not in `examPoints` is ignored (it can't inflate the
 * score). `covered`/`missing` preserve the authored `examPoints` order so the
 * UI can list what's done vs still open. Pure; an empty checklist is 0%.
 */
export interface ExamPointCoverage {
  /** Total exam-points in the subtopic's checklist. */
  total: number;
  /** Exam-points tested by ≥ 1 MCQ, in checklist order. */
  covered: string[];
  /** Exam-points not yet tested by any MCQ, in checklist order. */
  missing: string[];
  /** round(100 * covered / total); 0 when the checklist is empty. */
  pct: number;
}

/** Compute {@link ExamPointCoverage} from a checklist + the MCQs that map to it. */
export function examPointCoverage(
  examPoints: readonly string[],
  mcqs: ReadonlyArray<{ covers?: readonly string[] }>,
): ExamPointCoverage {
  const inChecklist = new Set(examPoints);
  const hit = new Set<string>();
  for (const m of mcqs) {
    if (!m.covers) continue;
    for (const c of m.covers) {
      if (inChecklist.has(c)) hit.add(c);
    }
  }
  const covered = examPoints.filter((p) => hit.has(p));
  const missing = examPoints.filter((p) => !hit.has(p));
  const pct = examPoints.length === 0 ? 0 : Math.round((covered.length / examPoints.length) * 100);
  return { total: examPoints.length, covered, missing, pct };
}

/** A subtopic's mastery status, derived from progress over its MCQs. */
export type SubtopicStatus = 'not-started' | 'learning' | 'revised' | 'mastered';

/**
 * The tallied progress signals a subtopic's status is derived from.
 * - `total` — number of MCQs authored for the subtopic.
 * - `seen` — how many of those MCQs have been attempted at least once.
 * - `correctOnce` — how many have been answered correctly at least once.
 */
export interface SubtopicProgressTally {
  total: number;
  seen: number;
  correctOnce: number;
}

/** Fraction of a subtopic's MCQs answered correctly ≥ once to count as mastered. */
export const MASTERED_THRESHOLD = 0.8;
/** Fraction correct-once at/above which a partly-worked subtopic reads as revised. */
export const REVISED_THRESHOLD = 0.4;

/**
 * Derive a subtopic's mastery status from its progress tally.
 *
 * - `not-started` — nothing authored, or no MCQ attempted yet (`seen === 0`).
 * - `mastered` — ≥ {@link MASTERED_THRESHOLD} of its MCQs answered correctly
 *   at least once.
 * - `revised` — ≥ {@link REVISED_THRESHOLD} correct-once (solid progress).
 * - `learning` — attempted, but below the revised bar.
 */
export function subtopicStatus(tally: SubtopicProgressTally): SubtopicStatus {
  if (tally.total === 0 || tally.seen === 0) return 'not-started';
  const correctFrac = tally.correctOnce / tally.total;
  if (correctFrac >= MASTERED_THRESHOLD) return 'mastered';
  if (correctFrac >= REVISED_THRESHOLD) return 'revised';
  return 'learning';
}

/**
 * Tally progress over a subtopic's MCQ ids against the persisted progress map.
 * Pure — takes the ids + progress and counts seen / correct-once.
 */
export function tallySubtopicProgress(
  mcqIds: readonly string[],
  progress: Readonly<Record<string, ProgressEntry>>,
): SubtopicProgressTally {
  let seen = 0;
  let correctOnce = 0;
  for (const id of mcqIds) {
    const p = progress[id];
    if (p && p.seen > 0) {
      seen += 1;
      if (p.correct > 0) correctOnce += 1;
    }
  }
  return { total: mcqIds.length, seen, correctOnce };
}

/**
 * LEARNER PROGRESS (mastery) for a subtopic: the whole-percent share of its
 * MCQs answered CORRECTLY at least once, `round(100 * correctOnce / total)`.
 *
 * This is the honest "how much of this topic have I actually got right yet"
 * number the tracker + Learn header surface — 0 on a fresh profile and 100 only
 * once every question has been answered correctly at least once. It deliberately
 * does NOT measure authoring coverage (how many questions exist); see
 * {@link coveragePct} for that separate, non-competing signal.
 *
 * Pure — takes the ids + progress; returns 0 for an empty id list.
 */
export function subtopicMasteryPct(
  progress: Readonly<Record<string, ProgressEntry>>,
  mcqIds: readonly string[],
): number {
  if (mcqIds.length === 0) return 0;
  let correctOnce = 0;
  for (const id of mcqIds) {
    const p = progress[id];
    if (p && p.correct > 0) correctOnce += 1;
  }
  return Math.round((correctOnce / mcqIds.length) * 100);
}

/** Mastery-% at/above which a subtopic reads as MASTERED (matches 0.8 frac). */
export const MASTERED_PCT = 80;
/** Mastery-% at/above which a subtopic reads as REVISED (matches 0.4 frac). */
export const REVISED_PCT = 40;

/**
 * Derive a subtopic's status DIRECTLY from its {@link subtopicMasteryPct}, so
 * the status chip and the progress bar always tell the same story:
 * - `not-started` — 0% (nothing answered correctly yet).
 * - `learning` — >0% and < {@link REVISED_PCT}.
 * - `revised` — ≥ {@link REVISED_PCT} and < {@link MASTERED_PCT}.
 * - `mastered` — ≥ {@link MASTERED_PCT}.
 */
export function statusFromMastery(masteryPct: number): SubtopicStatus {
  if (masteryPct <= 0) return 'not-started';
  if (masteryPct < REVISED_PCT) return 'learning';
  if (masteryPct < MASTERED_PCT) return 'revised';
  return 'mastered';
}

/* -------------------------------------------------------------------------- */
/* Drill SESSION result stats (results screen)                                 */
/* -------------------------------------------------------------------------- */

/**
 * A learner's OPTIONAL self-rating, set before answering a question.
 * - `sure` — "I know this".
 * - `guess` — "I'm not confident".
 * `null`/absent means the learner didn't rate it (the default, unobtrusive).
 */
export type Confidence = 'sure' | 'guess';

/**
 * One answered question's outcome — the minimum needed to derive the richer
 * results-screen stats (pace, confidence calibration, exam-points practiced).
 * Built by the quiz runner in memory; never persisted.
 */
export interface SessionAnswerDetail {
  /**
   * LEGACY difficulty tier of the question (1..3), when the item still carries
   * one. OPTIONAL now that the app is single-exam-level — nothing renders a
   * per-tier breakdown anymore; retained only for back-compat with old data.
   */
  tier?: Tier;
  /** The exam-points this question tested (see `MCQItem.covers`), if any. */
  covers?: readonly string[];
  /** Whether the learner answered correctly. */
  correct: boolean;
  /** Wall-clock time the learner spent on the question, in ms (>= 0). */
  timeMs: number;
  /** Optional self-rated confidence set before answering. */
  confidence?: Confidence | null;
}

/**
 * Count the DISTINCT exam-points practiced across a session (the union of every
 * answered question's `covers[]`). Powers the optional "exam points practiced"
 * line on the results screen. Pure; 0 when no question carried a `covers` map.
 */
export function examPointsPracticed(details: readonly SessionAnswerDetail[]): number {
  const seen = new Set<string>();
  for (const d of details) {
    if (!d.covers) continue;
    for (const p of d.covers) seen.add(p);
  }
  return seen.size;
}

/**
 * Mean time-per-question in ms across the session, rounded to a whole ms.
 * Returns 0 for an empty session (never divides by zero). Pure.
 */
export function avgTimeMs(details: readonly SessionAnswerDetail[]): number {
  if (details.length === 0) return 0;
  let sum = 0;
  for (const d of details) sum += Math.max(0, d.timeMs);
  return Math.round(sum / details.length);
}

/**
 * Format a duration in ms as a compact `M:SS` (or `SS s` under a minute) label
 * for the pace/avg-time readouts. Negative inputs clamp to 0. Pure.
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/** Confidence-vs-correctness rollup for the tiny results calibration line. */
export interface ConfidenceBreakdown {
  /** Questions the learner marked "Sure". */
  sure: { total: number; correct: number };
  /** Questions the learner marked "Guess". */
  guess: { total: number; correct: number };
  /** Questions left unrated. */
  unset: number;
  /** True when at least one question carried a confidence rating. */
  hasRatings: boolean;
}

/**
 * Roll answered questions up by their optional confidence rating, so the
 * results screen can show a small "you were right on X% of your Sure answers"
 * calibration line. Pure; unrated questions are counted in `unset`.
 */
export function confidenceBreakdown(details: readonly SessionAnswerDetail[]): ConfidenceBreakdown {
  const out: ConfidenceBreakdown = {
    sure: { total: 0, correct: 0 },
    guess: { total: 0, correct: 0 },
    unset: 0,
    hasRatings: false,
  };
  for (const d of details) {
    if (d.confidence === 'sure') {
      out.sure.total += 1;
      if (d.correct) out.sure.correct += 1;
    } else if (d.confidence === 'guess') {
      out.guess.total += 1;
      if (d.correct) out.guess.correct += 1;
    } else {
      out.unset += 1;
    }
  }
  out.hasRatings = out.sure.total > 0 || out.guess.total > 0;
  return out;
}

/* -------------------------------------------------------------------------- */
/* MOCK exam scoring (timed mock — negative marking)                           */
/* -------------------------------------------------------------------------- */

/**
 * The APPSC screening negative-marking fraction: a WRONG answer costs 1/3 of a
 * mark. A SKIPPED (blank) question is never penalised — this is the official
 * "no penalty for blanks" rule the mock enforces.
 */
export const NEGATIVE_MARK = 1 / 3;

/**
 * One question's outcome in a MOCK. Unlike {@link ScoredAnswer} (drill), a mock
 * distinguishes a SKIP from a wrong answer, because only attempted-and-wrong
 * answers incur the negative mark.
 * - `attempted` — the learner selected an option (else it is a blank/skip).
 * - `correct` — whether that selected option was right (ignored when skipped).
 */
export interface MockAnswer {
  attempted: boolean;
  correct: boolean;
}

/**
 * NET mock score = correct − wrong × (1/3). SKIPPED/blank questions never incur
 * a penalty; only ATTEMPTED-and-wrong answers subtract. Pure — an empty session
 * (or an all-blank one) scores exactly 0, and the result is never dragged below
 * a raw correct-count by unanswered questions.
 */
export function netScore(answers: readonly MockAnswer[]): number {
  let correct = 0;
  let wrong = 0;
  for (const a of answers) {
    if (!a.attempted) continue; // blanks are neutral
    if (a.correct) correct += 1;
    else wrong += 1;
  }
  return correct - wrong * NEGATIVE_MARK;
}

/** The full aggregate a mock RESULTS screen needs. */
export interface MockScore {
  /** Questions in the mock. */
  total: number;
  /** Questions the learner attempted (selected an option). */
  attempted: number;
  /** Attempted-and-correct. */
  correct: number;
  /** Attempted-and-wrong (the only bucket that is penalised). */
  wrong: number;
  /** Left blank (never penalised). */
  skipped: number;
  /** NET score = correct − wrong/3 (see {@link netScore}). */
  net: number;
  /** correct / attempted in [0, 1]; 0 when nothing was attempted. */
  accuracy: number;
}

/**
 * Tally mock outcomes into the full {@link MockScore} the results screen shows.
 * Pure; `net` is delegated to {@link netScore} so the two can never disagree.
 * `accuracy` is over ATTEMPTED questions (not the whole paper), matching how a
 * candidate reads "of the ones I answered, how many were right".
 */
export function mockScore(answers: readonly MockAnswer[]): MockScore {
  const total = answers.length;
  let attempted = 0;
  let correct = 0;
  let wrong = 0;
  for (const a of answers) {
    if (!a.attempted) continue;
    attempted += 1;
    if (a.correct) correct += 1;
    else wrong += 1;
  }
  return {
    total,
    attempted,
    correct,
    wrong,
    skipped: total - attempted,
    net: netScore(answers),
    accuracy: attempted === 0 ? 0 : correct / attempted,
  };
}

/**
 * Format a whole net score for display: integers stay integer (`42`), thirds
 * render to at most two decimals with trailing zeros trimmed (`41.67`, `-0.33`).
 * Keeps the prominent results number tidy regardless of the wrong-count.
 */
export function formatNet(net: number): string {
  const rounded = Math.round(net * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
