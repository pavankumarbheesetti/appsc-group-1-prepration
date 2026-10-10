/**
 * Revise — a small HUB for spaced review, plus the flashcard runner itself.
 *
 * The hub (`#/revise`) links the three review surfaces so they are coherent and
 * discoverable: FLASHCARDS (`#/revise/flashcards`, the SR runner below), the
 * wrong-answer NOTEBOOK (`#/notebook`), and WEAK AREAS (`#/progress`, sorted
 * weakest-first).
 *
 * The deck is CURATED ONLY: it is content kind `cards` (hand-authored one-fact
 * cards, {@link getCards}) — never the old generated note/cloze cards. The
 * runner shows at most a daily SESSION ({@link selectSession}, "20 cards for
 * today"), each card is a question (front) → answer (back) with a "Show answer"
 * reveal, then two self-rate buttons — Again (grade `'wrong'`, re-queued into
 * the LIVE session so it comes back before you finish) and Good (grade
 * `'correct'`) — scheduled via {@link review} into the store's `flashcards` SR
 * map. DOM-only; all logic is pure/engine code.
 */
import { getCards, getSubtopics } from '../content/loader';
import { activeEntries } from '../engine/notebook';
import {
  buildCuratedDeck,
  selectSession,
  DAILY_SESSION_CAP,
  type Flashcard,
} from '../engine/flashcards';
import { newCard, review, type Grade } from '../engine/spaced-repetition';
import { navigate } from '../router/router';
import { loadState, updateState } from '../state/store';
import { el, mount, renderInline } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { icon, type IconName } from './components/icon';

/** Collect every CURATED card across all subtopics, in taxonomy order. @internal */
function collectCuratedCards(): Flashcard[] {
  const out: Flashcard[] = [];
  for (const sub of getSubtopics()) out.push(...buildCuratedDeck(getCards(sub.id)));
  return out;
}

/** How many subtopics have at least one curated card authored. @internal */
function readyTopicCount(): number {
  let n = 0;
  for (const sub of getSubtopics()) if (getCards(sub.id).length > 0) n += 1;
  return n;
}

/**
 * Persist one flashcard review outcome: schedule the card in the `flashcards`
 * SR map (creating it on first sighting). Mirrors the MCQ recorder in quiz.ts
 * but writes to the dedicated flashcards namespace. @internal
 */
function recordFlashcard(id: string, grade: Grade): void {
  const now = Date.now();
  updateState((s) => {
    const existing = s.flashcards[id] ?? newCard(id, now);
    s.flashcards[id] = review(existing, grade, now);
  });
}

/** A friendly empty/completed state card. @internal */
function emptyState(root: HTMLElement, heading: string, body: string): void {
  mount(
    root,
    card({ title: 'Revise' }, [
      el('div', { class: 'empty-state' }, [
        el('span', { class: 'empty-icon' }, [icon('sparkles', 26)]),
        el('h3', { text: heading }),
        el('p', { text: body }),
        button({ label: 'Back to Today', variant: 'primary', onClick: () => navigate('/') }),
      ]),
    ]),
  );
}

/** Render the Revise HUB into `root` — links Flashcards, Notebook, Weak areas. */
export function render(root: HTMLElement): void {
  const state = loadState();
  const deck = collectCuratedCards();
  // Today's SESSION size (capped) — the honest "cards for today", not raw due.
  const session = selectSession(deck, state.flashcards, Date.now());
  const ready = readyTopicCount();
  const mistakes = activeEntries(state.notebook).length;

  const flashStatus =
    session.length > 0
      ? `${session.length} card${session.length === 1 ? '' : 's'} for today — test yourself before you peek`
      : deck.length > 0
        ? 'Nothing due right now — you\u2019re ahead on recall'
        : `Flashcards appear here once a topic has been reviewed — ${ready} topic${ready === 1 ? '' : 's'} ready`;

  mount(
    root,
    card(
      { title: 'Revise', subtitle: 'Test yourself before you peek.' },
      [
        el('div', { class: 'revise-hub' }, [
          hubCard(
            'revise',
            'Flashcards due today',
            flashStatus,
            deck.length > 0 ? 'Start recall' : 'How it works',
            () => navigate('/revise/flashcards'),
          ),
          hubCard(
            'notebook',
            'Wrong-answer notebook',
            mistakes > 0 ? `${mistakes} mistake${mistakes === 1 ? '' : 's'} to nail down` : 'Notebook clear',
            'Open notebook',
            () => navigate('/notebook'),
          ),
          hubCard(
            'target',
            'Weak areas',
            'See your weakest subtopics by mastery',
            'View progress',
            () => navigate('/progress'),
          ),
        ]),
      ],
    ),
  );
}

/** One hub tile: icon + title + one-line status + CTA. @internal */
function hubCard(iconName: IconName, title: string, status: string, cta: string, onClick: () => void): HTMLElement {
  return el('div', { class: 'card revise-hub-card', attrs: { role: 'button', tabindex: '0' }, onClick }, [
    el('span', { class: 'empty-icon' }, [icon(iconName, 24)]),
    el('h3', { class: 'revise-hub-title', text: title }),
    el('p', { class: 'section-lead', text: status }),
    button({ label: cta, variant: 'ghost', iconName: 'arrow-right', onClick }),
  ]);
}

/**
 * A one-shot SCOPED-revise request set by {@link openReviseScope} (e.g. the
 * Today "Flashcards for what you studied yesterday" launcher) and consumed once
 * by {@link renderFlashcards}. When set, the runner reviews a curated deck built
 * ONLY from these subtopic ids instead of the whole deck.
 */
let pendingScopeIds: string[] | null = null;

/**
 * Navigate to the flashcard runner scoped to a specific set of subtopic ids —
 * used by the EARLY-REVISE block ("Flashcards for what you studied yesterday")
 * so the beginner always has a non-empty, relevant session even before 10
 * curated cards are due across the whole deck.
 */
export function openReviseScope(subtopicIds: readonly string[]): void {
  pendingScopeIds = [...subtopicIds];
  navigate('/revise/flashcards');
}

/** The curated deck for a specific set of subtopic ids, in order. @internal */
function scopedDeck(ids: readonly string[]): Flashcard[] {
  const out: Flashcard[] = [];
  for (const id of ids) out.push(...buildCuratedDeck(getCards(id)));
  return out;
}

/** Render the flashcard runner (`#/revise/flashcards`) into `root`. */
export function renderFlashcards(root: HTMLElement): void {
  const scope = pendingScopeIds;
  pendingScopeIds = null;
  if (scope !== null) {
    mountFlashcards(root, scopedDeck(scope), () => render(root));
    return;
  }
  mountFlashcards(root, collectCuratedCards(), () => renderFlashcards(root));
}

/**
 * Run a flashcard review over `deck` into `root`: pick today's SESSION (capped),
 * show the appropriate empty/caught-up state, else run the review session.
 * Reused by the Revise route (whole curated deck) and the Learn Notes tab
 * (subtopic-scoped curated deck). `onMore` re-enters the runner ("Revise more");
 * defaults to the Revise hub.
 */
export function mountFlashcards(
  root: HTMLElement,
  deck: readonly Flashcard[],
  onMore: () => void = () => render(root),
): void {
  if (deck.length === 0) {
    const ready = readyTopicCount();
    emptyState(
      root,
      'No flashcards yet',
      `Flashcards appear here once a topic has been reviewed — ${ready} topic${ready === 1 ? '' : 's'} ready.`,
    );
    return;
  }
  const session = selectSession(deck, loadState().flashcards, Date.now());
  if (session.length === 0) {
    emptyState(root, "You're all caught up", 'Nothing is due for recall right now — spaced repetition will resurface these at the right time. 🎉');
    return;
  }
  runReview(root, session, onMore);
}

/**
 * The prompt label shown above a card's front. Curated cards are questions, so
 * the retrieval task reads "Recall this". @internal
 */
function cueLabel(source: Flashcard['source']): string {
  if (source === 'cloze') return 'Fill in the blank';
  if (source === 'mcq') return 'Question';
  return 'Recall this';
}

/**
 * Run the review session over `initial` cards. The working queue is MUTABLE: a
 * card graded "Again" (wrong) is RE-QUEUED to the end so it actually returns
 * before the session ends (fixing the old snapshot bug). The header shows the
 * honest "N cards for today"; the progress bar fills as cards are cleared.
 * @internal
 */
function runReview(root: HTMLElement, initial: readonly Flashcard[], onMore: () => void): void {
  const queue: Flashcard[] = [...initial];
  const sessionSize = queue.length;
  let idx = 0;
  let reviewed = 0;

  /** Thin progress bar reflecting cleared / total-in-queue. */
  const progressBar = (): HTMLElement =>
    el('div', { class: 'focus-progress' }, [
      el('div', {
        class: 'focus-progress-fill',
        attrs: { style: `width:${Math.round((idx / queue.length) * 100)}%` },
      }),
    ]);

  /** Header line: the day's session size (not the raw due count). */
  const statusLine = (): HTMLElement =>
    el('p', { class: 'focus-count tnum', text: `${sessionSize} card${sessionSize === 1 ? '' : 's'} for today · ${reviewed} reviewed` });

  const rate = (cardItem: Flashcard, grade: Grade): void => {
    recordFlashcard(cardItem.id, grade);
    reviewed += 1;
    // "Again" re-queues the card into the LIVE session so it comes back around.
    if (grade === 'wrong') queue.push(cardItem);
    idx += 1;
    draw();
  };

  const draw = (): void => {
    const cardItem = queue[idx];
    if (!cardItem) {
      // Session complete.
      mount(
        root,
        el('div', { class: 'results' }, [
          card({ title: 'Revision complete' }, [
            el('div', { class: 'empty-state' }, [
              el('span', { class: 'empty-icon' }, [icon('check', 26)]),
              el('h3', { text: `Reviewed ${reviewed} card${reviewed === 1 ? '' : 's'}` }),
              el('p', { text: 'Nice work — spaced repetition will resurface these at the right time.' }),
              el('div', { class: 'focus-advance', attrs: { style: 'justify-content:center;flex-wrap:wrap' } }, [
                button({ label: 'Revise more', variant: 'primary', onClick: () => onMore() }),
                button({ label: 'Today', variant: 'ghost', onClick: () => navigate('/') }),
              ]),
            ]),
          ]),
        ]),
      );
      return;
    }

    // Front (question) with a reveal button; the answer is only shown on demand
    // so the learner actively recalls first. Centred reading column via CSS.
    const stage = el('section', { class: 'focus-stage flashcard-stage', attrs: { tabindex: '-1', 'aria-live': 'polite' } });
    const revealBtn = button({
      label: 'Show answer',
      variant: 'primary',
      iconName: 'arrow-right',
      onClick: () => reveal(),
    });

    const reveal = (): void => {
      const rated = el('div', { class: 'flashcard-answer' }, [
        el('p', { class: 'flashcard-answer-label', text: 'Answer' }),
        el('p', { class: 'flashcard-answer-text' }, renderInline(cardItem.back)),
      ]);
      const controls = el('div', { class: 'focus-advance', attrs: { style: 'flex-wrap:wrap' } }, [
        button({ label: 'Again', variant: 'secondary', onClick: () => rate(cardItem, 'wrong') }),
        button({ label: 'Good', variant: 'primary', iconName: 'check', onClick: () => rate(cardItem, 'correct') }),
      ]);
      stage.replaceChildren(
        progressBar(),
        statusLine(),
        el('div', { class: 'card question-card flashcard' }, [
          el('p', { class: 'flashcard-cue-label', text: cueLabel(cardItem.source) }),
          el('h2', { class: 'flashcard-cue' }, renderInline(cardItem.front)),
          rated,
        ]),
        controls,
      );
    };

    stage.append(
      progressBar(),
      statusLine(),
      el('div', { class: 'card question-card flashcard' }, [
        el('p', { class: 'flashcard-cue-label', text: cueLabel(cardItem.source) }),
        el('h2', { class: 'flashcard-cue' }, renderInline(cardItem.front)),
      ]),
      el('div', { class: 'focus-advance' }, [revealBtn]),
    );
    mount(root, stage);
    stage.focus();
  };

  draw();
}

/** Re-export for callers that scope a curated deck to a subtopic. */
export { buildCuratedDeck, DAILY_SESSION_CAP };
