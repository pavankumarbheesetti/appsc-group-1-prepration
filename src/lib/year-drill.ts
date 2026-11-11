/**
 * Year drill: "In which year?" questions for timeline events, scheduled with
 * the shared Leitner engine. Cards live in `state.flashcards` under a `yr:`
 * prefix, which the curated flashcard deck never reads.
 */
import { isDue, type SrCard } from '../engine/spaced-repetition';
import type { TimelineEvent } from '../content/timeline-types';

export const YEAR_CARD_PREFIX = 'yr:';
export const yearCardId = (eventId: string): string => `${YEAR_CARD_PREFIX}${eventId}`;

/** Hide years (3–4 digit numbers) so a title never gives the answer away. */
export function maskYears(text: string): string {
  return text.replace(/\b\d{3,4}\b/g, '____');
}

/**
 * Four choices: the right year plus the three nearest other years from `pool`
 * (the years of the other events being drilled), topped up with nearby years.
 */
export function yearOptions(target: number, pool: readonly number[], rand: () => number, n = 4): number[] {
  const others = [...new Set(pool.filter((y) => y !== target))].sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
  const picks = others.slice(0, n - 1);
  for (let d = 1; picks.length < n - 1; d++) {
    for (const y of [target + d, target - d]) {
      if (y !== 0 && !picks.includes(y) && picks.length < n - 1) picks.push(y);
    }
  }
  const out = [target, ...picks];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Events whose year card is due now, plus events never drilled — due first, oldest due first. */
export function dueYearEvents(events: readonly TimelineEvent[], sr: Readonly<Record<string, SrCard>>, now: number): { due: TimelineEvent[]; fresh: TimelineEvent[] } {
  const due: TimelineEvent[] = [];
  const fresh: TimelineEvent[] = [];
  for (const e of events) {
    const card = sr[yearCardId(e.id)];
    if (!card) fresh.push(e);
    else if (isDue(card, now)) due.push(e);
  }
  due.sort((a, b) => sr[yearCardId(a.id)]!.due - sr[yearCardId(b.id)]!.due);
  return { due, fresh };
}

/** Plain-language gap between two years, e.g. "7 years after". */
export function gapPhrase(from: number, to: number): string {
  let gap = to - from;
  if (from < 0 && to > 0) gap -= 1;
  if (gap === 0) return 'the same year as';
  const n = Math.abs(gap);
  return `${n} year${n === 1 ? '' : 's'} ${gap > 0 ? 'after' : 'before'}`;
}
