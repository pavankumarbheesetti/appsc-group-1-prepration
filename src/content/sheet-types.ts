import { z } from 'zod';

/** Years on the number line; negative = BCE. `label` overrides the printed span (e.g. "c. 3300 BCE"). */
export const YearsSchema = z
  .object({ from: z.number(), to: z.number(), label: z.string().min(1).optional() })
  .refine((y) => y.to >= y.from, { message: 'years.to < years.from' });

/** One line of a key: a short label and a compact, exam-ready value. */
export const SheetRowSchema = z.object({ k: z.string().min(1).max(40), v: z.string().min(1) });

/** One key of a sheet: a ruler, a site, a text, a war, an Act. */
export const SheetKeySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  years: YearsSchema.optional(),
  /** Dynasty / type chip, and the lane in a chart sheet. */
  tag: z.string().min(1).optional(),
  hook: z.string().min(1).optional(),
  rows: z.array(SheetRowSchema).min(3),
  /** "Don't confuse" lines: the traps the paper sets. */
  traps: z.array(z.string().min(1)).optional(),
});
export type SheetKey = z.infer<typeof SheetKeySchema>;

export const SHEET_PARTS = ['Ancient India', 'Medieval India', 'Modern India', 'Andhra Pradesh', 'Art & Culture', 'Polity'] as const;

export const SheetSchema = z
  .object({
    id: z.string().min(1),
    part: z.enum(SHEET_PARTS),
    title: z.string().min(1),
    /** Order within its part. */
    order: z.number().int(),
    intro: z.string().min(1).optional(),
    /** chart = every key also sits on a lane chart (lane = tag) to see who ruled at the same time. */
    chart: z.boolean().optional(),
    /** History chapter ids this sheet revises (for the chapter link). */
    chapters: z.array(z.string().min(1)).optional(),
    keys: z.array(SheetKeySchema).min(1),
  })
  .superRefine((s, ctx) => {
    if (!s.chart) return;
    s.keys.forEach((k, i) => {
      if (!k.years || !k.tag) ctx.addIssue({ code: 'custom', path: ['keys', i], message: `chart key '${k.id}' needs years and tag` });
    });
  });
export type Sheet = z.infer<typeof SheetSchema>;

export const SheetBankSchema = z.object({
  kind: z.literal('sheets'),
  version: z.string(),
  sheets: z.array(SheetSchema),
});

export function parseSheets(json: unknown): Sheet[] {
  const r = SheetBankSchema.safeParse(json);
  if (!r.success) {
    throw new Error(`Invalid sheets bank — ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  }
  return r.data.sheets;
}
