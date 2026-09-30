/**
 * Taxonomy model — the subject → chapter → subtopic tree the whole syllabus is
 * organised under.
 *
 * Like `types.ts`, the Zod schema here is the single source of truth: the
 * TypeScript types are derived via `z.infer`, and `content/taxonomy.json` is
 * validated against it at load (loader) and in the content gate (validate.ts).
 *
 * The taxonomy carries only LABELS + ORDER + priority band; it holds NO content
 * items. The loader MERGES it with the discovered banks (grouped by
 * `subtopicId`) so each subtopic gains its notes/MCQs/mains and derived coverage.
 */
import { z } from 'zod';
import { SubjectCodeSchema } from './types';

/**
 * Priority band by exam weight: `A` (highest) … `D`. Band drives the target MCQ
 * count used for coverage and the default priority sort in the tracker.
 */
export const BandSchema = z.enum(['A', 'B', 'C', 'D']);
/** Priority band union: `'A' | 'B' | 'C' | 'D'`. */
export type Band = z.infer<typeof BandSchema>;

/**
 * Which exam TRACK a subject belongs to — the axis the two-paper Prelims plan
 * is organised around:
 *
 *   - `paper1` — Screening Paper-I THEORY subjects (History, Polity, Economy,
 *     Geography). Counts toward the Prelims deadline.
 *   - `paper2` — Screening Paper-II APTITUDE subjects (Mental Ability, Science &
 *     Technology, Current Events). Counts toward the Prelims deadline.
 *   - `mains` — the descriptive Mains / qualifying-language subjects (Telugu,
 *     English & Essay). A PARALLEL track that continues AFTER Prelims and is
 *     EXCLUDED from the 15-Nov Prelims feasibility math.
 *
 * Optional + backward-compatible: taxonomies authored before tracks existed
 * still validate (a subject with no `track` is simply untracked).
 */
export const TrackSchema = z.enum(['paper1', 'paper2', 'mains']);
/** Exam-track union: `'paper1' | 'paper2' | 'mains'`. */
export type Track = z.infer<typeof TrackSchema>;

/** A top-level subject in the taxonomy (mirrors a stable `SubjectCode`). */
export const TaxonomySubjectSchema = z.object({
  code: SubjectCodeSchema,
  name: z.string(),
  order: z.number(),
  /** Exam track this subject belongs to (see {@link TrackSchema}). Optional. */
  track: TrackSchema.optional(),
});
export type TaxonomySubject = z.infer<typeof TaxonomySubjectSchema>;

/** A chapter grouping subtopics within one subject. */
export const TaxonomyChapterSchema = z.object({
  id: z.string(),
  subjectCode: SubjectCodeSchema,
  name: z.string(),
  order: z.number(),
});
export type TaxonomyChapter = z.infer<typeof TaxonomyChapterSchema>;

/**
 * A subtopic — the unit a learner navigates to (the Learn workspace). `band`
 * and `syllabusRef` are optional; `order` is the chronological/teaching order
 * within its chapter.
 */
export const TaxonomySubtopicSchema = z.object({
  id: z.string(),
  subjectCode: SubjectCodeSchema,
  chapterId: z.string(),
  name: z.string(),
  order: z.number(),
  band: BandSchema.optional(),
  /**
   * OPTIONAL per-subtopic exam TRACK override. When present it takes precedence
   * over the subtopic's subject track — used for subtopics that sit under a
   * Prelims subject but belong to the parallel MAINS track (e.g. the Mains
   * Paper-III Ethics/Law/Public-Administration subtopics filed under POL).
   * Backward-compatible: absent → the subject's track applies.
   */
  track: TrackSchema.optional(),
  /** Optional link to a `SyllabusNode.id` (the official-syllabus screening node). */
  syllabusRef: z.string().optional(),
  /**
   * OPTIONAL examinable-points checklist for this subtopic — the discrete
   * points a well-prepared candidate must be able to answer. When present it
   * REDEFINES coverage: a subtopic is 100% covered once every exam-point is
   * tested by at least one MCQ (`MCQItem.covers[]`). Only deliberately-authored
   * subtopics populate it; the rest leave it absent and fall back to the
   * band-target coverage estimate. Backward-compatible.
   */
  examPoints: z.array(z.string()).optional(),
});
export type TaxonomySubtopic = z.infer<typeof TaxonomySubtopicSchema>;

/** The full taxonomy tree: subjects, chapters, and subtopics (flat arrays). */
export const TaxonomySchema = z.object({
  subjects: z.array(TaxonomySubjectSchema),
  chapters: z.array(TaxonomyChapterSchema),
  subtopics: z.array(TaxonomySubtopicSchema),
});
export type Taxonomy = z.infer<typeof TaxonomySchema>;

/**
 * Format a Zod error into a compact, human-readable message.
 * @internal
 */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/**
 * Parse an unknown value as the taxonomy.
 * @throws Error with a clear message when validation fails.
 */
export function parseTaxonomy(json: unknown): Taxonomy {
  const result = TaxonomySchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid taxonomy — ${formatIssues(result.error)}`);
  }
  return result.data;
}
