/**
 * Mains answer-writing helpers — PURE functions (no DOM, no I/O) that turn the
 * static {@link MAINS_GUIDE} pedagogy plus a practice {@link MainsItem} into
 * concrete, deterministic writing scaffolds and self-scores.
 *
 * These power the Mains view's "how to write" tooling: detect the directive a
 * question uses, expand a question's key points into an Intro/Body/Conclusion
 * skeleton, and turn a learner's rubric self-scores into a total + band. They
 * import ONLY the guide data (the single source of truth for directive keywords
 * and rubric bands), so they stay trivially unit-testable.
 */
import type { MainsItem } from '../content/types';
import { DIRECTIVES, RUBRIC } from '../content/mains-guide';

/* -------------------------------------------------------------------------- */
/* detectDirective                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Flattened (matcher → canonical keyword) pairs, sorted so the LONGEST matcher
 * phrase is tested first. This guarantees compound directives win over their
 * bare forms — e.g. "critically examine" resolves to
 * "Critically examine / analyse" rather than to "Examine".
 * @internal
 */
const MATCHERS: ReadonlyArray<{ phrase: string; keyword: string }> = DIRECTIVES.flatMap(
  (d) => d.matchers.map((phrase) => ({ phrase: phrase.toLowerCase(), keyword: d.keyword })),
).sort((a, b) => b.phrase.length - a.phrase.length);

/**
 * Detect which directive command-word a question uses.
 *
 * Case-insensitive; scans for the most specific (longest) matcher first so
 * "critically examine …" maps to the critical directive, not plain "examine".
 *
 * @returns the canonical directive keyword (e.g. `'Discuss'`), or `undefined`
 *          when no known directive is present.
 */
export function detectDirective(question: string): string | undefined {
  const q = question.toLowerCase();
  for (const { phrase, keyword } of MATCHERS) {
    if (q.includes(phrase)) return keyword;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* buildFramework                                                              */
/* -------------------------------------------------------------------------- */

/** An Intro / Body / Conclusion answer skeleton as bullet lists. */
export interface Framework {
  intro: string[];
  body: string[];
  conclusion: string[];
}

/** Fallback multi-dimensional prompts when an item carries no key points. */
const FALLBACK_BODY: readonly string[] = [
  'Develop the social / cultural dimension with an example.',
  'Develop the economic dimension with data or a case.',
  'Develop the political / administrative dimension.',
  'Add the legal/constitutional or environmental angle where relevant.',
];

/**
 * Turn a {@link MainsItem} into a deterministic Intro/Body/Conclusion skeleton.
 *
 * The body is built from the item's `keyPoints` (one develop-prompt per point),
 * falling back to the standard multi-dimensional lenses when none are authored.
 * The intro and conclusion adapt to the detected directive. Fully deterministic
 * — the same item always yields the same skeleton.
 */
export function buildFramework(item: MainsItem): Framework {
  const directive = detectDirective(item.question);
  const points = item.keyPoints ?? [];

  const intro: string[] = [
    'Define / contextualise the central term(s) in the question.',
    directive
      ? `State the line the answer will take, as the directive "${directive}" demands.`
      : 'State the line the answer will take and preview the structure.',
  ];

  const body: string[] =
    points.length > 0
      ? points.map((p) => `Develop: ${p}`)
      : [...FALLBACK_BODY];

  const conclusion: string[] = [
    'Summarise into a balanced judgement that answers the question.',
    'Close with a concrete way-forward or forward-looking note.',
  ];

  return { intro, body, conclusion };
}

/* -------------------------------------------------------------------------- */
/* scoreRubric                                                                 */
/* -------------------------------------------------------------------------- */

/** A rubric total paired with the band label it falls into. */
export interface RubricResult {
  total: number;
  band: string;
}

/**
 * Sum a learner's per-criterion self-scores into a total and resolve its band.
 *
 * Each score is clamped to the valid 0–{@link RUBRIC} criterion max (2) so a
 * stray out-of-range value cannot distort the total. The band is the first
 * {@link RUBRIC.bands} entry (ordered high→low) whose `min` the total meets.
 */
export function scoreRubric(scores: number[]): RubricResult {
  const perMax = RUBRIC.criteria[0]?.max ?? 2;
  const total = scores.reduce((sum, raw) => {
    const s = Number.isFinite(raw) ? raw : 0;
    return sum + Math.max(0, Math.min(perMax, s));
  }, 0);

  const band = RUBRIC.bands.find((b) => total >= b.min)?.label ?? 'Needs work';
  return { total, band };
}

/* -------------------------------------------------------------------------- */
/* countWords                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Count the words in a block of free text — the live word budget the Mains
 * practice textarea shows against the {@link PRESENTATION_GUIDE} budget.
 *
 * Whitespace-delimited: any run of spaces, tabs or newlines separates words, and
 * leading/trailing whitespace is ignored, so empty or blank input is `0`.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}
