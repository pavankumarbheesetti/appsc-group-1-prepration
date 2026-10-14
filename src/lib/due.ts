/**
 * ONE due-count model for every surface (Today, Revise, Progress, Drill).
 *
 * Flashcards — the curated deck of REVISABLE topics only:
 *   - `scheduled`  reviewed-before cards due now (the review backlog);
 *   - `newWaiting` never-seen cards — they QUEUE, at most 15 are introduced a
 *                  day and only after the due reviews (they are not "due");
 *   - `due`        scheduled + today's new-card allowance;
 *   - `cap`        max(20, ceil(backlog/5)), ≤ 40 weekdays / ≤ 60 Sundays;
 *   - `today`      "N cards for today" — what is left of today's session, so
 *                  the daily session does NOT refill after it is finished;
 *   - `doneForToday` the daily session is finished;
 *   - `dueTomorrow` real reviews due by the end of tomorrow.
 *
 * Questions — the MCQ spaced-repetition queue the Drill "Due review" uses.
 *
 * PURE over (state, cards, now); thin selectors read the live store.
 */
import { getBanks, getCards, getSubtopics } from '../content/loader';
import { buildCuratedDeck, DAILY_SESSION_CAP, type Flashcard } from '../engine/flashcards';
import { BOX_INTERVALS_DAYS, isDue, newCard, review, type SrCard } from '../engine/spaced-repetition';
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

/**
 * Daily flashcard budget (FLOW-QA-2 N5 — the backlog must be clearable):
 *   - at most {@link NEW_CARDS_PER_DAY} never-seen cards are introduced a day,
 *     and only AFTER the due reviews fit (reviews first);
 *   - the day's cap scales with the review backlog:
 *     `max(20, ceil(backlog / 5))`, up to 40 on weekdays and 60 on Sundays.
 */
export const NEW_CARDS_PER_DAY = 15;
/** The floor of the daily cap. */
export const BASE_DAILY_CAP = DAILY_SESSION_CAP;
/** The weekday ceiling of the daily cap. */
export const WEEKDAY_MAX_CAP = 40;
/** The Sunday ceiling of the daily cap. */
export const SUNDAY_MAX_CAP = 60;

/** Today's cap for a review `backlog` on the local day of `now`. PURE. */
export function dailyCap(backlog: number, now: number): number {
  const ceiling = new Date(now).getDay() === 0 ? SUNDAY_MAX_CAP : WEEKDAY_MAX_CAP;
  return Math.min(ceiling, Math.max(BASE_DAILY_CAP, Math.ceil(Math.max(0, backlog) / 5)));
}

/** Extra stamps the flashcard recorder writes on an SR entry (optional, legacy-safe). */
export interface FlashcardStamps {
  /** Epoch ms the card was FIRST graded (introduced). */
  introduced?: number;
  /** Epoch ms the card was last graded. */
  lastReviewed?: number;
}

/**
 * Whether `entry` was introduced (first graded) on the local day of `now`.
 * Uses the `introduced` stamp; a legacy entry without it counts as introduced
 * today only when it looks like a first-time Good today (box 2, no lapses). PURE.
 */
export function introducedOnDay(entry: SrCard, now: number): boolean {
  const stamp = (entry as SrCard & FlashcardStamps).introduced;
  const day = startOfLocalDay(now);
  if (typeof stamp === 'number') return stamp >= day && stamp < day + DAY_MS;
  return entry.box === 2 && entry.lapses === 0 && reviewedOnDay(entry, now);
}

/** The flashcard due numbers shared by every view. */
export interface FlashcardDue {
  /** Cards that count for today: due reviews + today's allowance of new cards. */
  due: number;
  /** Reviewed-before cards that are due now (the review backlog). */
  scheduled: number;
  /** Never-seen cards waiting to be introduced (not "due" — they queue). */
  newWaiting: number;
  /** Never-seen cards introduced today. */
  newToday: number;
  /** Distinct cards graded today. */
  reviewedToday: number;
  /** Today's cap (see {@link dailyCap}). */
  cap: number;
  /** "N cards for today" — what is left of today's session. */
  today: number;
  doneForToday: boolean;
  /** Reviewed-before cards that will be due by the end of tomorrow (real reviews only). */
  dueTomorrow: number;
  /** The deck size (curated cards of revisable topics). */
  deck: number;
}

/** Compute {@link FlashcardDue} for `deck` against an SR map. PURE. */
export function flashcardDue(
  deck: readonly Flashcard[],
  sr: Readonly<Record<string, SrCard>>,
  now: number,
  capOverride?: number,
): FlashcardDue {
  let scheduled = 0;
  let newWaiting = 0;
  let newToday = 0;
  let reviewedToday = 0;
  let dueTomorrow = 0;
  const endOfTomorrow = startOfLocalDay(now) + 2 * DAY_MS;
  for (const c of deck) {
    const entry = sr[c.id];
    if (!entry) {
      newWaiting += 1;
      continue;
    }
    const today = reviewedOnDay(entry, now);
    if (today) reviewedToday += 1;
    if (introducedOnDay(entry, now)) newToday += 1;
    if (isDue(entry, now)) scheduled += 1;
    if (entry.due < endOfTomorrow) dueTomorrow += 1;
  }
  // The cap is fixed from the START-of-day backlog (reviews still due + the
  // reviews already done today) so it does not shrink mid-session.
  const startBacklog = scheduled + Math.max(0, reviewedToday - newToday);
  const cap = capOverride ?? dailyCap(startBacklog, now);
  const capLeft = Math.max(0, cap - reviewedToday);
  const reviewsNow = Math.min(scheduled, capLeft);
  const newAllowance = Math.min(newWaiting, Math.max(0, NEW_CARDS_PER_DAY - newToday), capLeft - reviewsNow);
  const today = reviewsNow + newAllowance;
  return {
    due: scheduled + Math.min(newWaiting, Math.max(0, NEW_CARDS_PER_DAY - newToday)),
    scheduled,
    newWaiting,
    newToday,
    reviewedToday,
    cap,
    today,
    doneForToday: reviewedToday > 0 && today === 0,
    dueTomorrow,
    deck: deck.length,
  };
}

/** Due reviews weakest-first (lowest box, then most overdue). @internal */
function dueReviewsOrdered(
  deck: readonly Flashcard[],
  sr: Readonly<Record<string, SrCard>>,
  now: number,
): Flashcard[] {
  return deck
    .filter((c) => {
      const e = sr[c.id];
      return e !== undefined && isDue(e, now);
    })
    .sort((a, b) => {
      const ea = sr[a.id]!;
      const eb = sr[b.id]!;
      return ea.box !== eb.box ? ea.box - eb.box : ea.due - eb.due;
    });
}

/**
 * Today's session cards: due REVIEWS first (weakest-first), then never-seen
 * cards in deck order up to today's new-card allowance, all within what is LEFT
 * of the daily cap. `keepGoing` ignores the daily cap and new-card limit and
 * offers a fresh {@link DAILY_SESSION_CAP} (reviews still first).
 */
export function todaysSession(
  deck: readonly Flashcard[],
  sr: Readonly<Record<string, SrCard>>,
  now: number,
  keepGoing = false,
): Flashcard[] {
  const reviews = dueReviewsOrdered(deck, sr, now);
  const fresh = deck.filter((c) => sr[c.id] === undefined);
  if (keepGoing) return [...reviews, ...fresh].slice(0, DAILY_SESSION_CAP);
  const d = flashcardDue(deck, sr, now);
  if (d.today <= 0) return [];
  const r = reviews.slice(0, d.today);
  return [...r, ...fresh.slice(0, d.today - r.length)];
}

/** Record one flashcard grade into an SR map entry, stamping first-seen / last-reviewed. PURE. */
export function gradeFlashcard(
  existing: SrCard | undefined,
  id: string,
  grade: 'correct' | 'wrong',
  now: number,
): SrCard & FlashcardStamps {
  const prev = existing as (SrCard & FlashcardStamps) | undefined;
  const next = review(existing ?? newCard(id, now), grade, now) as SrCard & FlashcardStamps;
  next.introduced = prev ? prev.introduced ?? undefined : now;
  if (next.introduced === undefined) delete next.introduced;
  next.lastReviewed = now;
  return next;
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

/** "20 cards for today" / "Done for today — 12 due tomorrow" wording (only real reviews). */
export function flashcardTodayLine(d: FlashcardDue): string {
  if (d.today > 0) return `${d.today} card${d.today === 1 ? '' : 's'} for today`;
  if (d.doneForToday) {
    return d.dueTomorrow > 0 ? `Done for today \u2014 ${d.dueTomorrow} due tomorrow` : 'Done for today';
  }
  return d.deck > 0 ? 'Nothing due right now' : 'No flashcards yet';
}
