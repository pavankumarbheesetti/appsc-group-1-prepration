/**
 * Flashcard derivation — PURE functions only (no DOM, no storage).
 *
 * Turns authored content into a deck of review cards for the Revision view:
 *   - every `NoteItem.keyPoint` becomes a card (front = a cue from the note
 *     title + which point, back = the key point itself), and
 *   - optionally every MCQ becomes a card (front = the question, back = the
 *     correct option, plus its explanation when present).
 *
 * Scheduling REUSES the shared Leitner engine in `spaced-repetition.ts`: a card
 * with no SR entry yet is treated as a fresh {@link newCard} (due now), and
 * {@link isDue} decides whether an existing entry is due. This keeps flashcards
 * and MCQ drills on one identical algorithm.
 */
import type { CardItem, MCQItem, NoteItem } from '../content/types';
import { isDue, newCard, type SrCard } from './spaced-repetition';

/**
 * Where a flashcard was derived from. `'card'` is a CURATED, hand-authored card
 * (content kind `cards`) — the ONLY source used by the live Revise deck now;
 * `'note' | 'cloze' | 'mcq'` are the legacy GENERATED sources kept solely for
 * the Notes "Test yourself" seeding and are no longer part of the Revise deck.
 */
export type FlashcardSource = 'note' | 'mcq' | 'cloze' | 'card';

/**
 * Max cloze (fill-in-the-blank) cards generated per note. Active recall works
 * best in small, high-signal doses — one or two blanks per note keeps the deck
 * focused on the single most salient fact of each key point rather than turning
 * every bullet into a card. @internal
 */
export const CLOZE_CARDS_PER_NOTE = 2;

/** The blank rendered in a cloze prompt where the masked token used to be. */
export const CLOZE_BLANK = '_____';

/** A single derived review card. */
export interface Flashcard {
  /** Stable id, e.g. `fc:<noteId>#<index>` (note) or `fc:<mcqId>` (mcq). */
  id: string;
  /** The prompt/cue shown first. */
  front: string;
  /** The answer revealed on demand. */
  back: string;
  /** Which content type this card was derived from. */
  source: FlashcardSource;
  /** Owning subtopic id — set for CURATED (`'card'`) cards; used for scoping/ordering. */
  subtopicId?: string;
}

/**
 * Build the flashcard deck from `notes` (and optionally `mcqs`).
 *
 * Deterministic: cards are emitted in input order — notes first (each note's
 * key points in order), then MCQs. Notes without `keyPoints` contribute none.
 * @param notes All notes to derive key-point cards from.
 * @param mcqs Optional MCQs to add question→answer cards.
 */
export function buildFlashcards(
  notes: readonly NoteItem[],
  mcqs: readonly MCQItem[] = [],
): Flashcard[] {
  const cards: Flashcard[] = [];

  for (const note of notes) {
    const points = note.keyPoints ?? [];
    points.forEach((point, index) => {
      cards.push({
        id: `fc:${note.id}#${index}`,
        // Cue combines the note title with the point's position — enough
        // context to recall without leaking the answer text.
        front: `${note.title} — key point ${index + 1}`,
        back: point,
        source: 'note',
      });
    });
  }

  for (const mcq of mcqs) {
    const answer = mcq.options[mcq.answerIndex] ?? '';
    const back = mcq.explanation ? `${answer} — ${mcq.explanation}` : answer;
    cards.push({
      id: `fc:${mcq.id}`,
      front: mcq.question,
      back,
      source: 'mcq',
    });
  }

  return cards;
}

/* -------------------------------------------------------------------------- */
/* Cloze (fill-in-the-blank) active-recall cards                               */
/* -------------------------------------------------------------------------- */

/**
 * A word token found in a key-point sentence, with the character span it
 * occupies so it can be masked in place without disturbing punctuation. @internal
 */
interface Token {
  /** Punctuation-trimmed core, e.g. `Mesopotamia`, `1924`, `Mohenjo-daro`. */
  core: string;
  /** Inclusive start offset of `core` within the sentence. */
  start: number;
  /** Exclusive end offset of `core` within the sentence. */
  end: number;
}

/** Matches word-ish runs: letters/digits with internal `-`, `'`, `’`, `.`. @internal */
const WORD_RE = /[A-Za-z0-9][A-Za-z0-9'’.-]*[A-Za-z0-9]|[A-Za-z0-9]/g;

/** True when `core` contains a digit — dates/quantities are highly salient. @internal */
function hasDigit(core: string): boolean {
  return /\d/.test(core);
}

/** True when `core` is a capitalized word of length ≥ 3 (a likely proper noun). @internal */
function isProperNoun(core: string): boolean {
  return /^[A-Z][A-Za-z'’.-]{2,}$/.test(core);
}

/**
 * Pick the single most salient token to blank out of `sentence`, deterministically.
 *
 * Candidates are tokens that are either a NUMBER/date (contain a digit) or a
 * capitalized word (likely a proper noun / key term). Among candidates we mask
 * the LONGEST core; ties break to the EARLIEST occurrence so the choice is
 * stable across runs. Returns `undefined` when the sentence has no suitable
 * token (e.g. an all-lowercase generic sentence) — such points are skipped.
 * @internal
 */
function pickClozeToken(sentence: string): Token | undefined {
  let best: Token | undefined;
  for (const m of sentence.matchAll(WORD_RE)) {
    const core = m[0];
    const start = m.index ?? 0;
    if (!hasDigit(core) && !isProperNoun(core)) continue;
    if (
      best === undefined ||
      core.length > best.core.length ||
      (core.length === best.core.length && start < best.start)
    ) {
      best = { core, start, end: start + core.length };
    }
  }
  return best;
}

/**
 * Build CLOZE (fill-in-the-blank) active-recall cards from note `keyPoints`.
 *
 * For each key point we mask ONE salient token (a number/date or a proper noun,
 * chosen by {@link pickClozeToken}) so the front becomes the sentence with a
 * `_____` blank and the back reveals the masked term plus the full point. Points
 * with no suitable token are skipped, and each note contributes at most
 * {@link CLOZE_CARDS_PER_NOTE} cards (the first qualifying points, in order).
 *
 * Deterministic: notes and points are visited in input order and token choice
 * is stable. Ids are `cz:<noteId>#<pointIndex>`, unique across the deck because
 * both the note id and the point index are unique. Pure — no DOM, no storage.
 */
export function buildClozeCards(notes: readonly NoteItem[]): Flashcard[] {
  const cards: Flashcard[] = [];
  for (const note of notes) {
    const points = note.keyPoints ?? [];
    let made = 0;
    for (let index = 0; index < points.length; index += 1) {
      if (made >= CLOZE_CARDS_PER_NOTE) break;
      const point = points[index] ?? '';
      const token = pickClozeToken(point);
      if (!token) continue; // no salient token → skip this point
      const front = `${point.slice(0, token.start)}${CLOZE_BLANK}${point.slice(token.end)}`;
      cards.push({
        id: `cz:${note.id}#${index}`,
        front,
        back: `${token.core} — ${point}`,
        source: 'cloze',
      });
      made += 1;
    }
  }
  return cards;
}

/**
 * Build the full REVISION deck for active recall: key-point cards + cloze
 * fill-in-the-blank cards (+ optional MCQ cards). This is what the Revise runner
 * and the Learn workspace schedule through the shared Leitner SR. Deterministic
 * ordering: for the whole note set, key-point cards first, then cloze cards,
 * then any MCQ cards (mirroring {@link buildFlashcards}'s note→mcq order).
 */
export function buildDeck(
  notes: readonly NoteItem[],
  mcqs: readonly MCQItem[] = [],
): Flashcard[] {
  return [...buildFlashcards(notes, mcqs), ...buildClozeCards(notes)];
}

/**
 * Return the cards that are DUE at `now`, in deck order.
 *
 * A card missing from `srMap` is a brand-new card and is due immediately
 * (via {@link newCard}); an existing entry is due per {@link isDue}. Pure — no
 * input is mutated.
 */
export function selectDue(
  cards: readonly Flashcard[],
  srMap: Readonly<Record<string, SrCard>>,
  now: number,
): Flashcard[] {
  return cards.filter((card) => {
    const sr = srMap[card.id] ?? newCard(card.id, now);
    return isDue(sr, now);
  });
}

/* -------------------------------------------------------------------------- */
/* Curated deck (content kind `cards`) — the ONLY live Revise deck             */
/* -------------------------------------------------------------------------- */

/**
 * The default cap on a single day's review SESSION. A working professional
 * cannot clear hundreds of "due" cards at once, so the runner opens on at most
 * this many — "20 cards for today" — rather than the raw due count.
 */
export const DAILY_SESSION_CAP = 20;

/**
 * Build the live Revise deck from CURATED cards (content kind `cards`).
 *
 * Each {@link CardItem} maps 1:1 to a {@link Flashcard} — `front` is the
 * authored question, `back` the authored answer, `source` is `'card'`, and the
 * owning `subtopicId` is carried through for per-subtopic scoping and ordering.
 * Deterministic: cards are emitted in input (authoring) order. Pure.
 */
export function buildCuratedDeck(cards: readonly CardItem[]): Flashcard[] {
  return cards.map((c) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    source: 'card' as const,
    subtopicId: c.subtopicId,
  }));
}

/**
 * Pick today's review SESSION from a curated deck: the DUE cards, weakest-first
 * (lowest Leitner box, then most-overdue), capped at `cap` (default
 * {@link DAILY_SESSION_CAP}). Weakest-first surfaces the cards a learner is
 * struggling with before the well-known ones. Pure — inputs are not mutated.
 */
export function selectSession(
  cards: readonly Flashcard[],
  srMap: Readonly<Record<string, SrCard>>,
  now: number,
  cap: number = DAILY_SESSION_CAP,
): Flashcard[] {
  const due = selectDue(cards, srMap, now);
  const weight = (card: Flashcard): { box: number; due: number } => {
    const sr = srMap[card.id] ?? newCard(card.id, now);
    return { box: sr.box, due: sr.due };
  };
  const ordered = [...due].sort((a, b) => {
    const wa = weight(a);
    const wb = weight(b);
    if (wa.box !== wb.box) return wa.box - wb.box; // weaker (lower box) first
    return wa.due - wb.due; // then most overdue first
  });
  return cap > 0 ? ordered.slice(0, cap) : ordered;
}
