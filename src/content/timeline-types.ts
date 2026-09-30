/**
 * Timeline model — the single source of truth for the interactive Timeline.
 *
 * Like {@link ./types.ts} and {@link ./taxonomy.ts}, the Zod schema here is the
 * ONLY declaration of the shape: the TypeScript types are derived via `z.infer`,
 * and `content/timeline/events.json` is validated against it at load (loader)
 * and in the content gate (validate.ts).
 *
 * The dataset is a chronological spine across parallel LANES (north/south India,
 * Deccan, Andhra, world, polity, economy, science) and ERA bands, superseding
 * the ancient-only `src/content/timeline.ts` seed. Each event links to authored
 * taxonomy subtopics (`subtopicIds`) and to real MCQ ids (`relatedMcqIds`) so
 * the view can deep-link into Learn/Practice; `periods` supply dynasty/era bars.
 *
 * `date.year` is the numeric SORT KEY (negative = BCE, positive = CE, never 0).
 * The optional `month`/`day`/`endYear`/`approx` refine display and span without
 * changing the sort. This module is PURE data + schema — no DOM, no store.
 */
import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Enumerations                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Stable era identifiers, in rough chronological teaching order. The list is a
 * superset of the ancient-only eras used by the legacy `timeline.ts` seed
 * (`ivc`, `sangam`, `post-gupta`) extended across medieval, modern, freedom,
 * post-independence and the Andhra-Pradesh-specific eras.
 */
export const ERA_IDS = [
  'prehistoric',
  'ivc',
  'vedic',
  'mahajanapada',
  'mauryan',
  'post-mauryan',
  'sangam',
  'gupta',
  'post-gupta',
  'early-medieval',
  'sultanate',
  'vijayanagara-bahmani',
  'mughal',
  'european',
  'company-rule',
  'freedom-struggle',
  'post-independence',
  'andhra-movement',
  'ap-2014-onwards',
  'contemporary',
] as const;
export const EraIdSchema = z.enum(ERA_IDS);
/** Union of era identifiers. */
export type EraId = z.infer<typeof EraIdSchema>;

/**
 * Parallel lanes the timeline is laid out in. Region lanes (north/south India,
 * Deccan, Andhra, world) plus thematic lanes (polity, economy, science) so a
 * constitutional amendment and a dynasty can share the axis without colliding.
 */
export const LANE_IDS = [
  'north-india',
  'south-india',
  'deccan',
  'andhra',
  'world',
  'polity-constitution',
  'economy',
  'science-tech',
] as const;
export const LaneSchema = z.enum(LANE_IDS);
/** Union of lane identifiers. */
export type Lane = z.infer<typeof LaneSchema>;

/** The kind of thing an event records — drives the view's icon/marker. */
export const KIND_IDS = [
  'battle',
  'dynasty-start',
  'dynasty-end',
  'ruler',
  'treaty',
  'act',
  'movement',
  'institution',
  'culture',
  'discovery',
  'scheme',
  'mission',
  'event',
] as const;
export const KindSchema = z.enum(KIND_IDS);
/** Union of event-kind identifiers. */
export type Kind = z.infer<typeof KindSchema>;

/* -------------------------------------------------------------------------- */
/* Date                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A timeline date. `year` is the numeric sort key (BCE negative, CE positive,
 * never 0). `month`/`day` narrow a modern date for display; `endYear` marks a
 * span (must be >= `year`); `approx` flags a conventional/estimated date
 * (rendered with a "c." prefix by the view).
 */
export const TimelineDateSchema = z
  .object({
    /** Sort key: negative = BCE, positive = CE, never 0. */
    year: z.number().int().refine((y) => y !== 0, { message: 'year must not be 0 (no year zero)' }),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
    /** End of a span; when present must be >= `year`. */
    endYear: z.number().int().optional(),
    /** Conventional/estimated date (view prefixes with "c."). */
    approx: z.boolean().optional(),
  })
  .refine((d) => d.endYear === undefined || d.endYear >= d.year, {
    message: 'endYear must be >= year',
    path: ['endYear'],
  })
  .refine((d) => d.day === undefined || d.month !== undefined, {
    message: 'day requires month',
    path: ['day'],
  });
export type TimelineDate = z.infer<typeof TimelineDateSchema>;

/* -------------------------------------------------------------------------- */
/* Event                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A single dated event. `subtopicIds` link to `content/taxonomy.json` subtopics
 * and `relatedMcqIds` to real MCQ item ids (both cross-checked in validate.ts).
 * `importance` 1..3 (3 = must-know) drives label density at low zoom.
 */
export const TimelineEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  date: TimelineDateSchema,
  era: EraIdSchema,
  lane: LaneSchema,
  kind: KindSchema,
  /** 1–2 line, exam-oriented gist. */
  summary: z.string().min(1),
  /** 3–6 line markdown: significance + exam hooks. */
  detail: z.string().min(1),
  /** Taxonomy subtopic ids this event belongs to (validated against taxonomy). */
  subtopicIds: z.array(z.string()),
  /** Real MCQ item ids whose question/explanation concerns this event. */
  relatedMcqIds: z.array(z.string()),
  /** True when the event is Andhra-Pradesh-specific (drives the AP-only filter). */
  apSpecific: z.boolean(),
  /** 1 (context) … 3 (must-know). */
  importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Provenance / citation string. */
  source: z.string().min(1),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

/* -------------------------------------------------------------------------- */
/* Period (dynasty / era bar)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A horizontal bar spanning `startYear`..`endYear` (BCE negative, CE positive).
 * `endYear` may equal `startYear` and, for a still-current span, may be a future
 * sentinel year; the schema only enforces `startYear <= endYear`.
 */
export const TimelinePeriodSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    lane: LaneSchema,
    startYear: z.number().int().refine((y) => y !== 0, { message: 'startYear must not be 0' }),
    endYear: z.number().int().refine((y) => y !== 0, { message: 'endYear must not be 0' }),
    /** Taxonomy subtopic ids the bar covers (validated against taxonomy). */
    subtopicIds: z.array(z.string()),
  })
  .refine((p) => p.endYear >= p.startYear, {
    message: 'endYear must be >= startYear',
    path: ['endYear'],
  });
export type TimelinePeriod = z.infer<typeof TimelinePeriodSchema>;

/* -------------------------------------------------------------------------- */
/* Bank                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The timeline data bank stored at `content/timeline/events.json`. `kind` tags
 * it so the loader/validator can route it away from the mcq/notes/mains banks.
 */
export const TimelineBankSchema = z.object({
  kind: z.literal('timeline'),
  version: z.string(),
  events: z.array(TimelineEventSchema),
  periods: z.array(TimelinePeriodSchema),
});
export type TimelineBank = z.infer<typeof TimelineBankSchema>;

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
 * Parse an unknown value as the timeline bank.
 * @throws Error with a clear message when validation fails.
 */
export function parseTimeline(json: unknown): TimelineBank {
  const result = TimelineBankSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid timeline bank — ${formatIssues(result.error)}`);
  }
  return result.data;
}

/**
 * Group events into eras in the declared {@link ERA_IDS} order, each era's
 * events sorted ascending by `date.year` (BCE before CE). PURE: never mutates
 * inputs; empty eras are omitted. Events with an unknown era are dropped
 * defensively (the dataset keeps eras in sync via the schema enum).
 */
export function groupEventsByEra(
  events: readonly TimelineEvent[],
): { era: EraId; events: TimelineEvent[] }[] {
  const buckets = new Map<EraId, TimelineEvent[]>();
  for (const ev of events) {
    const b = buckets.get(ev.era);
    if (b) b.push(ev);
    else buckets.set(ev.era, [ev]);
  }
  const out: { era: EraId; events: TimelineEvent[] }[] = [];
  for (const era of ERA_IDS) {
    const list = buckets.get(era);
    if (!list || list.length === 0) continue;
    out.push({ era, events: [...list].sort((a, b) => a.date.year - b.date.year) });
  }
  return out;
}
