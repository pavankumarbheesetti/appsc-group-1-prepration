/**
 * Telugu course PROGRESS helpers — PURE functions (no DOM, no I/O) that tally a
 * learner's per-glyph "learned" flags into per-stage and course-level progress.
 *
 * The Telugu view keeps all canvas/audio work in the browser layer; everything
 * that can be reasoned about deterministically (which glyphs belong to a stage,
 * how many are learned, whether a stage is complete) lives here so it is
 * trivially unit-testable. Progress is a flat `Record<glyphId, boolean>` — the
 * exact shape persisted at `AppState.telugu`.
 */
import {
  CONSONANTS,
  GUNINTALU,
  NUMBERS,
  STARTER_SENTENCES,
  STARTER_WORDS,
  VATTULU,
  VOWELS,
  TELUGU_LESSONS,
  type TeluguLesson,
  type TeluguStage,
} from '../content/telugu';

/** The learner's per-glyph learned flags (id → true). Missing/false = not learned. */
export type TeluguProgress = Readonly<Record<string, boolean>>;

/** The stages that contain trackable glyphs, in course order. */
export const TRACKED_STAGES: readonly TeluguStage[] = [
  'vowels',
  'consonants',
  'gunintalu',
  'vattulu',
  'numbers',
  'words',
  'sentences',
];

/**
 * The trackable glyph ids for a stage, in display order. `intro` carries no
 * trackable glyphs and returns an empty list.
 */
export function stageIds(stage: TeluguStage): readonly string[] {
  switch (stage) {
    case 'vowels':
      return VOWELS.map((v) => v.id);
    case 'consonants':
      return CONSONANTS.map((c) => c.id);
    case 'gunintalu':
      return GUNINTALU.map((g) => g.id);
    case 'vattulu':
      return VATTULU.map((x) => x.id);
    case 'numbers':
      return NUMBERS.map((n) => n.id);
    case 'words':
      return STARTER_WORDS.map((w) => w.id);
    case 'sentences':
      return STARTER_SENTENCES.map((s) => s.id);
    case 'intro':
      return [];
  }
}

/** Count how many of `ids` are marked learned in `progress`. */
export function learnedCount(progress: TeluguProgress, ids: readonly string[]): number {
  return ids.reduce((n, id) => (progress[id] === true ? n + 1 : n), 0);
}

/** A stage's learned/total tally and completion flag. */
export interface StageTally {
  learned: number;
  total: number;
  complete: boolean;
}

/**
 * Tally one stage. A stage with no trackable glyphs (e.g. `intro`) is reported
 * as `0/0` and `complete: false` so it is never counted toward the course.
 */
export function stageTally(progress: TeluguProgress, stage: TeluguStage): StageTally {
  const ids = stageIds(stage);
  const learned = learnedCount(progress, ids);
  const total = ids.length;
  return { learned, total, complete: total > 0 && learned === total };
}

/** A course-wide tally across every tracked stage. */
export interface CourseTally {
  learned: number;
  total: number;
  /** Whole-number percentage 0–100 (0 when there is nothing to learn). */
  pct: number;
  /** Count of tracked stages that are fully complete. */
  stagesComplete: number;
}

/** Tally the whole course by summing every tracked stage. */
export function courseTally(progress: TeluguProgress): CourseTally {
  let learned = 0;
  let total = 0;
  let stagesComplete = 0;
  for (const stage of TRACKED_STAGES) {
    const t = stageTally(progress, stage);
    learned += t.learned;
    total += t.total;
    if (t.complete) stagesComplete += 1;
  }
  const pct = total === 0 ? 0 : Math.round((learned / total) * 100);
  return { learned, total, pct, stagesComplete };
}

/* -------------------------------------------------------------------------- */
/* Lesson path (15-minute lessons the planner's Telugu blocks walk in order)   */
/* -------------------------------------------------------------------------- */

/** Questions in a lesson check. */
export const LESSON_CHECK_SIZE = 10;
/** Correct answers needed to pass a lesson check. */
export const LESSON_CHECK_PASS = 8;
/** Minutes a lesson is planned for. */
export const LESSON_MINUTES = 15;

/** Telugu lesson completion map: lesson id → ISO date it was completed. */
export type TeluguLessonsDone = Readonly<Record<string, string>>;

/** One recognisable item: its glyph and the answer the check asks for. */
export interface LessonItem {
  id: string;
  glyph: string;
  /** Transliteration (letters/syllables/conjuncts), value (digits) or meaning (words). */
  answer: string;
}

/** Every trackable item, keyed by glyph id, with its check answer. @internal */
function itemIndex(): Map<string, LessonItem & { stage: TeluguStage }> {
  const m = new Map<string, LessonItem & { stage: TeluguStage }>();
  for (const v of VOWELS) m.set(v.id, { id: v.id, glyph: v.glyph, answer: v.translit, stage: 'vowels' });
  for (const c of CONSONANTS) m.set(c.id, { id: c.id, glyph: c.glyph, answer: c.translit, stage: 'consonants' });
  for (const g of GUNINTALU) m.set(g.id, { id: g.id, glyph: g.glyph, answer: g.translit, stage: 'gunintalu' });
  for (const x of VATTULU) m.set(x.id, { id: x.id, glyph: x.glyph, answer: x.translit, stage: 'vattulu' });
  for (const n of NUMBERS) m.set(n.id, { id: n.id, glyph: n.glyph, answer: String(n.value), stage: 'numbers' });
  for (const w of STARTER_WORDS) m.set(w.id, { id: w.id, glyph: w.glyph, answer: w.meaning, stage: 'words' });
  for (const t of STARTER_SENTENCES) m.set(t.id, { id: t.id, glyph: t.glyph, answer: t.meaning, stage: 'sentences' });
  return m;
}

/** The lesson with `id`, if any. */
export function lessonById(id: string): TeluguLesson | undefined {
  return TELUGU_LESSONS.find((l) => l.id === id);
}

/** The first lesson not yet completed (in path order), or `undefined` when all are done. */
export function nextLesson(done: TeluguLessonsDone): TeluguLesson | undefined {
  return TELUGU_LESSONS.find((l) => !done[l.id]);
}

/**
 * The lesson TODAY's Telugu block is about: a lesson completed today (so the
 * block reads done instead of jumping ahead), else the next lesson in order.
 * `lesson` is `undefined` once the whole path is complete.
 */
export function lessonForDay(
  done: TeluguLessonsDone,
  todayISO: string,
): { lesson: TeluguLesson | undefined; doneToday: boolean } {
  const today = [...TELUGU_LESSONS].reverse().find((l) => done[l.id] === todayISO);
  if (today) return { lesson: today, doneToday: true };
  return { lesson: nextLesson(done), doneToday: false };
}

/** What one item of a stage is called in the target line. @internal */
function itemNoun(stage: TeluguStage): string {
  switch (stage) {
    case 'gunintalu':
      return 'syllable';
    case 'vattulu':
      return 'conjunct';
    case 'numbers':
      return 'digit';
    case 'words':
      return 'word';
    case 'sentences':
      return 'sentence';
    default:
      return 'letter';
  }
}

/** `Lesson 3 · Vowels ఋ–ఔ`. */
export function lessonHeadline(lesson: TeluguLesson): string {
  return `Lesson ${lesson.number} · ${lesson.title}`;
}

/**
 * The explicit target, e.g. `trace each letter 3 times, then the 10-question
 * check (pass 8/10)`; the reading-only intro says to read it and mark it done.
 */
export function lessonTarget(lesson: TeluguLesson): string {
  if (lesson.glyphIds.length === 0) return 'read the intro, then tap Mark lesson done';
  const times = lesson.traceTimes === 1 ? 'once' : `${lesson.traceTimes} times`;
  return `trace each ${itemNoun(lesson.stage)} ${times}, then the ${LESSON_CHECK_SIZE}-question check (pass ${LESSON_CHECK_PASS}/${LESSON_CHECK_SIZE})`;
}

/** `Telugu lesson 3 of 19`. */
export function lessonProgressLine(lesson: TeluguLesson): string {
  return `Telugu lesson ${lesson.number} of ${TELUGU_LESSONS.length}`;
}

/** One multiple-choice question of a lesson check. */
export interface LessonQuestion {
  /** The glyph shown. */
  glyph: string;
  /** Four distinct answer options. */
  options: string[];
  /** Index of the correct option. */
  answerIndex: number;
}

/** Deterministic PRNG (mulberry32). @internal */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle with a supplied random source (copy). @internal */
function shuffled<T>(xs: readonly T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The items a lesson teaches, in order. */
export function lessonItems(lesson: TeluguLesson): LessonItem[] {
  const idx = itemIndex();
  return lesson.glyphIds.flatMap((id) => {
    const it = idx.get(id);
    return it ? [{ id: it.id, glyph: it.glyph, answer: it.answer }] : [];
  });
}

/**
 * Build a lesson's {@link LESSON_CHECK_SIZE}-question check: "what does this
 * glyph say/mean?" with 4 options (distractors from the same stage). Questions
 * cycle the lesson's items; a very small lesson (< 4 items) also reviews the
 * stage's earlier items. Deterministic in `seed`. Empty for the intro.
 */
export function buildLessonCheck(lesson: TeluguLesson, seed = 1): LessonQuestion[] {
  if (lesson.glyphIds.length === 0) return [];
  const idx = itemIndex();
  const stageItems = [...idx.values()].filter((it) => it.stage === lesson.stage);
  let pool = lessonItems(lesson);
  if (pool.length < 4) {
    const first = stageItems.findIndex((it) => it.id === lesson.glyphIds[0]);
    pool = [...pool, ...stageItems.slice(0, Math.max(0, first))];
  }
  const rand = rng(seed * 7919 + lesson.number);
  const order: LessonItem[] = [];
  while (order.length < LESSON_CHECK_SIZE) order.push(...shuffled(pool, rand));
  return order.slice(0, LESSON_CHECK_SIZE).map((item) => {
    const distractors = shuffled(
      [...new Set(stageItems.map((it) => it.answer).filter((a) => a !== item.answer))],
      rand,
    ).slice(0, 3);
    const options = shuffled([item.answer, ...distractors], rand);
    return { glyph: item.glyph, options, answerIndex: options.indexOf(item.answer) };
  });
}

/** Whether `correct` answers out of a full check is a pass. */
export function lessonCheckPassed(correct: number): boolean {
  return correct >= LESSON_CHECK_PASS;
}
