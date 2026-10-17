/**
 * Fact-universe model — the CLOSED list of facts a subtopic must teach and drill.
 *
 * A subtopic's `content/facts/<subtopicId>.json` is the CONTRACT that "complete"
 * is measured against (see `.research/plan/COMPLETENESS-BRIEF.md`): every fact is
 * harvested from the source set (syllabus clause, extracted source text, the
 * standard reference treatment, the published question universe, the AP angle),
 * then mapped to the note item that TEACHES it (`taughtIn`) and to the MCQ /
 * flashcard ids that DRILL it (`drilledBy`). The `completeness` rule in
 * `validate.ts` verifies both mappings against the real banks.
 *
 * Like the other `*-types.ts` modules the Zod schema here is the SINGLE SOURCE
 * OF TRUTH: types are derived via `z.infer`, the files are validated in the
 * loader and in `validate:content`, and `gen:schema` emits the JSON Schema.
 *
 * It is NOT a content bank: it carries no `kind`, is never registered in the
 * manifest, and is never shown to the learner as study material.
 */
import { z } from 'zod';

/** What sort of fact a row is — the brief's eight retrievable fact shapes. */
export const FactKindSchema = z.enum([
  'name',
  'place',
  'date',
  'number',
  'term',
  'pair',
  'cause',
  'classification',
]);
export type FactKind = z.infer<typeof FactKindSchema>;

/**
 * Exam yield. `high` = appears in a PYQ, is AP-specific, or is a classic trap
 * pair — high-yield facts must be drilled by at least one MCQ, not only a card.
 */
export const FactYieldSchema = z.enum(['high', 'medium', 'low']);
export type FactYield = z.infer<typeof FactYieldSchema>;

/** The five members of the brief's source set (where a fact was harvested from). */
export const FactSourceSchema = z.enum(['syllabus', 'source-text', 'standard', 'pyq', 'ap']);
export type FactSource = z.infer<typeof FactSourceSchema>;

/** One fact of the universe. */
export const FactSchema = z
  .object({
    /** Stable id, unique within the file (e.g. `sa-neo-gufkral`). */
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'fact id must be kebab-case'),
    /** The fact, as one sentence. */
    fact: z.string().min(8),
    kind: FactKindSchema,
    yield: FactYieldSchema,
    /** Which member(s) of the source set state this fact. */
    sources: z.array(FactSourceSchema).min(1),
    /**
     * OPTIONAL explicit key tokens — the words/numbers that identify this fact
     * (e.g. `["Gufkral", "Kashmir"]`). When present, ALL of them must appear
     * (case-insensitive) in the teaching note and in each drilling item. When
     * absent, the key tokens are derived from `fact` and at least half must
     * appear (the same threshold as the question-alignment heuristic).
     */
    keys: z.array(z.string().min(1)).min(1).optional(),
    /** Id of the note item (same subtopic) that teaches the fact. */
    taughtIn: z.string().min(1).optional(),
    /** Ids of MCQs / flashcards (same subtopic) that ask for the fact. */
    drilledBy: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type Fact = z.infer<typeof FactSchema>;

/** A whole `content/facts/<subtopicId>.json` file. */
export const FactsFileSchema = z
  .object({
    version: z.number().int().positive(),
    subtopicId: z.string().min(1),
    facts: z.array(FactSchema).min(1),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.facts.forEach((f, i) => {
      if (seen.has(f.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['facts', i, 'id'], message: `duplicate fact id '${f.id}'` });
      }
      seen.add(f.id);
    });
  });
export type FactsFile = z.infer<typeof FactsFileSchema>;

/** Parse + validate a facts file, throwing a readable error on failure. */
export function parseFacts(json: unknown): FactsFile {
  const result = FactsFileSchema.safeParse(json);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`invalid facts file: ${msg}`);
  }
  return result.data;
}
