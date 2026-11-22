import type { RevisionCard } from '../content/revision-types';

type Spanned = RevisionCard & { span: NonNullable<RevisionCard['span']> };
const spanned = (cards: readonly RevisionCard[]): Spanned[] => cards.filter((c): c is Spanned => !!c.span).sort((a, b) => a.span.from - b.span.from || a.span.to - b.span.to);

/** The dynasty that ruled the same row just before this one began. */
export function previousInGroup(card: RevisionCard, cards: readonly RevisionCard[]): RevisionCard | null {
  if (!card.span) return null;
  const same = spanned(cards).filter((c) => c.id !== card.id && c.group === card.group && c.span.from < card.span!.from);
  return same.length ? same.reduce((a, b) => (b.span.from > a.span.from ? b : a)) : null;
}

/** Cards of OTHER rows that overlap this one by at least `minYears`. */
export function contemporaries(card: RevisionCard, cards: readonly RevisionCard[], minYears = 10): RevisionCard[] {
  if (!card.span) return [];
  const { from, to } = card.span;
  return spanned(cards).filter((c) => {
    if (c.id === card.id || c.group === card.group) return false;
    return Math.min(to, c.span.to) - Math.max(from, c.span.from) >= minYears;
  });
}

export const spanLabel = (c: RevisionCard): string => {
  if (!c.span) return '';
  if (c.span.label) return c.span.label;
  const f = (y: number) => (y < 0 ? `${-y} BCE` : `${y} CE`);
  return `${f(c.span.from)} – ${f(c.span.to)}`;
};

/** Distinct rows in first-seen order by start year. */
export const groupsOf = (cards: readonly RevisionCard[]): string[] => [...new Set(spanned(cards).map((c) => c.group ?? ''))];
