/**
 * Learning-sequence model — the PEDAGOGICAL study ORDER for every Prelims
 * subject: the sequence a learner should study subtopics in so that each one
 * builds on the ones before it (chronology for History, concept prerequisites
 * everywhere else).
 *
 * Like {@link ./types.ts}, {@link ./taxonomy.ts} and {@link ./audit-types.ts},
 * the Zod schema here is the SINGLE SOURCE OF TRUTH: the TypeScript types are
 * derived via `z.infer`, and `content/plan/learning-sequence.json` is validated
 * against it at load (loader) and in the content gate (validate.ts).
 *
 * This is NOT a content bank (it holds no MCQs/notes/mains) and NOT the planner
 * schedule (the planner in `src/engine/planner.ts` fits scope to a time budget).
 * It is a pure ordering + dependency graph over taxonomy subtopic ids:
 *
 *   - Each subject maps to an ordered list of steps.
 *   - Every Prelims subtopic of that subject appears EXACTLY ONCE, in the order
 *     it should be studied.
 *   - `prereqs` lists the TRUE dependencies of a step — subtopics that must be
 *     understood first — and may only reference ids that appear EARLIER in the
 *     same subject's list (enforced in validate.ts). An empty list = no
 *     dependency (a natural entry point).
 *   - `stream` is a Mental-Ability-only lane tag (quant / reasoning / abilities)
 *     so the interleaved MENT order can still be read as three parallel chains.
 *   - `why` is a one-line human justification for the placement.
 *
 * The subject keys are the seven PRELIMS subjects only (the two Mains-track
 * qualifying-language subjects, TEL/ENG, are intentionally excluded).
 */
import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Streams (Mental Ability lanes)                                              */
/* -------------------------------------------------------------------------- */

/**
 * The three parallel MENT lanes. Only Mental-Ability steps carry a `stream`;
 * every other subject omits it. Kept as a closed enum so a typo fails the gate.
 */
export const LearningStreamSchema = z.enum(['quant', 'reasoning', 'abilities']);
/** Union of MENT stream tags: `'quant' | 'reasoning' | 'abilities'`. */
export type LearningStream = z.infer<typeof LearningStreamSchema>;

/**
 * The two parallel HISTORY chronological streams. History is scheduled as two
 * independent chronological chains so its high-yield Modern + AP topics no
 * longer land last: `early` = ancient + medieval + AP early dynasties; `modern`
 * = modern + AP freedom/statehood + art & culture. Only History steps carry an
 * `early`/`modern` tag.
 */
export const HistStreamSchema = z.enum(['early', 'modern']);
/** Union of History stream tags: `'early' | 'modern'`. */
export type HistStream = z.infer<typeof HistStreamSchema>;

/**
 * The `stream` field on a step: a MENT lane (`quant`/`reasoning`/`abilities`)
 * OR a History chronological stream (`early`/`modern`). Every other subject
 * omits it. Kept as a closed union so a typo fails the gate.
 */
export const StepStreamSchema = z.union([LearningStreamSchema, HistStreamSchema]);
/** Union of all step stream tags (MENT lanes + History streams). */
export type StepStream = z.infer<typeof StepStreamSchema>;

/* -------------------------------------------------------------------------- */
/* Step                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One step in a subject's learning order: a taxonomy subtopic id, the earlier
 * ids it truly depends on, an optional MENT stream tag, and a one-line reason.
 */
export const LearningStepSchema = z.object({
  /** Taxonomy subtopic id this step teaches (must be a real Prelims subtopic). */
  id: z.string().min(1),
  /**
   * True dependencies — ids that must be studied first. May only reference ids
   * appearing EARLIER in the same subject's list (checked in validate.ts).
   * Empty = a natural entry point with no prerequisite.
   */
  prereqs: z.array(z.string().min(1)),
  /** MENT lane (`quant`/`reasoning`/`abilities`) or History stream (`early`/`modern`); omitted elsewhere. */
  stream: StepStreamSchema.optional(),
  /** One-line human justification for this placement. */
  why: z.string().min(1),
});
export type LearningStep = z.infer<typeof LearningStepSchema>;

/* -------------------------------------------------------------------------- */
/* Sequence                                                                    */
/* -------------------------------------------------------------------------- */

/** An ordered list of steps for one subject. */
export const LearningStepListSchema = z.array(LearningStepSchema);

/**
 * The whole learning sequence: a version tag plus one ordered step list per
 * PRELIMS subject. Only the seven Prelims subject codes are keys (TEL/ENG are
 * Mains-track and excluded). Each list is validated for completeness and
 * dependency-ordering against the taxonomy in `validate.ts`.
 */
export const LearningSequenceSchema = z.object({
  /** Schema/version tag so the file can evolve compatibly. */
  version: z.number().int().positive(),
  /** Per-subject ordered study sequences (Prelims subjects only). */
  subjects: z.object({
    HIST: LearningStepListSchema,
    POL: LearningStepListSchema,
    ECON: LearningStepListSchema,
    GEO: LearningStepListSchema,
    SCI: LearningStepListSchema,
    MENT: LearningStepListSchema,
    CA: LearningStepListSchema,
  }),
});
/** The whole learning-sequence document. */
export type LearningSequence = z.infer<typeof LearningSequenceSchema>;

/**
 * The Prelims subject codes the learning sequence covers, in study order. Kept
 * as a tuple so callers can iterate deterministically.
 */
export const LEARNING_SEQUENCE_SUBJECTS = [
  'HIST',
  'POL',
  'ECON',
  'GEO',
  'SCI',
  'MENT',
  'CA',
] as const;
/** Union of the learning-sequence subject keys. */
export type LearningSequenceSubject = (typeof LEARNING_SEQUENCE_SUBJECTS)[number];

/* -------------------------------------------------------------------------- */
/* Parse helper                                                                */
/* -------------------------------------------------------------------------- */

/** Format a Zod error into a compact, human-readable message. @internal */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/**
 * Parse an unknown value as the learning sequence.
 * @throws Error with a clear message when validation fails.
 */
export function parseLearningSequence(json: unknown): LearningSequence {
  const result = LearningSequenceSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid learning sequence — ${formatIssues(result.error)}`);
  }
  return result.data;
}
