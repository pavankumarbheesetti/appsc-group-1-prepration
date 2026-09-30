/**
 * Content model — the single source of truth for all content shapes.
 *
 * Every content type is defined ONCE as a Zod schema (runtime validation) and
 * the matching TypeScript type is derived from it via `z.infer`. Nothing in the
 * app declares these shapes independently; import the inferred types from here.
 *
 * JSON Schema files under `schema/` are generated from these same schemas
 * (see `scripts/gen-json-schema.ts`), so authoring tools and the runtime never
 * drift apart.
 */
import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Subjects                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Stable subject codes → human-readable names.
 *
 * Codes are short, uppercase, and MUST remain stable: they are persisted in
 * content JSON, progress state, and syllabus references. Renaming a human name
 * is safe; changing a code is a breaking migration.
 */
export const SUBJECTS = {
  HIST: 'History & Culture',
  POL: 'Polity/Constitution',
  ECON: 'Economy',
  GEO: 'Geography',
  SCI: 'Science & Tech',
  MENT: 'Mental Ability',
  CA: 'Current Affairs',
  TEL: 'Telugu',
  ENG: 'English',
} as const;

/** Ordered tuple of subject codes, used to build the Zod enum. */
export const SUBJECT_CODES = [
  'HIST',
  'POL',
  'ECON',
  'GEO',
  'SCI',
  'MENT',
  'CA',
  'TEL',
  'ENG',
] as const;

/** Zod enum of the stable subject codes. */
export const SubjectCodeSchema = z.enum(SUBJECT_CODES);
/** Union of subject codes, e.g. `'HIST' | 'POL' | ...`. */
export type SubjectCode = z.infer<typeof SubjectCodeSchema>;

/* -------------------------------------------------------------------------- */
/* Papers                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Exam papers a node/item can belong to.
 * - `screening-1` / `screening-2` — the two objective Screening (Prelims) papers.
 * - `mains-1`..`mains-5` — the five descriptive Mains papers (I..V).
 * - `qualifying` — the qualifying-nature language papers (Telugu / English).
 */
export const PAPERS = [
  'screening-1',
  'screening-2',
  'mains-1',
  'mains-2',
  'mains-3',
  'mains-4',
  'mains-5',
  'qualifying',
] as const;

/** Zod enum of exam papers. */
export const PaperSchema = z.enum(PAPERS);
/** Union of paper identifiers. */
export type Paper = z.infer<typeof PaperSchema>;

/** MCQ difficulty tier: 1 (easy) … 3 (hard). */
export const TierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
/** MCQ difficulty tier type. */
export type Tier = z.infer<typeof TierSchema>;

/* -------------------------------------------------------------------------- */
/* Syllabus                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A single syllabus topic node.
 *
 * `text` holds the VERBATIM official wording (never paraphrased) so the app can
 * cite the source exactly; `title` is a short editorial label for navigation.
 * `serial` mirrors the official numbering (e.g. "A.1"), kept as string|number
 * because the notification mixes styles.
 */
export const SyllabusNodeSchema = z.object({
  id: z.string(),
  subjectCode: SubjectCodeSchema,
  paper: PaperSchema,
  serial: z.union([z.string(), z.number()]),
  title: z.string(),
  /** Verbatim official topic wording — the citable source of truth. */
  text: z.string(),
  /** Optional source PDF page the wording came from. */
  page: z.number().optional(),
});
export type SyllabusNode = z.infer<typeof SyllabusNodeSchema>;

/**
 * Provenance for the syllabus — where the official wording was sourced and
 * whether a human has verified it against the notification PDF.
 */
export const SyllabusMetaSchema = z.object({
  authority: z.string(),
  notificationNo: z.string(),
  notificationDate: z.string(),
  applicationWindow: z.object({
    from: z.string(),
    to: z.string(),
    closeTime: z.string().optional(),
  }),
  totalVacancies: z.number(),
  totalMarks: z.number(),
  /** True only when a human has confirmed the wording matches the PDF. */
  verified: z.boolean(),
  verifiedDate: z.string().optional(),
  source: z.object({
    pdf: z.string().optional(),
    text: z.string().optional(),
    pages: z.number().optional(),
  }),
});
export type SyllabusMeta = z.infer<typeof SyllabusMetaSchema>;

/** The full syllabus: provenance meta plus the flat list of topic nodes. */
export const SyllabusSchema = z.object({
  meta: SyllabusMetaSchema,
  nodes: z.array(SyllabusNodeSchema),
});
export type Syllabus = z.infer<typeof SyllabusSchema>;

/* -------------------------------------------------------------------------- */
/* Content items                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A multiple-choice question.
 *
 * The `.refine` guarantees `answerIndex` actually points at a real option —
 * an out-of-range answer is data corruption and is rejected at parse time.
 * `syllabusRef` (optional) links the item to a `SyllabusNode.id`.
 */
export const MCQItemSchema = z
  .object({
    id: z.string(),
    subjectCode: SubjectCodeSchema,
    syllabusRef: z.string().optional(),
    /**
     * Optional link to a taxonomy subtopic id (see `content/taxonomy.json`).
     * OPTIONAL + backward-compatible: banks authored before the subject→chapter
     * →subtopic taxonomy existed still validate. When present it lets the loader
     * group the item under a subtopic for the Syllabus tracker / Learn workspace.
     */
    subtopicId: z.string().optional(),
    /**
     * Legacy difficulty tier (1..3). OPTIONAL + backward-compatible: the 653
     * seed items keep it, but the app has moved to a SINGLE exam-level model, so
     * new items may omit it and nothing user-facing renders a 3-tier UX anymore.
     * The field is retained only so historical data still validates.
     */
    tier: TierSchema.optional(),
    /**
     * OPTIONAL exam-point mapping: the labels/ids of the subtopic exam-points
     * (see {@link TaxonomySubtopicSchema.examPoints}) this question tests. Drives
     * COVERAGE — distinct exam-points covered across a subtopic's MCQs ÷ total.
     * Backward-compatible: items authored before the coverage model omit it.
     */
    covers: z.array(z.string()).optional(),
    /**
     * OPTIONAL flag marking a warm-up RECALL question. Refreshers are ordered
     * FIRST in a built session (see the engine's refresher-first ordering) so a
     * learner warms up before the exam-level questions. Backward-compatible.
     */
    refresher: z.boolean().optional(),
    question: z.string(),
    /** At least two options are required for a meaningful choice. */
    options: z.array(z.string()).min(2),
    /** Zero-based index into `options`; validated by the refine below. */
    answerIndex: z.number().int().nonnegative(),
    explanation: z.string().optional(),
    source: z.string().optional(),
    verified: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
  })
  .refine((item) => item.answerIndex < item.options.length, {
    message: 'answerIndex must be a valid index into options',
    path: ['answerIndex'],
  });
export type MCQItem = z.infer<typeof MCQItemSchema>;

/**
 * A figure attached to a note.
 *
 * `src` is an image KEY (e.g. `'great-bath'`, `'ivc-extent-map'`) — NOT a URL.
 * The offline asset resolver (`src/content/assets.ts`) maps the key to an
 * inlined asset URL at render time, returning `undefined` for an unknown key so
 * the view can degrade gracefully. `src` is `.min(1)` because an empty key can
 * never resolve and almost always signals an authoring mistake; an unknown but
 * non-empty key is intentionally allowed (the resolver handles it, not the schema).
 */
export const FigureSchema = z.object({
  /** Image KEY resolved by the asset pipeline; must be non-empty. */
  src: z.string().min(1),
  /** Required alt text for accessibility. */
  alt: z.string(),
  /** Optional caption shown under the image. */
  caption: z.string().optional(),
});
export type Figure = z.infer<typeof FigureSchema>;

/**
 * A study note (markdown body).
 *
 * The image/retention fields (`figure`, `figures`, `keyPoints`, `mnemonic`) are
 * all OPTIONAL and backward-compatible: existing seed banks that omit them stay
 * valid. `figure` is a single lead image; `figures` allows several; `keyPoints`
 * are must-remember bullets (also the source for the Revision flashcards); and
 * `mnemonic` is an optional memory aid shown as a callout.
 */
export const NoteItemSchema = z.object({
  id: z.string(),
  subjectCode: SubjectCodeSchema,
  syllabusRef: z.string().optional(),
  /** Optional taxonomy subtopic id (see MCQItem). OPTIONAL + backward-compatible. */
  subtopicId: z.string().optional(),
  title: z.string(),
  /** Markdown source rendered by the notebook view in a later stage. */
  body: z.string(),
  /** Optional single lead figure (image key + alt + caption). */
  figure: FigureSchema.optional(),
  /** Optional additional figures rendered in order after the body. */
  figures: z.array(FigureSchema).optional(),
  /** Optional must-remember bullets; also seed the Revision flashcards. */
  keyPoints: z.array(z.string()).optional(),
  /** Optional memory aid shown as a callout chip. */
  mnemonic: z.string().optional(),
  source: z.string().optional(),
  verified: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});
export type NoteItem = z.infer<typeof NoteItemSchema>;

/** A descriptive Mains practice question with an optional model answer. */
export const MainsItemSchema = z.object({
  id: z.string(),
  subjectCode: SubjectCodeSchema,
  syllabusRef: z.string().optional(),
  /** Optional taxonomy subtopic id (see MCQItem). OPTIONAL + backward-compatible. */
  subtopicId: z.string().optional(),
  paper: PaperSchema,
  question: z.string(),
  /** Optional markdown model answer. */
  modelAnswer: z.string().optional(),
  keyPoints: z.array(z.string()).optional(),
  marks: z.number().optional(),
  source: z.string().optional(),
  verified: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});
export type MainsItem = z.infer<typeof MainsItemSchema>;

/* -------------------------------------------------------------------------- */
/* Banks (discriminated union on `kind`)                                       */
/* -------------------------------------------------------------------------- */

/** A bank of MCQs for one topic within one subject. */
export const MCQBankSchema = z.object({
  kind: z.literal('mcq'),
  subjectCode: SubjectCodeSchema,
  topic: z.string(),
  items: z.array(MCQItemSchema),
});
export type MCQBank = z.infer<typeof MCQBankSchema>;

/** A bank of notes for one topic within one subject. */
export const NotesBankSchema = z.object({
  kind: z.literal('notes'),
  subjectCode: SubjectCodeSchema,
  topic: z.string(),
  items: z.array(NoteItemSchema),
});
export type NotesBank = z.infer<typeof NotesBankSchema>;

/** A bank of Mains questions for one topic within one subject. */
export const MainsBankSchema = z.object({
  kind: z.literal('mains'),
  subjectCode: SubjectCodeSchema,
  topic: z.string(),
  items: z.array(MainsItemSchema),
});
export type MainsBank = z.infer<typeof MainsBankSchema>;

/**
 * A content bank — discriminated on `kind` so a single parse both validates the
 * envelope and narrows `items` to the correct element type.
 */
export const ContentBankSchema = z.discriminatedUnion('kind', [
  MCQBankSchema,
  NotesBankSchema,
  MainsBankSchema,
]);
export type ContentBank = z.infer<typeof ContentBankSchema>;

/** The `kind` tag of a content bank (excludes the syllabus bank). */
export type BankKind = ContentBank['kind'];

/* -------------------------------------------------------------------------- */
/* Curated memory-layer banks (cards / mindmap)                                */
/* -------------------------------------------------------------------------- */

/**
 * A single curated flashcard — ONE high-yield exam fact.
 *
 * ADDITIVE + independent of the {@link MCQItem}/{@link NoteItem} model: cards
 * are hand-authored during the per-subtopic review pipeline as the "revision"
 * memory layer. `front`/`back` carry HARD size caps so a card always fits a
 * one-glance revision UI — the caps are enforced at parse time (Zod `.max`), so
 * an over-long card is a validation ERROR, not a silent truncation.
 * `examPoint` (optional) names the covered subtopic exam-point; `verified` is
 * REQUIRED so every curated card carries an explicit fact-checked flag.
 */
export const CardItemSchema = z.object({
  id: z.string(),
  subjectCode: SubjectCodeSchema,
  /** REQUIRED taxonomy subtopic id — curated cards always belong to a subtopic. */
  subtopicId: z.string(),
  /** Cue/question shown first — capped at 160 characters. */
  front: z.string().min(1).max(160),
  /** Answer revealed on flip — capped at 200 characters. */
  back: z.string().min(1).max(200),
  /** Optional label of the subtopic exam-point this card covers. */
  examPoint: z.string().optional(),
  source: z.string().optional(),
  /** REQUIRED fact-checked flag — curated content is explicit about verification. */
  verified: z.boolean(),
});
export type CardItem = z.infer<typeof CardItemSchema>;

/** A bank of curated flashcards for one subtopic within one subject. */
export const CardsBankSchema = z.object({
  kind: z.literal('cards'),
  subjectCode: SubjectCodeSchema,
  topic: z.string(),
  items: z.array(CardItemSchema),
});
export type CardsBank = z.infer<typeof CardsBankSchema>;

/**
 * One branch of a mind map — a labelled node with up to four keyword leaves.
 * Leaves are keywords/dates/numbers only (≤60 chars each), MAX 4 per branch, so
 * the whole map stays a one-screen photographic-recall aid.
 */
export const MindmapBranchSchema = z.object({
  /** Branch label — capped at 40 characters. */
  label: z.string().min(1).max(40),
  /** Up to four keyword leaves (each ≤60 chars). */
  leaves: z.array(z.string().max(60)).max(4),
});
export type MindmapBranch = z.infer<typeof MindmapBranchSchema>;

/**
 * A curated one-screen mind map for a single subtopic.
 *
 * Unlike the item-list banks, a mind map has NO `items[]`: it is a single tree
 * (`root` → `branches[]` → `leaves[]`) sized to fit one screen. Caps (root ≤40,
 * ≤7 branches, branch label ≤40, ≤4 leaves ≤60) are enforced at parse time, so
 * an over-sized map fails validation rather than overflowing the recall UI.
 */
export const MindmapBankSchema = z.object({
  kind: z.literal('mindmap'),
  subjectCode: SubjectCodeSchema,
  topic: z.string(),
  /** REQUIRED taxonomy subtopic id this map belongs to. */
  subtopicId: z.string(),
  /** Central node — capped at 40 characters. */
  root: z.string().min(1).max(40),
  /** Up to seven branches, ordered the way the notes teach the subtopic. */
  branches: z.array(MindmapBranchSchema).max(7),
});
export type MindmapBank = z.infer<typeof MindmapBankSchema>;

/** The syllabus stored as a bank: `kind:'syllabus'` plus the full Syllabus. */
export const SyllabusBankSchema = z
  .object({ kind: z.literal('syllabus') })
  .merge(SyllabusSchema);
export type SyllabusBank = z.infer<typeof SyllabusBankSchema>;

/* -------------------------------------------------------------------------- */
/* Manifest                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One entry in the manifest describing a bank file.
 *
 * `subjectCode` is optional because the syllabus bank spans every subject; for
 * `mcq`/`notes`/`mains` entries it is always present in practice.
 */
export const ManifestBankEntrySchema = z.object({
  path: z.string(),
  kind: z.enum(['mcq', 'notes', 'mains', 'syllabus', 'cards', 'mindmap']),
  subjectCode: SubjectCodeSchema.optional(),
  topic: z.string().optional(),
  /**
   * Taxonomy subtopic id this bank belongs to, when all of its items share one.
   * Written by `scripts/gen-manifest.ts`; optional (syllabus banks and banks
   * authored before the taxonomy existed have none).
   */
  subtopicId: z.string().optional(),
  count: z.number(),
  title: z.string(),
});
export type ManifestBankEntry = z.infer<typeof ManifestBankEntrySchema>;

/** The content manifest listing every bank the app ships. */
export const ManifestSchema = z.object({
  version: z.string(),
  generatedAt: z.string().optional(),
  banks: z.array(ManifestBankEntrySchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/* -------------------------------------------------------------------------- */
/* Parse helpers                                                               */
/* -------------------------------------------------------------------------- */

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
 * Parse an unknown value as a content bank (mcq/notes/mains).
 * @throws Error with a clear message when validation fails.
 */
export function parseBank(json: unknown): ContentBank {
  const result = ContentBankSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid content bank — ${formatIssues(result.error)}`);
  }
  return result.data;
}

/**
 * Parse an unknown value as the syllabus bank (`kind:'syllabus'`).
 * @throws Error with a clear message when validation fails.
 */
export function parseSyllabus(json: unknown): SyllabusBank {
  const result = SyllabusBankSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid syllabus — ${formatIssues(result.error)}`);
  }
  return result.data;
}

/**
 * Parse an unknown value as a curated flashcards bank (`kind:'cards'`).
 * @throws Error with a clear message when validation fails (incl. size caps).
 */
export function parseCards(json: unknown): CardsBank {
  const result = CardsBankSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid cards bank — ${formatIssues(result.error)}`);
  }
  return result.data;
}

/**
 * Parse an unknown value as a curated mind-map bank (`kind:'mindmap'`).
 * @throws Error with a clear message when validation fails (incl. size caps).
 */
export function parseMindmap(json: unknown): MindmapBank {
  const result = MindmapBankSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid mindmap bank — ${formatIssues(result.error)}`);
  }
  return result.data;
}

/**
 * Parse an unknown value as the content manifest.
 * @throws Error with a clear message when validation fails.
 */
export function parseManifest(json: unknown): Manifest {
  const result = ManifestSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid manifest — ${formatIssues(result.error)}`);
  }
  return result.data;
}
