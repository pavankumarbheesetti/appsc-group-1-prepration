/**
 * Audit model — Zod schemas + inferred types for the INDEPENDENT coverage audit.
 *
 * The whole point of the audit is to measure coverage against the OFFICIAL
 * SYLLABUS (Notification 07/2026) and the PAST-YEAR QUESTIONS (PYQs), NOT against
 * the authors' own `examPoints`. Two authored maps under `content/audit/` drive
 * it, and (exactly like `types.ts` / `taxonomy.ts`) the Zod schema here is the
 * SINGLE SOURCE OF TRUTH — the TypeScript types are derived via `z.infer`, the
 * JSON files are validated against it in `validate:content` (the CI gate) and at
 * runtime in the loader, and the generated JSON Schema (`gen:schema`) is emitted
 * from these same objects so nothing drifts.
 *
 *   - `content/audit/syllabus-map.json` — every official syllabus CLAUSE mapped
 *     to the taxonomy subtopics that should cover it, plus the KEYWORDS that must
 *     appear in that content as machine-checkable evidence.
 *   - `content/audit/pyq-map.json` — de-duplicated PYQ topic GISTS (never verbatim
 *     copyrighted stems), each mapped to the subtopic whose MCQs should answer it.
 */
import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Audit papers                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The nine APPSC Group-1 papers the audit reasons about, in the audit's own
 * stable vocabulary (distinct from the app's internal `Paper` enum so the two
 * can evolve independently):
 *   - `prelims-1` / `prelims-2` — the two objective Screening papers.
 *   - `mains-telugu` / `mains-english` — the qualifying language papers.
 *   - `mains-1`..`mains-5` — the five descriptive Mains papers (Essay + I–V).
 */
export const AUDIT_PAPERS = [
  'prelims-1',
  'prelims-2',
  'mains-telugu',
  'mains-english',
  'mains-1',
  'mains-2',
  'mains-3',
  'mains-4',
  'mains-5',
] as const;

/** Zod enum of audit papers. */
export const AuditPaperSchema = z.enum(AUDIT_PAPERS);
/** Union of audit-paper identifiers. */
export type AuditPaper = z.infer<typeof AuditPaperSchema>;

/** True for the two objective Screening (Prelims) papers — they gate CI. */
export function isPrelimsPaper(paper: AuditPaper): boolean {
  return paper === 'prelims-1' || paper === 'prelims-2';
}

/* -------------------------------------------------------------------------- */
/* Syllabus map                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One official-syllabus CLAUSE mapped to the content that should cover it.
 *
 * `subtopicIds` may be EMPTY — that deliberately encodes a true content gap
 * (the clause is in the syllabus but nothing in the taxonomy covers it yet), and
 * the auditor will mark it MISSING. `keywords` are the specific terms that must
 * appear in the mapped subtopics' MCQ / notes / mains text as EVIDENCE the clause
 * is really taught (not just nominally mapped); at least one is required.
 */
export const SyllabusMapClauseSchema = z.object({
  /** Stable clause id, mirroring the audit research (e.g. "P1-A-1", "M3-11"). */
  ref: z.string().min(1),
  /** Which paper the clause belongs to. */
  paper: AuditPaperSchema,
  /** Short paraphrase of the clause (paraphrase OK — never verbatim required). */
  clause: z.string().min(1),
  /** Taxonomy subtopic ids expected to cover the clause; empty = true gap. */
  subtopicIds: z.array(z.string().min(1)),
  /** Terms that MUST appear in the mapped content as coverage evidence. */
  keywords: z.array(z.string().min(1)).min(1),
  /** True when the clause is Andhra-Pradesh-specific ("with special reference to AP"). */
  apSpecific: z.boolean(),
});
export type SyllabusMapClause = z.infer<typeof SyllabusMapClauseSchema>;

/** The whole syllabus map: a flat list of clauses (order is presentation-only). */
export const SyllabusMapSchema = z.array(SyllabusMapClauseSchema);
export type SyllabusMap = z.infer<typeof SyllabusMapSchema>;

/* -------------------------------------------------------------------------- */
/* PYQ map                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One PYQ topic GIST mapped to the subtopic whose MCQs should answer it.
 *
 * `years` is a list because the same recurring topic appears across multiple
 * exam years; `gist` is a short paraphrase of what was asked (NEVER the verbatim
 * copyrighted question). `keywords` are checked against the mapped subtopic's
 * MCQs to classify the topic HIT / NEAR / MISS.
 */
export const PyqMapEntrySchema = z.object({
  /** Exam years the topic recurs in (at least one). */
  years: z.array(z.number().int()).min(1),
  /** The Screening paper the topic appeared in. */
  paper: AuditPaperSchema,
  /** Human subject label (free text, e.g. "History", "Mental Ability"). */
  subject: z.string().min(1),
  /** Short paraphrase of the asked topic — no verbatim copyrighted text. */
  gist: z.string().min(1),
  /** Terms checked against the mapped subtopic's MCQs as evidence. */
  keywords: z.array(z.string().min(1)).min(1),
  /** The taxonomy subtopic whose MCQs are expected to answer this topic. */
  subtopicId: z.string().min(1),
});
export type PyqMapEntry = z.infer<typeof PyqMapEntrySchema>;

/** The whole PYQ map: a flat list of topic gists. */
export const PyqMapSchema = z.array(PyqMapEntrySchema);
export type PyqMap = z.infer<typeof PyqMapSchema>;

/* -------------------------------------------------------------------------- */
/* PYQ weights                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The per-subtopic PYQ FREQUENCY WEIGHT map — how many past-paper questions the
 * three-cycle corpus (APPSC Group-1 Prelims 2019/2023/2024) mapped to each
 * subtopic. Unlike {@link PyqMapSchema} (one de-duplicated GIST per row, so the
 * per-subtopic count is effectively flat), this carries the true QUESTION COUNT
 * summed per subtopic, so the planner can weight FAST-pass demotion by how often
 * a topic actually recurs. Derived from `.research/audit/C-pyq.json` and
 * cross-checked with `.research/audit/C-pyq.md`; EVERY Prelims subtopic gets a
 * weight (0 = never asked in the corpus, which is allowed).
 *
 * Like the other audit inputs the Zod schema is the SINGLE SOURCE OF TRUTH: the
 * type is inferred, the JSON file is validated in `validate:content` (which also
 * checks every key resolves to a taxonomy id) and at load in the loader.
 */
export const PyqWeightsSchema = z.object({
  /** Schema/version tag so the file can evolve compatibly. */
  version: z.number().int().positive(),
  /** Provenance note — where the weights were derived from. */
  source: z.string().min(1),
  /**
   * Subtopic id → number of PYQ questions mapped to it (non-negative integer;
   * 0 is allowed and meaningful — the topic was never asked in the corpus).
   */
  weights: z.record(z.string().min(1), z.number().int().nonnegative()),
});
/** The whole PYQ-weights document. */
export type PyqWeights = z.infer<typeof PyqWeightsSchema>;

/* -------------------------------------------------------------------------- */
/* Parse helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Format a Zod error into a compact, human-readable message. @internal */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/**
 * Parse an unknown value as the syllabus map.
 * @throws Error with a clear message when validation fails.
 */
export function parseSyllabusMap(json: unknown): SyllabusMap {
  const result = SyllabusMapSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid syllabus map — ${formatIssues(result.error)}`);
  }
  return result.data;
}

/**
 * Parse an unknown value as the PYQ map.
 * @throws Error with a clear message when validation fails.
 */
export function parsePyqMap(json: unknown): PyqMap {
  const result = PyqMapSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid PYQ map — ${formatIssues(result.error)}`);
  }
  return result.data;
}

/**
 * Parse an unknown value as the PYQ-weights document.
 * @throws Error with a clear message when validation fails.
 */
export function parsePyqWeights(json: unknown): PyqWeights {
  const result = PyqWeightsSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid PYQ weights — ${formatIssues(result.error)}`);
  }
  return result.data;
}
