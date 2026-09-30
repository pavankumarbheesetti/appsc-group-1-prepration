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
import { navigate } from '../router/router';
import { loadState } from '../state/store';
import { el, mount } from './dom';
import { mountQuiz } from './quiz';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';
import { icon } from './components/icon';

/** Build an id → MCQItem lookup across every MCQ bank. @internal */
function mcqById(): Map<string, MCQItem> {
  const map = new Map<string, MCQItem>();
  for (const { bank } of getBanks('mcq')) {
    if (bank.kind !== 'mcq') continue;
    for (const item of bank.items) map.set(item.id, item);
  }
  return map;
}

/** Render the notebook into `root`. */
export function render(root: HTMLElement): void {
  drawList(root);
}

/** Draw the list of active entries. @internal */
function drawList(root: HTMLElement): void {
  const state = loadState();
  const items = mcqById();
  const active = activeEntries(state.notebook);

  if (active.length === 0) {
    mount(
      root,
      card({ title: 'Wrong-answer notebook' }, [
        el('div', { class: 'empty-state' }, [
          el('span', { class: 'empty-icon' }, [icon('check', 26)]),
          el('h3', { text: 'Notebook clear' }),
          el('p', { text: 'Miss a question in a drill and it lands here until you nail it twice in a row.' }),
          button({ label: 'Start a drill', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/drill') }),
        ]),
      ]),
    );
    return;
  }

  const header = card(
    { title: 'Wrong-answer notebook', subtitle: `${active.length} active · answer each correctly twice in a row to graduate` },
    [
      el('div', { class: 'focus-advance' }, [
        button({ label: `Review all ${active.length}`, variant: 'primary', iconName: 'arrow-right', onClick: () => review(root) }),
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
      el('p', { class: 'review-q', text: item ? item.question : `(missing question: ${entry.id})` }),
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

  mountQuiz(root, due, () => {
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
  });
}
