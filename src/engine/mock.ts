/**
 * Full-length + sectional MOCK builder — PURE functions only (no DOM, no
 * storage, no loader).
 *
 * A mock reproduces the official Screening pattern (see {@link ExamPattern}):
 * it draws a proportionate paper from the content pools BY SECTION WEIGHT
 * (Paper-I = 30/30/30/30; Paper-II = 60/30/30), so the assembled paper always
 * matches the real count / section split / marks / negative-marking rule.
 *
 * SERIES WITHOUT REPEATS: each section's pool is given ONE deterministic seeded
 * shuffle (stable across the whole series), then Mock N takes the Nth
 * consecutive, disjoint WINDOW of that shuffle. So Mock 1, Mock 2, … draw
 * different questions until a section's pool is exhausted, at which point it
 * wraps (a section only wraps once N exceeds {@link mockSeriesLength}, which the
 * UI surfaces). Identical inputs always yield an identical paper, so the whole
 * thing is trivially unit-testable with fixtures.
 *
 * The engine takes the section pools as an INPUT (a `subjectCode → MCQItem[]`
 * map) rather than importing the loader, keeping it pure; the view/bridge layer
 * supplies the real pools.
 */
import type { MCQItem } from '../content/types';
import type { ExamPattern, ExamSection } from '../lib/exam-pattern';
import { type MockAnswer, mockScore, type MockScore } from '../lib/metrics';

/** Section pools keyed by the section's `subjectCode`. */
export type SectionPools = Readonly<Record<string, readonly MCQItem[]>>;

/** One assembled section of a built mock: its spec + the drawn questions. */
export interface BuiltMockSection {
  section: ExamSection;
  items: MCQItem[];
  /**
   * True when the section's pool was too small for a fully non-repeating draw
   * at this mock number and had to WRAP (reuse earlier questions). Honest flag
   * the UI can surface.
   */
  wrapped: boolean;
}

/** A fully assembled mock paper. */
export interface BuiltMock {
  pattern: ExamPattern;
  /** 1-based mock number within the series. */
  mockNumber: number;
  sections: BuiltMockSection[];
  /** All questions flattened in section order (the running order). */
  items: MCQItem[];
  /** Map from a question's index in `items` → the section it belongs to. */
  sectionByIndex: string[];
}

/**
 * djb2 string hash → unsigned 32-bit int, for deriving a stable per-section
 * shuffle seed that does not collide across sections. @internal
 */
function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/** Small, fast seeded PRNG (mulberry32) → deterministic shuffles. @internal */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle using the supplied RNG; returns a new array. @internal */
function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/**
 * Draw `count` questions for one section at 1-based `mockNumber` from `pool`.
 * The pool is shuffled ONCE with a stable per-section seed (so the whole series
 * shares the same shuffle), then the Nth disjoint window `[start, start+count)`
 * is taken with wrap-around when the pool is exhausted. Deterministic.
 * @internal
 */
function drawSection(
  section: ExamSection,
  pool: readonly MCQItem[],
  mockNumber: number,
  saltSeed: number,
): BuiltMockSection {
  const size = pool.length;
  const want = section.count;
  if (size === 0 || want <= 0) {
    return { section, items: [], wrapped: false };
  }
  const seed = (hashSeed(section.id) ^ saltSeed) >>> 0;
  const shuffled = shuffle(pool, mulberry32(seed));
  const start = ((mockNumber - 1) * want) % size;
  const items: MCQItem[] = [];
  let wrapped = false;
  for (let k = 0; k < want; k += 1) {
    // When `want` exceeds the pool, or a window runs off the end, we wrap to
    // the front — honestly flagged so the UI can note the reuse.
    const at = start + k;
    if (at >= size) wrapped = true;
    items.push(shuffled[at % size]!);
  }
  // A section whose pool is smaller than `want` also inevitably repeats.
  if (want > size) wrapped = true;
  return { section, items, wrapped };
}

/**
 * Build a full-length mock paper for `pattern` at 1-based `mockNumber`, drawing
 * each section from its pool by weight. `saltSeed` (default 0) lets a caller
 * request an independent series (e.g. a "shuffled retake") while staying
 * deterministic. Sections with no pool contribute no questions (honest — the
 * total simply reflects the material that exists).
 */
export function buildPaperMock(
  pattern: ExamPattern,
  pools: SectionPools,
  mockNumber = 1,
  saltSeed = 0,
): BuiltMock {
  const n = Math.max(1, Math.floor(mockNumber));
  const sections: BuiltMockSection[] = pattern.sections.map((section) =>
    drawSection(section, pools[section.subjectCode] ?? [], n, saltSeed),
  );
  const items: MCQItem[] = [];
  const sectionByIndex: string[] = [];
  for (const s of sections) {
    for (const item of s.items) {
      items.push(item);
      sectionByIndex.push(s.section.id);
    }
  }
  return { pattern, mockNumber: n, sections, items, sectionByIndex };
}

/**
 * How many fully NON-REPEATING mocks the current pools support for `pattern`:
 * the minimum over its sections of `floor(pool ÷ sectionCount)`, floored at 1.
 * A section with an empty pool is ignored (it contributes 0 questions rather
 * than capping the whole series at 0). When EVERY section is empty, returns 1.
 */
export function mockSeriesLength(pattern: ExamPattern, pools: SectionPools): number {
  let min = Infinity;
  for (const section of pattern.sections) {
    if (section.count <= 0) continue;
    const size = (pools[section.subjectCode] ?? []).length;
    if (size === 0) continue; // empty pools don't cap the series
    min = Math.min(min, Math.floor(size / section.count));
  }
  if (!Number.isFinite(min)) return 1;
  return Math.max(1, min);
}

/** A single section's score within a mock result. */
export interface MockSectionScore {
  section: ExamSection;
  score: MockScore;
  /** Net marks for the section = correct − wrong/3 (see {@link mockScore}). */
  net: number;
}

/** The full per-section + overall breakdown a mock RESULTS screen renders. */
export interface MockResult {
  sections: MockSectionScore[];
  /** Overall score across every question in the paper. */
  overall: MockScore;
}

/**
 * Score a built mock against the learner's `selected` options (index or `null`
 * for a blank), producing PER-SECTION scores plus the overall aggregate. Pure;
 * delegates every tally to {@link mockScore} so section and overall figures can
 * never disagree with the rest of the app's scoring.
 */
export function scorePaperMock(
  mock: BuiltMock,
  selected: ReadonlyArray<number | null>,
): MockResult {
  const perSection = new Map<string, MockAnswer[]>();
  const overallAnswers: MockAnswer[] = [];

  mock.items.forEach((item, i) => {
    const sel = selected[i];
    const attempted = sel !== null && sel !== undefined;
    const ans: MockAnswer = { attempted, correct: attempted && sel === item.answerIndex };
    overallAnswers.push(ans);
    const sid = mock.sectionByIndex[i]!;
    const bucket = perSection.get(sid) ?? [];
    bucket.push(ans);
    perSection.set(sid, bucket);
  });

  const sections: MockSectionScore[] = mock.sections.map((s) => {
    const answers = perSection.get(s.section.id) ?? [];
    const score = mockScore(answers);
    return { section: s.section, score, net: score.net };
  });

  return { sections, overall: mockScore(overallAnswers) };
}
