/**
 * People + office-holder banks for the Year explorer, stored beside the
 * timeline events as `content/timeline/people-*.json` and
 * `content/timeline/offices-*.json`.
 *
 * Years follow the timeline convention: negative = BCE, positive = CE, never 0.
 */
import { z } from 'zod';
import { DatedFactSchema, EraIdSchema, LaneSchema, PairSchema, TimelineImageSchema } from './timeline-types';

const YearSchema = z.number().int().refine((y) => y !== 0, { message: 'year must not be 0 (no year zero)' });

export const PERSON_CATEGORIES = [
  'ruler',
  'administrator',
  'general',
  'reformer',
  'freedom-fighter',
  'politician',
  'religious',
  'writer',
  'scholar',
  'traveller',
  'scientist',
  'artist',
  'other',
] as const;
export const PersonCategorySchema = z.enum(PERSON_CATEGORIES);
export type PersonCategory = z.infer<typeof PersonCategorySchema>;

export const PersonRoleSchema = z
  .object({
    title: z.string().min(1),
    from: YearSchema,
    to: YearSchema,
    officeId: z.string().min(1).optional(),
    /** Who appointed / crowned them. */
    appointedBy: z.string().min(1).optional(),
    /** Whom they succeeded. */
    predecessor: z.string().min(1).optional(),
    /** How they got the post or throne (inherited, elected, usurped, appointed…). */
    howGained: z.string().min(1).optional(),
    /** How it ended (died, deposed, resigned…). */
    howEnded: z.string().min(1).optional(),
  })
  .refine((r) => r.to >= r.from, { message: 'role to must be >= from', path: ['to'] });
export type PersonRole = z.infer<typeof PersonRoleSchema>;

export const WorkSchema = z.object({
  title: z.string().min(1),
  note: z.string().min(1).optional(),
});

export const PersonSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    aka: z.array(z.string().min(1)).optional(),
    category: PersonCategorySchema,
    era: EraIdSchema,
    lane: LaneSchema,
    born: YearSchema.optional(),
    died: YearSchema.optional(),
    /** Born/died are conventional estimates. */
    approx: z.boolean().optional(),
    /** Years the person counts as "active" in the Year explorer (overrides born–died). */
    activeFrom: YearSchema.optional(),
    activeTo: YearSchema.optional(),
    summary: z.string().min(1),
    /** Epithets / titles, e.g. "Amitraghata", "Lion of Punjab". */
    titles: z.array(z.string().min(1)).optional(),
    roles: z.array(PersonRoleSchema).optional(),
    works: z.array(WorkSchema).optional(),
    /** Stand-alone true statements. */
    facts: z.array(z.string().min(1)).min(1),
    pairs: z.array(PairSchema).optional(),
    eventIds: z.array(z.string().min(1)).optional(),
    alsoOn: z.array(DatedFactSchema).optional(),
    images: z.array(TimelineImageSchema).optional(),
    /** English Wikipedia article title used by `scripts/fetch-images.ts` to find a free image. */
    wiki: z.string().min(1).optional(),
    subtopicIds: z.array(z.string()),
    apSpecific: z.boolean(),
    importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    source: z.string().min(1),
  })
  .refine((p) => p.born === undefined || p.died === undefined || p.died >= p.born, {
    message: 'died must be >= born',
    path: ['died'],
  })
  .refine((p) => p.activeFrom === undefined || p.activeTo === undefined || p.activeTo >= p.activeFrom, {
    message: 'activeTo must be >= activeFrom',
    path: ['activeTo'],
  })
  .refine((p) => p.activeFrom !== undefined || p.born !== undefined || (p.roles?.length ?? 0) > 0, {
    message: 'person needs born, activeFrom or at least one role to place them in time',
    path: ['born'],
  });
export type Person = z.infer<typeof PersonSchema>;

export const PeopleBankSchema = z.object({
  kind: z.literal('people'),
  version: z.string(),
  people: z.array(PersonSchema),
});
export type PeopleBank = z.infer<typeof PeopleBankSchema>;

export const OfficeHolderSchema = z
  .object({
    name: z.string().min(1),
    personId: z.string().min(1).optional(),
    from: YearSchema,
    to: YearSchema,
    approx: z.boolean().optional(),
    note: z.string().min(1).optional(),
  })
  .refine((h) => h.to >= h.from, { message: 'holder to must be >= from', path: ['to'] });
export type OfficeHolder = z.infer<typeof OfficeHolderSchema>;

/** A post or throne whose holders change over time (e.g. Governor-General, Mauryan emperor). */
export const OfficeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Grouping shown in the Year explorer, e.g. "British India", "Delhi Sultanate". */
  group: z.string().min(1),
  lane: LaneSchema,
  holders: z.array(OfficeHolderSchema).min(1),
});
export type Office = z.infer<typeof OfficeSchema>;

export const OfficesBankSchema = z.object({
  kind: z.literal('offices'),
  version: z.string(),
  offices: z.array(OfficeSchema),
});
export type OfficesBank = z.infer<typeof OfficesBankSchema>;

export const HISTORY_PARTS = ['ancient', 'medieval', 'modern', 'andhra', 'polity'] as const;
export const HistoryPartSchema = z.enum(HISTORY_PARTS);
export type HistoryPart = z.infer<typeof HistoryPartSchema>;

/**
 * A reading chapter over a span of years (e.g. 1757–1805). Every year with
 * entries inside [from, to] is taught in order; `intro` sets the scene and
 * `takeaways` close the chapter.
 */
export const ChapterSchema = z
  .object({
    id: z.string().min(1),
    part: HistoryPartSchema,
    title: z.string().min(1),
    from: YearSchema,
    to: YearSchema,
    /** Lanes taught in this chapter; omitted = every lane. */
    lanes: z.array(LaneSchema).optional(),
    intro: z.string().min(1),
    /** Short lessons inside the chapter, in order; each covers [from, to]. */
    fragments: z
      .array(z.object({ title: z.string().min(1), from: YearSchema, to: YearSchema, intro: z.string().min(1).optional() }))
      .optional(),
    takeaways: z.array(z.string().min(1)).optional(),
    subtopicIds: z.array(z.string()),
    source: z.string().min(1),
  })
  .refine((c) => c.to >= c.from, { message: 'chapter to must be >= from', path: ['to'] });
export type Chapter = z.infer<typeof ChapterSchema>;

export const ChaptersBankSchema = z.object({
  kind: z.literal('chapters'),
  version: z.string(),
  chapters: z.array(ChapterSchema),
});
export type ChaptersBank = z.infer<typeof ChaptersBankSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export function parsePeople(json: unknown): PeopleBank {
  const r = PeopleBankSchema.safeParse(json);
  if (!r.success) throw new Error(`Invalid people bank — ${formatIssues(r.error)}`);
  return r.data;
}

/** A historical term (post, tax, institution) explained the first time a lesson uses it. */
export const GlossaryTermSchema = z.object({
  id: z.string().min(1),
  term: z.string().min(1),
  /** Other spellings / forms matched in text (e.g. "subadar", "subahdar"). */
  aka: z.array(z.string().min(1)).optional(),
  /** One-line meaning in plain words. */
  meaning: z.string().min(1),
  /** When / where it was used, e.g. "Mughal empire". */
  period: z.string().min(1).optional(),
  /** A worked example from the syllabus. */
  example: z.string().min(1).optional(),
  source: z.string().min(1),
});
export type GlossaryTerm = z.infer<typeof GlossaryTermSchema>;

export const GlossaryBankSchema = z.object({
  kind: z.literal('glossary'),
  version: z.string(),
  terms: z.array(GlossaryTermSchema),
});

export function parseGlossary(json: unknown): GlossaryTerm[] {
  const r = GlossaryBankSchema.safeParse(json);
  if (!r.success) throw new Error(`Invalid glossary bank — ${formatIssues(r.error)}`);
  return r.data.terms;
}

export function parseChapters(json: unknown): ChaptersBank {
  const r = ChaptersBankSchema.safeParse(json);
  if (!r.success) throw new Error(`Invalid chapters bank — ${formatIssues(r.error)}`);
  return r.data;
}

export function parseOffices(json: unknown): OfficesBank {
  const r = OfficesBankSchema.safeParse(json);
  if (!r.success) throw new Error(`Invalid offices bank — ${formatIssues(r.error)}`);
  return r.data;
}

/** Years a person counts as active: explicit active span, else roles, else born–died. */
export function activeSpan(p: Person): { from: number; to: number } {
  const roleFrom = p.roles?.length ? Math.min(...p.roles.map((r) => r.from)) : undefined;
  const roleTo = p.roles?.length ? Math.max(...p.roles.map((r) => r.to)) : undefined;
  const from = p.activeFrom ?? p.born ?? roleFrom ?? 0;
  const to = p.activeTo ?? p.died ?? roleTo ?? from;
  return { from, to: Math.max(from, to) };
}
