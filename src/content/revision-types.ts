import { z } from 'zod';

/** One small box beside the key: a label and the exam-ready points under it. */
export const RevisionFacetSchema = z.object({
  label: z.string().min(1),
  points: z.array(z.string().min(1)).min(1),
});

/** One big key (an age, a text, a dynasty, a ruler, a war, an act) with its small boxes. */
export const RevisionCardSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  /** Years on the number line; negative = BCE. Needed for timeline sections. */
  span: z.object({ from: z.number(), to: z.number(), label: z.string().min(1).optional() }).optional(),
  /** Timeline sections: which row the card sits in (e.g. "North India", "Deccan", "South"). */
  group: z.string().min(1).optional(),
  /** One-line hook shown under the key. */
  hook: z.string().min(1).optional(),
  facets: z.array(RevisionFacetSchema).min(1),
});
export type RevisionCard = z.infer<typeof RevisionCardSchema>;

export const RevisionSectionSchema = z
  .object({
    id: z.string().min(1),
    chapterId: z.string().min(1),
    title: z.string().min(1),
    /** boxes = key box with small boxes beside it; timeline = dynasties on one line with before/contemporaries. */
    style: z.enum(['boxes', 'timeline']),
    intro: z.string().min(1).optional(),
    cards: z.array(RevisionCardSchema).min(1),
  })
  .superRefine((s, ctx) => {
    if (s.style !== 'timeline') return;
    s.cards.forEach((c, i) => {
      if (!c.span) ctx.addIssue({ code: 'custom', path: ['cards', i, 'span'], message: `timeline card '${c.id}' needs a span` });
      else if (c.span.to < c.span.from) ctx.addIssue({ code: 'custom', path: ['cards', i, 'span'], message: `card '${c.id}' span to < from` });
    });
  });
export type RevisionSection = z.infer<typeof RevisionSectionSchema>;

export const RevisionBankSchema = z.object({
  kind: z.literal('revision'),
  version: z.string(),
  sections: z.array(RevisionSectionSchema),
});

export function parseRevision(json: unknown): RevisionSection[] {
  const r = RevisionBankSchema.safeParse(json);
  if (!r.success) {
    throw new Error(`Invalid revision bank — ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  }
  return r.data.sections;
}
