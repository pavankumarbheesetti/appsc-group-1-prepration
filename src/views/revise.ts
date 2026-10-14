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
import { getCards, getSubtopic, getSubtopics } from '../content/loader';
import { isRevisable } from '../lib/study-status';
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
import { flashcardDue, flashcardTodayLine, revisableCuratedCards, todaysSession } from '../lib/due';
import { completeActiveTask } from '../lib/day-tasks';
import { el, mount, renderInline } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { icon, type IconName } from './components/icon';
import { subtopicMasteryPct } from '../lib/metrics';
import { nextUpFooter, PATHS } from './shell';
import { nextStep } from './next-topic';

/** Topics with answered questions and accuracy under 60% (the "Weak topics" count). */
export function weakTopicCount(): number {
  const { progress } = loadState();
  let n = 0;
  for (const sub of getSubtopics()) {
    const view = getSubtopic(sub.id);
    if (!view || view.mcqs.length === 0) continue;
    const ids = view.mcqs.map((m) => m.id);
    if (!ids.some((id) => (progress[id]?.seen ?? 0) > 0)) continue;
    if (subtopicMasteryPct(progress, ids) < 60) n += 1;
  }
  return n;
}

/**
 * The subtopic ids whose curated cards may be reviewed: studied, or in progress
 * with at least one practice question answered (see {@link isRevisable}). Cards
 * of topics the learner has not studied are NEVER due. Taxonomy order.
 */
export function revisableTopicIds(): string[] {
  const state = loadState();
  return getSubtopics()
    .filter((sub) => getCards(sub.id).length > 0 && isRevisable(sub.id, state))
    .map((sub) => sub.id);
}

/** Collect every CURATED card of the REVISABLE (studied) topics, in taxonomy order. */
export function collectCuratedCards(): Flashcard[] {
  return revisableCuratedCards();
}

/** Topic names the given cards come from, in first-seen order. @internal */
function topicNamesOf(cards: readonly Flashcard[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cards) {
    const id = c.subtopicId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(getSubtopic(id)?.meta.name ?? id);
  }
  return out;
}

/** "Cards from: Stone Age, Indus Valley (+2 more)". @internal */
export function cardsFromLine(cards: readonly Flashcard[]): string {
  const names = topicNamesOf(cards);
  if (names.length === 0) return '';
  const shown = names.slice(0, 3).join(', ');
  return `Cards from: ${shown}${names.length > 3 ? ` (+${names.length - 3} more)` : ''}`;
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
  const now = Date.now();
  // Today's SESSION size: min(due, what is left of the daily cap) — the SAME
  // number Today and Progress show (lib/due.ts), and it does not refill.
  const due = flashcardDue(deck, state.flashcards, now);
  const session = todaysSession(deck, state.flashcards, now);
  const ready = readyTopicCount();
  const mistakes = activeEntries(state.notebook).length;
  const weak = weakTopicCount();

  const from = cardsFromLine(session);
  const flashStatus =
    due.today > 0
      ? `${flashcardTodayLine(due)} — test yourself before you peek.${from ? ` ${from}.` : ''}`
      : due.doneForToday
        ? `${flashcardTodayLine(due)}.`
        : deck.length > 0
          ? 'Nothing due right now — you\u2019re ahead on recall'
          : `Flashcards appear once you study a topic (Mark as studied, or answer its practice questions) — ${ready} topic${ready === 1 ? '' : 's'} have cards`;

  mount(
    root,
    card(
      { title: 'Revise', subtitle: 'Test yourself before you peek.' },
      [
        el('div', { class: 'revise-hub' }, [
          hubCard(
            'revise',
            `Flashcards due (${due.today})`,
            flashStatus,
            deck.length > 0 ? 'Start recall' : 'How it works',
            () => navigate('/revise/flashcards'),
          ),
          hubCard(
            'notebook',
            `My mistakes (${mistakes})`,
            mistakes > 0 ? `${mistakes} mistake${mistakes === 1 ? '' : 's'} to nail down` : 'No mistakes to review',
            'Open my mistakes',
            () => navigate(PATHS.mistakes),
          ),
          hubCard(
            'target',
            `Weak topics (${weak})`,
            'Your weakest topics by accuracy',
            'View weak topics',
            () => navigate(PATHS.progress),
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
  const state = loadState();
  const out: Flashcard[] = [];
  // Even a scoped session never includes a topic the learner has not studied.
  for (const id of ids) if (isRevisable(id, state)) out.push(...buildCuratedDeck(getCards(id)));
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
  mountFlashcards(root, collectCuratedCards(), () => renderFlashcards(root), { daily: true });
}

/**
 * Whether the next whole-deck entry should ignore the daily cap ("Keep going"
 * after the day's session is done). One-shot. @internal
 */
let keepGoingOnce = false;

/**
 * "Done for today — N more due tomorrow" after the day's capped session, with
 * an optional "Keep going" link when cards are still due now. @internal
 */
function doneForTodayState(
  root: HTMLElement,
  dueTomorrow: number,
  dueNow: number,
  onKeepGoing: (() => void) | null,
): void {
  const heading = dueTomorrow > 0 ? `Done for today \u2014 ${dueTomorrow} more due tomorrow` : 'Done for today';
  mount(
    root,
    card({ title: 'Revise' }, [
      el('div', { class: 'empty-state', attrs: { 'data-state': 'done-for-today' } }, [
        el('span', { class: 'empty-icon' }, [icon('check', 26)]),
        el('h3', { text: heading }),
        el('p', { text: 'You finished today\u2019s cards. Short daily sessions beat one long cram \u2014 come back tomorrow.' }),
        el('div', { class: 'focus-advance', attrs: { style: 'justify-content:center;flex-wrap:wrap' } }, [
          button({ label: 'Back to Today', variant: 'primary', onClick: () => navigate('/') }),
          onKeepGoing && dueNow > 0
            ? el('a', {
                class: 'btn btn-ghost',
                href: '#/revise/flashcards',
                text: `Keep going (${dueNow} due now)`,
                onClick: (e) => {
                  e.preventDefault();
                  onKeepGoing();
                },
              })
            : null,
        ]),
      ]),
    ]),
  );
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
  opts: { daily?: boolean } = {},
): void {
  if (deck.length === 0) {
    const ready = readyTopicCount();
    emptyState(
      root,
      'No flashcards yet',
      `Flashcards appear here once you study a topic — tap Mark as studied on its Learn page, or answer its practice questions. ${ready} topic${ready === 1 ? '' : 's'} have cards.`,
    );
    return;
  }
  const sr = loadState().flashcards;
  const now = Date.now();
  if (opts.daily) {
    // The whole-deck daily session: capped by what is LEFT of today's 20, so
    // finishing it shows "Done for today" instead of refilling a fresh 20.
    const keepGoing = keepGoingOnce;
    keepGoingOnce = false;
    const daily = todaysSession(deck, sr, now, keepGoing);
    if (daily.length > 0) {
      runReview(root, daily, onMore);
      return;
    }
    const due = flashcardDue(deck, sr, now);
    if (due.doneForToday) {
      // Nothing left for today: the Today row that opened this session is done.
      completeActiveTask('flashcards');
      doneForTodayState(root, due.dueTomorrow, due.due, () => {
        keepGoingOnce = true;
        mountFlashcards(root, deck, onMore, opts);
      });
      return;
    }
  }
  const session = opts.daily ? [] : selectSession(deck, sr, now);
  if (session.length === 0) {
    completeActiveTask('flashcards');
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
  const fromLine = cardsFromLine(initial);
  const statusLine = (): HTMLElement =>
    el('div', {}, [
      el('p', { class: 'focus-count tnum', text: `${sessionSize} card${sessionSize === 1 ? '' : 's'} for today · ${reviewed} reviewed` }),
      fromLine ? el('p', { class: 'section-lead revise-from', text: fromLine }) : null,
    ]);

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
      // Session complete: tick the Today row that started it (if any).
      completeActiveTask('flashcards');
      const after = flashcardDue(revisableCuratedCards(), loadState().flashcards, Date.now());
      const next = nextStep();
      // When the day's plan is done, the next step is a weak topic (if any).
      const primary = next.kind === 'done' && weakTopicCount() > 0
        ? { label: `Practise weak topics (${weakTopicCount()})`, onClick: () => navigate(PATHS.progress) }
        : next.kind === 'done'
          ? { label: 'Back to Today', onClick: () => navigate(PATHS.today) }
          : { label: next.kind === 'topic' ? `Next: today\u2019s topic \u2014 ${next.name ?? ''}` : next.label, onClick: next.go };
      mount(
        root,
        el('div', { class: 'results' }, [
          card({ title: 'Revision complete' }, [
            el('div', { class: 'empty-state' }, [
              el('span', { class: 'empty-icon' }, [icon('check', 26)]),
              el('h3', { text: `Reviewed ${reviewed} card${reviewed === 1 ? '' : 's'}` }),
              el('p', { text: 'Nice work — spaced repetition will resurface these at the right time.' }),
            ]),
          ]),
          nextUpFooter({
            eyebrow: `${reviewed} card${reviewed === 1 ? '' : 's'} reviewed \u00b7 ${after.dueTomorrow} due tomorrow`,
            primary,
            secondary: [{ label: 'Revise more', onClick: () => onMore() }],
          }),
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
