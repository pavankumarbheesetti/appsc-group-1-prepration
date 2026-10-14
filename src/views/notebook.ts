/**
 * Notebook view — the active wrong-answer review stack.
 *
 * Lists every non-graduated {@link NotebookEntry} as a review card with a
 * streak meter (progress toward the 2-in-a-row graduation rule), and offers a
 * "Review" action that quizzes ALL active entries via the shared focus runner.
 * A satisfying empty state shows when nothing is due. Wired to the SAME
 * notebook selection + quiz recording logic as before.
 */
import { getBanks } from '../content/loader';
import type { MCQItem } from '../content/types';
import { activeEntries, selectReviewItems, GRADUATION_THRESHOLD } from '../engine/notebook';
import { navigate, routeQuery } from '../router/router';
import { loadState } from '../state/store';
import { el, mount, renderPreview } from './dom';
import { mountQuiz, type QuizSessionOpts } from './quiz';
import { clearDrillSession, resumeText, scopeHash, withResume } from '../lib/drill-session';
import { pausedDrill, resumeDrill, resumeItems } from './drill-resume';
import { PATHS } from './shell';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';
import { icon } from './components/icon';
import { completeActiveTask } from '../lib/day-tasks';
import { attemptVerdict, type ReviewableAttempt } from '../lib/review-scope';

/** Build an id → MCQItem lookup across every MCQ bank. @internal */
function mcqById(): Map<string, MCQItem> {
  const map = new Map<string, MCQItem>();
  for (const { bank } of getBanks('mcq')) {
    if (bank.kind !== 'mcq') continue;
    for (const item of bank.items) map.set(item.id, item);
  }
  return map;
}

/** A one-shot scoped review request set by {@link openScopedReview}. @internal */
interface ScopedReview {
  ids: string[];
  title: string;
  lead: string;
}
let pendingScoped: ScopedReview | null = null;

/**
 * Open the notebook page on a SCOPED list (e.g. a review block's "today's wrong
 * + guessed answers") instead of the whole notebook.
 */
export function openScopedReview(ids: readonly string[], title: string, lead: string): void {
  pendingScoped = { ids: [...ids], title, lead };
  navigate('/revise/mistakes');
}

/** The paused-drill key of the whole-notebook review. */
export const NOTEBOOK_DRILL_KEY = 'notebook';

/** The paused-drill key of a scoped review list. @internal */
function scopedKey(ids: readonly string[]): string {
  return `notebook:${scopeHash(ids)}`;
}

/** Resumability of a notebook review run. @internal */
function reviewSession(key: string, label: string, backPath: string): QuizSessionOpts {
  return { key, label, route: withResume(PATHS.mistakes, key), backPath };
}

/** Render the notebook into `root`. */
export function render(root: HTMLElement): void {
  const scoped = pendingScoped;
  pendingScoped = null;
  // `?resume=notebook…` (a Resume entry, or a reload mid-review) reopens it.
  const want = routeQuery('resume');
  if (!scoped && want?.startsWith(NOTEBOOK_DRILL_KEY) && pausedDrill(want)) {
    const saved = pausedDrill(want)!;
    const list = resumeItems(want);
    if (list) {
      const whole = want === NOTEBOOK_DRILL_KEY;
      mountQuiz(root, list, () => {
        if (!whole) completeActiveTask('review');
        if (whole) reviewDone(root);
        else drawList(root);
      }, { session: reviewSession(want, saved.label, whole ? PATHS.mistakes : '/') });
      return;
    }
  }
  if (scoped) {
    drawScoped(root, scoped);
    return;
  }
  drawList(root);
}

/**
 * The scoped review list: each question with WHY it is listed (wrong, or a
 * correct guess), and one "Review these N" action over exactly these items.
 * @internal
 */
function drawScoped(root: HTMLElement, scoped: ScopedReview): void {
  const items = mcqById();
  const state = loadState();
  const list = scoped.ids.flatMap((id) => {
    const item = items.get(id);
    return item ? [item] : [];
  });
  const backToNotebook = button({ label: 'Whole notebook', variant: 'ghost', onClick: () => drawList(root) });
  if (list.length === 0) {
    mount(
      root,
      card({ title: scoped.title }, [
        el('div', { class: 'empty-state' }, [
          el('span', { class: 'empty-icon' }, [icon('check', 26)]),
          el('h3', { text: 'Nothing to review' }),
          el('p', { text: scoped.ids.length === 0 ? scoped.lead : 'No wrong or guessed answers in that test.' }),
          el('div', { class: 'focus-advance', attrs: { style: 'justify-content:center;flex-wrap:wrap' } }, [
            button({ label: 'Today', variant: 'primary', onClick: () => navigate('/') }),
            backToNotebook,
          ]),
        ]),
      ]),
    );
    return;
  }
  const header = card({ title: scoped.title, subtitle: `${list.length} question${list.length === 1 ? '' : 's'} \u00b7 ${scoped.lead}` }, [
    el('div', { class: 'focus-advance', attrs: { style: 'flex-wrap:wrap' } }, [
      button({
        label: `Review these ${list.length}`,
        variant: 'primary',
        iconName: 'arrow-right',
        onClick: () => {
          const key = scopedKey(list.map((i) => i.id));
          clearDrillSession(key);
          mountQuiz(root, list, () => {
            // The review list is cleared: tick the Today review row (if any).
            completeActiveTask('review');
            drawScoped(root, scoped);
          }, { session: reviewSession(key, scoped.title, '/') });
        },
      }),
      backToNotebook,
    ]),
  ]);
  const stack = el('div', { class: 'review-stack', attrs: { 'data-scope': 'test-review' } }, list.map((item) => {
    // N14: the label comes from the ORIGINAL attempt (its answer + tag), never
    // from a later re-answer in review. Only lists with no recorded sitting
    // (legacy records, practice mistakes) fall back to the last result.
    const verdict = attemptVerdict(state.testAttempts as ReviewableAttempt[], item.id, item.answerIndex)
      ?? (state.progress[item.id]?.lastResult === 'correct' ? 'guess-correct' : 'wrong');
    const tag = verdict === 'wrong'
      ? chip({ text: 'Wrong', tone: 'danger', iconName: 'x' })
      : verdict === 'guess-correct'
        ? chip({ text: 'Guessed \u2014 correct', tone: 'warn', iconName: 'target' })
        : verdict === 'fifty-correct'
          ? chip({ text: '50-50 \u2014 correct', tone: 'warn', iconName: 'target' })
          : chip({ text: 'Correct', tone: 'muted', iconName: 'check' });
    return el('div', { class: 'review-card' }, [
      el('div', { class: 'subject-head' }, [tag]),
      el('p', { class: 'review-q' }, renderPreview(item.question, 220)),
    ]);
  }));
  mount(root, header, stack);
}

/** Draw the list of active entries. @internal */
function drawList(root: HTMLElement): void {
  const state = loadState();
  const items = mcqById();
  const active = activeEntries(state.notebook);
  const paused = pausedDrill(NOTEBOOK_DRILL_KEY);

  if (active.length === 0) {
    mount(
      root,
      card({ title: 'My mistakes' }, [
        el('div', { class: 'empty-state' }, [
          el('span', { class: 'empty-icon' }, [icon('check', 26)]),
          el('h3', { text: 'No mistakes to review' }),
          el('p', { text: 'Miss a question in practice and it lands here until you nail it twice in a row.' }),
          button({ label: 'Start practice', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/practice') }),
        ]),
      ]),
    );
    return;
  }

  const header = card(
    { title: 'My mistakes', subtitle: `${active.length} active · answer each correctly twice in a row to graduate` },
    [
      el('div', { class: 'focus-advance' }, [
        paused
          ? button({ label: resumeText(paused), variant: 'primary', iconName: 'arrow-right', onClick: () => resumeDrill(paused) })
          : null,
        button({ label: paused ? 'Start again' : `Review all ${active.length}`, variant: paused ? 'secondary' : 'primary', iconName: paused ? undefined : 'arrow-right', onClick: () => review(root) }),
      ]),
    ],
  );

  const stack = el('div', { class: 'review-stack' }, active.map((entry) => {
    const item = items.get(entry.id);
    return el('div', { class: 'review-card' }, [
      el('div', { class: 'subject-head' }, [
        chip({ text: 'Needs work', tone: 'warn', iconName: 'flame' }),
        streakMeter(entry.consecutiveCorrect),
      ]),
      item
        ? el('p', { class: 'review-q' }, renderPreview(item.question, 220))
        : el('p', { class: 'review-q', text: `(missing question: ${entry.id})` }),
    ]);
  }));

  mount(root, header, stack);
}

/** A streak meter showing progress toward graduation (x / threshold). @internal */
function streakMeter(streak: number): HTMLElement {
  const pips: HTMLElement[] = [];
  for (let i = 0; i < GRADUATION_THRESHOLD; i += 1) {
    pips.push(el('span', { class: i < streak ? 'streak-pip on' : 'streak-pip' }));
  }
  return el('div', { class: 'streak-meter' }, [
    el('span', { class: 'streak-pips' }, pips),
    el('span', { class: 'tnum', text: `${streak}/${GRADUATION_THRESHOLD}` }),
  ]);
}

/**
 * Quiz every currently ACTIVE (non-graduated) notebook entry via the shared
 * focus runner. Selection is driven by notebook activeness (via
 * {@link selectReviewItems}), NOT the SR schedule — unchanged behaviour. @internal
 */
function review(root: HTMLElement): void {
  const state = loadState();
  const items = mcqById();
  const due = selectReviewItems(state.notebook, items);

  clearDrillSession(NOTEBOOK_DRILL_KEY);
  mountQuiz(root, due, () => reviewDone(root), { session: reviewSession(NOTEBOOK_DRILL_KEY, 'My mistakes \u00b7 Review', PATHS.mistakes) });
}

/** The whole-notebook review's done screen. @internal */
function reviewDone(root: HTMLElement): void {
  mount(
    root,
    el('div', { class: 'results' }, [
      card({}, [
        el('h2', { class: 'card-title', text: 'Review complete' }),
        el('p', { class: 'section-lead', text: 'Nice work — keep chipping away until every card graduates.' }),
        el('div', { class: 'focus-advance', attrs: { style: 'justify-content:center' } }, [
          button({ label: 'Back to notebook', variant: 'primary', onClick: () => drawList(root) }),
          button({ label: 'Today', variant: 'ghost', onClick: () => navigate('/') }),
        ]),
      ]),
    ]),
  );
}
