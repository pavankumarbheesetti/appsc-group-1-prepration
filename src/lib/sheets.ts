import type { Sheet, SheetKey } from '../content/sheet-types';
import { SHEET_PARTS } from '../content/sheet-types';

type Dated = SheetKey & { years: NonNullable<SheetKey['years']> };
const dated = (keys: readonly SheetKey[]): Dated[] =>
  keys.filter((k): k is Dated => !!k.years).sort((a, b) => a.years.from - b.years.from || a.years.to - b.years.to);

export const yearText = (y: number): string => (y < 0 ? `${-y} BCE` : `${y}`);

/** "1556 – 1605", "326 BCE", or the key's own label. */
export function yearsLabel(k: Pick<SheetKey, 'years'>): string {
  if (!k.years) return '';
  if (k.years.label) return k.years.label;
  const { from, to } = k.years;
  if (from === to) return yearText(from);
  if (from < 0 && to < 0) return `${-from} – ${-to} BCE`;
  if (from < 0) return `${-from} BCE – ${to} CE`;
  return `${from} – ${to}`;
}

/** The key that ran in the same lane just before this one began. */
export function previousInLane(key: SheetKey, keys: readonly SheetKey[]): SheetKey | null {
  if (!key.years) return null;
  const same = dated(keys).filter((k) => k.id !== key.id && k.tag === key.tag && k.years.from < key.years!.from);
  return same.length ? same[same.length - 1]! : null;
}

/** Keys in OTHER lanes that overlap this one by at least `minYears`. */
export function sameTime(key: SheetKey, keys: readonly SheetKey[], minYears = 10): SheetKey[] {
  if (!key.years) return [];
  const { from, to } = key.years;
  return dated(keys).filter((k) => k.id !== key.id && k.tag !== key.tag && Math.min(to, k.years.to) - Math.max(from, k.years.from) >= minYears);
}

/** Lanes in order of their first start year. */
export const lanesOf = (keys: readonly SheetKey[]): string[] => [...new Set(dated(keys).map((k) => k.tag ?? ''))];

/** Dated keys oldest first (the "In order" strip). */
export const inOrder = (keys: readonly SheetKey[]): Dated[] => dated(keys);

/** Sheets grouped by part (syllabus order), each part sorted by `order`. */
export function byPart(sheets: readonly Sheet[]): { part: Sheet['part']; sheets: Sheet[] }[] {
  return SHEET_PARTS.map((part) => ({ part, sheets: sheets.filter((s) => s.part === part).sort((a, b) => a.order - b.order) })).filter((g) => g.sheets.length);
}

/** Years the whole sheet covers, or '' if no key is dated. */
export function sheetSpan(s: Sheet): string {
  const d = dated(s.keys);
  if (!d.length) return '';
  const from = d[0]!.years.from;
  const to = Math.max(...d.map((k) => k.years.to));
  return yearsLabel({ years: { from, to } });
}
