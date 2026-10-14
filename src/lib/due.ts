/**
 * ONE due-count model for every surface (Today, Revise, Progress, Drill).
 *
 * Flashcards — the curated deck of REVISABLE topics only:
 *   - `due`        cards due now (never-reviewed cards of a revisable topic are
 *                  due immediately, like the session builder treats them);
 *   - `scheduled`  of those, cards already reviewed at least once (a scheduled
 *                  recall — Today's early-revise threshold);
 *   - `reviewedToday` distinct cards graded today (local day);
 *   - `today`      "N cards for today" = min(due, CAP − reviewedToday), so the
 *                  daily session does NOT refill after it is finished;
 *   - `doneForToday` the daily session is finished (cards were reviewed today
 *                  and nothing is left within the cap);
 *   - `dueTomorrow` cards that will be due by the end of tomorrow.
 *
 * Questions — the MCQ spaced-repetition queue the Drill "Due review" uses.
 *
 * PURE over (state, cards, now); thin selectors read the live store.
 */
import { getBanks, getCards, getSubtopics } from '../content/loader';
import { buildCuratedDeck, selectSession, DAILY_SESSION_CAP, type Flashcard } from '../engine/flashcards';
import { BOX_INTERVALS_DAYS, isDue, type SrCard } from '../engine/spaced-repetition';
import { dueQuestionIds } from '../engine/drill';
import { loadState, type AppState } from '../state/store';
import { isRevisable } from './study-status';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the LOCAL day containing `ms`. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * When a card was last graded. Uses an explicit `lastReviewed` stamp when the
 * scheduler provides one; otherwise it is reconstructed from the Leitner rule
 * (a box-1 card was last graded "Again" at its `due`; a box-N card was graded
 * "Good" `BOX_INTERVALS_DAYS[N]` days before its `due`). Either way the LOCAL
 * day is exact, which is all the daily cap needs. PURE.
 */
export function lastReviewedAt(card: SrCard): number {
  const stamp = (card as SrCard & { lastReviewed?: number }).lastReviewed;
  if (typeof stamp === 'number') return stamp;
  if (card.box <= 1) return card.due;
  // Calendar-day subtraction (DST-safe, matches a midnight-anchored scheduler).
  const d = new Date(card.due);
  d.setDate(d.getDate() - (BOX_INTERVALS_DAYS[card.box] ?? 0));
  return d.getTime();
}

/** Whether `card` was graded on the local day of `now`. PURE. */
export function reviewedOnDay(card: SrCard, now: number): boolean {
  const day = startOfLocalDay(now);
  const at = lastReviewedAt(card);
  return at >= day && at < day + DAY_MS;
}

/** The flashcard due numbers shared by every view. */
export interface FlashcardDue {
  due: number;
  scheduled: number;
  reviewedToday: number;
  today: number;
  doneForToday: boolean;
  dueTomorrow: number;
  /** The deck size (curated cards of revisable topics). */
  deck: number;
}

/** Compute {@link FlashcardDue} for `deck` against an SR map. PURE. */
export function flashcardDue(
  deck: readonly Flashcard[],
  sr: Readonly<Record<string, SrCard>>,
  now: number,
  cap: number = DAILY_SESSION_CAP,
): FlashcardDue {
  let due = 0;
  let scheduled = 0;
  let reviewedToday = 0;
  let dueTomorrow = 0;
  const endOfTomorrow = startOfLocalDay(now) + 2 * DAY_MS;
  for (const c of deck) {
    const entry = sr[c.id];
    if (!entry) {
      due += 1;
      dueTomorrow += 1;
      continue;
    }
    if (isDue(entry, now)) {
      due += 1;
      scheduled += 1;
    }
    if (reviewedOnDay(entry, now)) reviewedToday += 1;
    if (entry.due < endOfTomorrow) dueTomorrow += 1;
  }
  const remaining = Math.max(0, cap - reviewedToday);
  const today = Math.min(due, remaining);
  return {
    due,
    scheduled,
    reviewedToday,
    today,
    doneForToday: reviewedToday > 0 && today === 0,
    dueTomorrow,
    deck: deck.length,
  };
}

/**
 * Today's session cards: the weakest-first due cards, capped at what is LEFT of
 * the daily cap (`keepGoing` ignores the daily cap and offers a fresh `cap`).
 */
export function todaysSession(
  deck: readonly Flashcard[],
  sr: Readonly<Record<string, SrCard>>,
  now: number,
  keepGoing = false,
  cap: number = DAILY_SESSION_CAP,
): Flashcard[] {
  const left = keepGoing ? cap : flashcardDue(deck, sr, now, cap).today;
  if (left <= 0) return [];
  return selectSession(deck, sr, now, left);
}

/** Every curated card of the REVISABLE (studied) topics, taxonomy order. */
export function revisableCuratedCards(state: AppState = loadState()): Flashcard[] {
  const out: Flashcard[] = [];
  for (const sub of getSubtopics()) {
    const cards = getCards(sub.id);
    if (cards.length > 0 && isRevisable(sub.id, state)) out.push(...buildCuratedDeck(cards));
  }
  return out;
}

/** The live flashcard due numbers over the whole revisable curated deck. */
export function liveFlashcardDue(now: number = Date.now()): FlashcardDue {
  const state = loadState();
  return flashcardDue(revisableCuratedCards(state), state.flashcards, now);
}

/** Every MCQ id across the banks. @internal */
function allMcqIds(): string[] {
  const out: string[] = [];
  for (const { bank } of getBanks('mcq')) {
    if (bank.kind !== 'mcq') continue;
    for (const item of bank.items) out.push(item.id);
  }
  return out;
}

/** Practice QUESTIONS due for spaced review (Drill "Due review"). */
export function questionsDue(
  state: AppState = loadState(),
  now: number = Date.now(),
  mcqIds: readonly string[] = allMcqIds(),
): string[] {
  return dueQuestionIds(state.sr, mcqIds, now);
}

/** "20 cards for today" / "Done for today — 12 more due tomorrow" wording. */
export function flashcardTodayLine(d: FlashcardDue): string {
  if (d.today > 0) return `${d.today} card${d.today === 1 ? '' : 's'} for today`;
  if (d.doneForToday) {
    return d.dueTomorrow > 0
      ? `Done for today \u2014 ${d.dueTomorrow} more due tomorrow`
      : 'Done for today';
  }
  return d.deck > 0 ? 'Nothing due right now' : 'No flashcards yet';
}
