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
import type { ExamPattern, ExamSection, PaperId } from '../lib/exam-pattern';
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

/* -------------------------------------------------------------------------- */
/* WEEK TEST — a short, beginner-friendly Saturday test over STUDIED topics    */
/* -------------------------------------------------------------------------- */

/**
 * The KIND of a scheduled Saturday test event:
 *   - `week-test`      — a first-pass Saturday: a short (45-Q / 55-min) timed
 *     test drawn ONLY from topics first-passed on or before that Saturday.
 *   - `dress-rehearsal` — the ONE full 120-Q mock in the first pass (nearest the
 *     coverage midpoint): a chance to practise the 2-hour format; score is not
 *     the point yet.
 *   - `full`           — a full 120-Q official-paper mock (revision cycle + final
 *     window), where the score matters.
 */
export type MockKind = 'week-test' | 'dress-rehearsal' | 'full';

/**
 * The week-test question pools, split by {@link PaperId} and by WHEN the topic
 * was first-passed: `thisWeek` (first-passed in the 7 days ending that Saturday)
 * vs `earlier` (first-passed before that). The draw favours this week ~2/3 and
 * earlier ~1/3, and keeps Paper-I / Paper-II in proportion to what was covered.
 */
export interface WeekTestPools {
  thisWeek: Readonly<Record<PaperId, readonly MCQItem[]>>;
  earlier: Readonly<Record<PaperId, readonly MCQItem[]>>;
}

/** One Saturday's week-test inputs: its date (the deterministic seed) + pools. */
export interface WeekTestInput extends WeekTestPools {
  dateISO: string;
}

/** Tunables for a week test (defaults match the beginner spec: 45 Q / 55 min). */
export interface WeekTestOptions {
  /** Target question count (default {@link WEEK_TEST_COUNT}). */
  count?: number;
  /** Timer minutes (default {@link WEEK_TEST_MINUTES}). */
  durationMin?: number;
  /** Share of questions drawn from THIS week's topics (default 2/3). */
  thisWeekRatio?: number;
}

/** Default question count for a week test. */
export const WEEK_TEST_COUNT = 45;
/** Default timer minutes for a week test. */
export const WEEK_TEST_MINUTES = 55;
/** Default share of a week test drawn from the current week's topics. */
export const WEEK_TEST_THIS_WEEK_RATIO = 2 / 3;

/** The two papers, in a stable order. @internal */
const PAPERS: readonly PaperId[] = ['paper1', 'paper2'];

/** A fully assembled week test (a scoped, timed mini-mock). */
export interface BuiltWeekTest {
  dateISO: string;
  /** Questions actually drawn (≤ `requested` when the studied pool is small). */
  count: number;
  /** The requested target count. */
  requested: number;
  /** Timer minutes. */
  durationMin: number;
  /** The drawn questions, in presentation order. */
  items: MCQItem[];
  /** `paper1` / `paper2` for each flattened item (the "section" it scores in). */
  sectionByIndex: PaperId[];
  /** True when the studied pool was too small to fill the requested count. */
  short: boolean;
}

/**
 * Deterministically pick `n` items from `pool`, PREFERRING ids not in `exclude`
 * (so a question is not reused across week tests while the pool still has fresh
 * ones), then falling back to excluded ids when the fresh supply runs out. The
 * pool is shuffled once with `seed`. @internal
 */
function pickPreferringFresh(
  pool: readonly MCQItem[],
  n: number,
  seed: number,
  exclude: ReadonlySet<string>,
): MCQItem[] {
  if (n <= 0 || pool.length === 0) return [];
  const shuffled = shuffle(pool, mulberry32(seed));
  const fresh: MCQItem[] = [];
  const used: MCQItem[] = [];
  for (const it of shuffled) (exclude.has(it.id) ? used : fresh).push(it);
  const out = fresh.slice(0, n);
  if (out.length < n) out.push(...used.slice(0, n - out.length));
  return out;
}

/**
 * Build ONE week test from its `input` pools. Deterministic in `input.dateISO`
 * (the seed) and `opts`. `exclude` holds question ids already used by EARLIER
 * week tests, so the draw avoids repeats while the pool allows it.
 *
 * The split: ~`thisWeekRatio` of the paper's quota from `thisWeek`, the rest
 * from `earlier`; the Paper-I / Paper-II quotas track the proportion of covered
 * questions in each paper. Short buckets borrow from the other bucket of the
 * same paper, then from the other paper, so the test fills whenever the overall
 * studied pool is large enough.
 */
export function buildWeekTest(
  input: WeekTestInput,
  opts: WeekTestOptions = {},
  exclude: ReadonlySet<string> = new Set(),
): BuiltWeekTest {
  const requested = Math.max(0, Math.floor(opts.count ?? WEEK_TEST_COUNT));
  const durationMin = Math.max(1, Math.floor(opts.durationMin ?? WEEK_TEST_MINUTES));
  const ratio = opts.thisWeekRatio ?? WEEK_TEST_THIS_WEEK_RATIO;
  const seedBase = hashSeed(input.dateISO);

  const availOf = (p: PaperId): number => input.thisWeek[p].length + input.earlier[p].length;
  const totalAvail = PAPERS.reduce((a, p) => a + availOf(p), 0);
  const empty: BuiltWeekTest = {
    dateISO: input.dateISO,
    count: 0,
    requested,
    durationMin,
    items: [],
    sectionByIndex: [],
    short: requested > 0,
  };
  if (totalAvail === 0 || requested === 0) return empty;

  // ---- Paper quotas, proportional to covered questions, bounded by supply ---
  const want = Math.min(requested, totalAvail);
  const target: Record<PaperId, number> = { paper1: 0, paper2: 0 };
  target.paper1 = Math.min(availOf('paper1'), Math.round((want * availOf('paper1')) / totalAvail));
  target.paper2 = Math.min(availOf('paper2'), want - target.paper1);
  // Reallocate any slack (rounding / one paper short) to the other paper.
  let slack = want - (target.paper1 + target.paper2);
  for (const p of PAPERS) {
    if (slack <= 0) break;
    const room = availOf(p) - target[p];
    const add = Math.min(room, slack);
    target[p] += add;
    slack -= add;
  }

  // ---- Draw each paper: ~ratio from this week, the rest from earlier --------
  const chosen: Array<{ item: MCQItem; paper: PaperId }> = [];
  const localExclude = new Set(exclude);
  for (const p of PAPERS) {
    const t = target[p];
    if (t <= 0) continue;
    const twPool = input.thisWeek[p];
    const eaPool = input.earlier[p];
    let twWant = Math.min(twPool.length, Math.round(t * ratio));
    let eaWant = Math.min(eaPool.length, t - twWant);
    // If one bucket is short, let the other take the remainder.
    twWant = Math.min(twPool.length, t - eaWant);
    eaWant = Math.min(eaPool.length, t - twWant);
    const picks = [
      ...pickPreferringFresh(twPool, twWant, seedBase ^ hashSeed(`${p}:tw`), localExclude),
      ...pickPreferringFresh(eaPool, eaWant, seedBase ^ hashSeed(`${p}:ea`), localExclude),
    ];
    for (const item of picks) {
      chosen.push({ item, paper: p });
      localExclude.add(item.id); // never pick the same id twice within one test
    }
  }

  // ---- Present in a deterministic mixed order -------------------------------
  const order = shuffle(chosen, mulberry32(seedBase ^ hashSeed('order')));
  return {
    dateISO: input.dateISO,
    count: order.length,
    requested,
    durationMin,
    items: order.map((c) => c.item),
    sectionByIndex: order.map((c) => c.paper),
    short: order.length < requested,
  };
}

/**
 * Build the WHOLE week-test series in date order, threading a running `used`
 * set so questions do not repeat across tests while the growing studied pool
 * still has fresh ones. Returns `dateISO → BuiltWeekTest`. Pure + deterministic.
 */
export function buildWeekTestSeries(
  inputs: readonly WeekTestInput[],
  opts: WeekTestOptions = {},
): Map<string, BuiltWeekTest> {
  const out = new Map<string, BuiltWeekTest>();
  const used = new Set<string>();
  for (const input of [...inputs].sort((a, b) => a.dateISO.localeCompare(b.dateISO))) {
    const test = buildWeekTest(input, opts, used);
    out.set(input.dateISO, test);
    for (const it of test.items) used.add(it.id);
  }
  return out;
}

/** One paper's score within a week-test result. */
export interface WeekTestSectionScore {
  paper: PaperId;
  label: string;
  score: MockScore;
  net: number;
}

/** A week test's per-paper + overall net-marks breakdown. */
export interface WeekTestResult {
  sections: WeekTestSectionScore[];
  overall: MockScore;
}

/** Human label for a paper in week-test results. @internal */
const PAPER_LABEL: Record<PaperId, string> = {
  paper1: 'Paper-I (General Studies)',
  paper2: 'Paper-II (Aptitude)',
};

/**
 * Score a built week test against `selected` (option index or `null` for a
 * blank), producing PER-PAPER net marks plus the overall aggregate — the same
 * −1/3 negative marking and per-section net surface as a full mock's results.
 */
export function scoreWeekTest(
  test: BuiltWeekTest,
  selected: ReadonlyArray<number | null>,
): WeekTestResult {
  const perPaper = new Map<PaperId, MockAnswer[]>();
  const overall: MockAnswer[] = [];
  test.items.forEach((item, i) => {
    const sel = selected[i];
    const attempted = sel !== null && sel !== undefined;
    const ans: MockAnswer = { attempted, correct: attempted && sel === item.answerIndex };
    overall.push(ans);
    const p = test.sectionByIndex[i]!;
    const bucket = perPaper.get(p) ?? [];
    bucket.push(ans);
    perPaper.set(p, bucket);
  });
  const sections: WeekTestSectionScore[] = PAPERS.filter((p) => (perPaper.get(p) ?? []).length > 0).map(
    (p) => {
      const score = mockScore(perPaper.get(p) ?? []);
      return { paper: p, label: PAPER_LABEL[p], score, net: score.net };
    },
  );
  return { sections, overall: mockScore(overall) };
}
