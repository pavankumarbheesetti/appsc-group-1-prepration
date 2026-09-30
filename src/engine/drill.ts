/**
 * Drill session builder and scorer — PURE functions only (no DOM, no storage).
 *
 * Pulls MCQs from the offline content loader, optionally filters them by
 * subject / topic / spaced-repetition due-ness / an explicit id allowlist (a
 * legacy tier filter is still accepted for back-compat but no UI exposes it),
 * then orders them. Two orderings are supported: a stable REFRESHER-FIRST order
 * (warm-up recall questions lead, then exam-level — the default, session size =
 * scope) and a seeded SHUFFLE (deterministic when a `seed` is supplied, else
 * `Math.random`). The cap (`limit`) is OPTIONAL: omit it (or pass 0) to include
 * the whole scope so the caller never has to pre-commit a question count.
 */
import { getBanks } from '../content/loader';
import type { MCQItem, SubjectCode, Tier } from '../content/types';
import { isDue, type SrCard } from './spaced-repetition';

/** How a built session is ordered. */
export type SessionOrder = 'ladder' | 'shuffle';

/**
 * The minimal per-question progress shape {@link weakQuestionIds} needs. It is
 * a structural subset of the store's `ProgressEntry`, kept here so the engine
 * stays free of any state-layer import.
 */
export interface ProgressLike {
  seen: number;
  correct: number;
  wrong: number;
  lastResult?: string;
}

/** Options controlling how a drill session is assembled. */
export interface BuildSessionOpts {
  /** Restrict to one subject. */
  subjectCode?: SubjectCode;
  /** Restrict to one bank topic. */
  topic?: string;
  /** Restrict to MCQs tagged with this taxonomy subtopic id. */
  subtopicId?: string;
  /**
   * Restrict to one legacy difficulty tier (1..3). BACK-COMPAT ONLY: no UI
   * exposes it now that the app is single-exam-level, but a caller (or old
   * saved scope) that still passes it continues to filter as before.
   */
  tier?: Tier;
  /**
   * Maximum number of questions to include. OPTIONAL: `undefined` or `0` (or any
   * value `<= 0`) means NO cap — include every question in scope. This is what
   * lets the UI offer "session size = scope" presets with no number input.
   */
  limit?: number;
  /** When true, keep only questions that are SR-due (or never seen). */
  dueOnly?: boolean;
  /** SR cards keyed by MCQ id, consulted when `dueOnly` is set. */
  srCards?: Readonly<Record<string, SrCard>>;
  /** Reference time for due checks (epoch ms). Defaults to `Date.now()`. */
  now?: number;
  /** Seed for a deterministic shuffle; omit for a random shuffle. */
  seed?: number;
  /**
   * Restrict the pool to this explicit set of MCQ ids (intersection). Used by
   * the "Weak areas" and "Due review" presets, which pre-compute the ids.
   */
  restrictToIds?: readonly string[];
  /**
   * Ordering strategy. Defaults to `'ladder'` — now a STABLE REFRESHER-FIRST
   * order (warm-up recall questions lead, then exam-level, original order
   * preserved within each group) — EXCEPT when a `seed` is supplied without an
   * explicit `order`, which implies the caller wants a reproducible `'shuffle'`.
   * The `'ladder'` name is retained for back-compat with existing callers.
   */
  order?: SessionOrder;
}

/** A built drill session: the ordered questions to present. */
export interface DrillSession {
  items: MCQItem[];
}

/** The outcome of grading one question. */
export interface AnswerResult {
  correct: boolean;
  answerIndex: number;
}

/** A per-question outcome, the minimum needed to score a session. */
export interface ScoredAnswer {
  correct: boolean;
}

/** An aggregate session score. */
export interface SessionScore {
  total: number;
  correct: number;
  wrong: number;
  /** Fraction correct in [0, 1]; 0 for an empty session. */
  accuracy: number;
}

/**
 * Collect all MCQ items across banks, optionally filtered by subject/topic.
 * @internal
 */
function collectMCQ(subjectCode?: SubjectCode, topic?: string): MCQItem[] {
  const out: MCQItem[] = [];
  for (const { bank } of getBanks('mcq', subjectCode)) {
    // getBanks('mcq', …) only yields mcq banks; narrow the union for `items`.
    if (bank.kind !== 'mcq') continue;
    if (topic !== undefined && bank.topic !== topic) continue;
    out.push(...bank.items);
  }
  return out;
}

/**
 * Small, fast seeded PRNG (mulberry32) → deterministic shuffles in tests.
 * @internal
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle using the supplied RNG; returns a new array.
 * @internal
 */
function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    // Both indices are in-range; assert away noUncheckedIndexedAccess undefined.
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/**
 * Stable "refresher-first" ordering (the default): warm-up RECALL questions
 * (`refresher === true`) lead, then the exam-level questions, each group
 * preserving its original relative order. Implemented as a decorated sort with
 * an index tie-breaker so it is stable regardless of engine, and returns a new
 * array (input is not mutated). This REPLACES the old tier ladder now that the
 * app is single-exam-level; the `order: 'ladder'` value is kept as an accepted
 * alias for back-compat and maps here. @internal
 */
function refresherRank(item: MCQItem): number {
  return item.refresher ? 0 : 1;
}
export function refresherFirstSort(items: readonly MCQItem[]): MCQItem[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => refresherRank(a.item) - refresherRank(b.item) || a.i - b.i)
    .map((x) => x.item);
}

/**
 * Assemble a drill session from the content banks per {@link BuildSessionOpts}.
 */
export function buildSession(opts: BuildSessionOpts): DrillSession {
  const now = opts.now ?? Date.now();
  let items = collectMCQ(opts.subjectCode, opts.topic);

  if (opts.subtopicId !== undefined) {
    items = items.filter((i) => i.subtopicId === opts.subtopicId);
  }

  if (opts.tier !== undefined) {
    // Back-compat only (no UI exposes tier); kept so old scopes still filter.
    items = items.filter((i) => i.tier === opts.tier);
  }

  if (opts.dueOnly) {
    const cards = opts.srCards ?? {};
    // A never-seen question (no card) is treated as due so new material surfaces.
    items = items.filter((i) => {
      const card = cards[i.id];
      return card === undefined || isDue(card, now);
    });
  }

  // Intersect with an explicit id allowlist when provided (Weak/Due presets).
  if (opts.restrictToIds !== undefined) {
    const allow = new Set(opts.restrictToIds);
    items = items.filter((i) => allow.has(i.id));
  }

  // Ordering: default to the stable refresher-first order; a bare `seed` implies shuffle.
  const order: SessionOrder = opts.order ?? (opts.seed !== undefined ? 'shuffle' : 'ladder');
  if (order === 'shuffle') {
    const rng = opts.seed !== undefined ? mulberry32(opts.seed) : Math.random;
    items = shuffle(items, rng);
  } else {
    items = refresherFirstSort(items);
  }

  // Cap. Optional: undefined/0/negative = no cap (return the whole scope).
  if (opts.limit !== undefined && opts.limit > 0) {
    items = items.slice(0, opts.limit);
  }
  return { items };
}

/**
 * Return the ids from `mcqIds` that are "WEAK" — attempted at least once but
 * not yet cleanly mastered — for the "Weak areas" preset.
 *
 * Precisely: an id is weak when `seen > 0` AND (`wrong > 0` OR `correct < seen`).
 * In words, the learner has attempted it, but has either missed it at least
 * once or has not answered it correctly on every sighting. A question that has
 * never been seen is NOT weak (it belongs to Quick/Full, not remediation); a
 * question answered correctly every time (`wrong === 0` and `correct >= seen`)
 * is considered mastered and excluded. Ordering follows `mcqIds` for a
 * deterministic result.
 */
export function weakQuestionIds(
  progress: Readonly<Record<string, ProgressLike>>,
  mcqIds: readonly string[],
): string[] {
  const out: string[] = [];
  for (const id of mcqIds) {
    const p = progress[id];
    if (p === undefined) continue;
    if (p.seen > 0 && (p.wrong > 0 || p.correct < p.seen)) out.push(id);
  }
  return out;
}

/**
 * Return the ids from `mcqIds` whose SR card is due at `now` — for the
 * "Due review" preset and its live count.
 *
 * Only ids that already HAVE an SR card are considered: a never-seen question
 * (no card) is intentionally excluded, because "Due review" resurfaces material
 * the learner has already studied rather than brand-new questions (that is what
 * Quick/Full are for). Ordering follows `mcqIds` for a deterministic result.
 */
export function dueQuestionIds(
  srCards: Readonly<Record<string, SrCard>>,
  mcqIds: readonly string[],
  now: number,
): string[] {
  const out: string[] = [];
  for (const id of mcqIds) {
    const card = srCards[id];
    if (card !== undefined && isDue(card, now)) out.push(id);
  }
  return out;
}

/** Grade a chosen option against an MCQ's answer. */
export function answerQuestion(item: MCQItem, chosenIndex: number): AnswerResult {
  return { correct: chosenIndex === item.answerIndex, answerIndex: item.answerIndex };
}

/** Aggregate per-question outcomes into a session score. */
export function scoreSession(answers: readonly ScoredAnswer[]): SessionScore {
  const total = answers.length;
  const correct = answers.filter((a) => a.correct).length;
  const wrong = total - correct;
  const accuracy = total === 0 ? 0 : correct / total;
  return { total, correct, wrong, accuracy };
}
