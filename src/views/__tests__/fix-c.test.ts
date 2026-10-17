import { describe, it, expect, beforeEach } from 'vitest';
import * as mock from '../mock';
import * as notebook from '../notebook';
import * as progress from '../progress';
import * as learn from '../learn';
import * as today from '../today';
import { renderFlashcards, collectCuratedCards } from '../revise';
import { flashcardDue } from '../../lib/due';
import { __resetForTests, loadState, recordTestAttempt, updateState } from '../../state/store';
import { markTopicStudied } from '../../lib/study-status';
import { clearTestSession, saveTestSession } from '../../lib/test-session';
import { localISO } from '../../lib/review-scope';
import { newCard, review } from '../../engine/spaced-repetition';
import { getSubtopic } from '../../content/loader';

/** Press Start on the pre-test instructions screen (shown before every timed test). */
function startTimer(root: HTMLElement): void {
  const b = [...root.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.includes('Start the test'));
  if (!b) throw new Error('instructions screen missing');
  b.click();
}

/**
 * Fix C view behaviour: D14 inline math in MCQ options/lists, D11/H5 one study
 * status model, D13 shared due counts (no same-day refill), M5 scoped review
 * blocks, D16 resume card on Today.
 */
function byText(root: ParentNode, sel: string, text: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(sel)].find((n) => n.textContent?.includes(text));
}

function reset(): void {
  try {
    localStorage.clear();
  } catch {
    /* memory fallback */
  }
  __resetForTests();
  clearTestSession();
  document.body.replaceChildren();
}

const STONE = 'hist-ancient-stone-age';
const EXP_Q = 'ment-number-system-mcq-31'; // options: 1.2 × 10^{6} …

describe('D14 — MCQ options render ^{} as superscripts everywhere', () => {
  beforeEach(() => {
    reset();
    location.hash = '#/mock';
  });

  it('mock running + review options show <sup>, never raw "^{"', () => {
    mock.openMock({ scopeKind: 'subtopic', subtopicId: 'ment-number-system' });
    const root = document.createElement('div');
    mock.render(root);
    const lens = [...root.querySelectorAll<HTMLElement>('.mock-len-btn')];
    lens[lens.length - 1]!.click(); // the whole bank ("All")
    byText(root, 'button', 'Start mock')!.click();
    startTimer(root);
    // Jump through the grid until the exponent question is shown.
    const cells = [...root.querySelectorAll<HTMLElement>('.mock-grid-cell')];
    let found = false;
    for (let i = 0; i < cells.length && !found; i += 1) {
      root.querySelectorAll<HTMLElement>('.mock-grid-cell')[i]!.click();
      found = (root.querySelector('.option-list')?.textContent ?? '').includes('1.2 × 10');
    }
    expect(found).toBe(true);
    const opts = root.querySelector('.option-list')!;
    expect(opts.textContent).not.toContain('^{');
    expect(opts.querySelector('.option-body sup')!.textContent).toBe('6');
    // Submit → the review list renders the same way.
    byText(root, 'button', 'Submit test')!.click();
    byText(document.querySelector<HTMLElement>('.confirm-panel')!, 'button', 'Submit test')!.click();
    const review = root.querySelector('.mock-review')!;
    expect(review.textContent).not.toContain('^{');
    expect(review.querySelectorAll('.option-body sup').length).toBeGreaterThan(0);
  });

  it('the notebook list renders question superscripts', () => {
    updateState((s) => {
      s.notebook[EXP_Q] = { id: EXP_Q, addedAt: 1, consecutiveCorrect: 0, graduated: false };
    });
    const root = document.createElement('div');
    notebook.render(root);
    const q = root.querySelector('.review-q')!;
    expect(q.textContent).not.toContain('^{');
  });
});

describe('D11/H5 — one study-status model', () => {
  beforeEach(() => {
    reset();
    location.hash = '';
  });

  it('Learn header shows ONE status chip from study-status, accuracy separately', () => {
    location.hash = `#/learn/${STONE}`;
    const root = document.createElement('div');
    learn.render(root);
    const badges = root.querySelector('.learn-badges')!;
    expect(badges.querySelectorAll('.study-status-chip')).toHaveLength(1);
    // Opening the notes makes it "In progress" — never "Not started" + another chip.
    expect(badges.textContent).toContain('In progress');
    expect(badges.textContent).not.toContain('Not started');
    expect(badges.textContent).not.toContain('Learning');
    expect(root.querySelector('.learn-header')!.textContent).toContain('Accuracy');

    markTopicStudied(STONE, true);
    const again = document.createElement('div');
    learn.render(again);
    const chips = again.querySelectorAll('.learn-badges .study-status-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0]!.textContent).toContain('Studied \u2713');
    expect(again.querySelector('.learn-badges')!.textContent).not.toContain('In progress');
  });

  it('Progress shows "Studied N of 117" and is NOT empty when topics are studied but nothing answered', () => {
    markTopicStudied(STONE, true);
    markTopicStudied('ment-number-system', true);
    const root = document.createElement('div');
    progress.render(root);
    expect(root.textContent).not.toContain('No progress yet');
    expect(root.textContent).toContain('Studied 2 of 117');
    // Per-subject studied counts from the same source.
    expect(root.textContent).toContain('Studied 1 of 47');
    expect(root.textContent).toContain('Studied 1 of 17');
    // The row chip uses the study vocabulary; the bar is "Accuracy".
    expect(root.querySelector('.track-row .study-status-chip')).not.toBeNull();
    expect(root.querySelector('.track-row')!.textContent).toContain('Accuracy');
  });

  it('Progress empty state only when nothing is studied or answered', () => {
    const root = document.createElement('div');
    progress.render(root);
    expect(root.textContent).toContain('No progress yet');
  });
});

describe('D13 — one due count; the daily 20 does not refill', () => {
  beforeEach(() => {
    reset();
    location.hash = '#/revise/flashcards';
  });

  it('after finishing today\u2019s cards Revise says "Done for today — N more due tomorrow" with Keep going', () => {
    // Study enough topics that more than 20 curated cards are due.
    for (const id of [STONE, 'hist-ancient-ivc', 'hist-ancient-early-vedic', 'ment-number-system']) markTopicStudied(id, true);
    const deck = collectCuratedCards();
    expect(deck.length).toBeGreaterThan(20);
    // Grade 20 cards Good today (as a finished session would).
    const now = Date.now();
    updateState((s) => {
      for (const c of deck.slice(0, 20)) s.flashcards[c.id] = review(newCard(c.id, now), 'correct', now);
    });
    const root = document.createElement('div');
    renderFlashcards(root);
    const done = root.querySelector('[data-state="done-for-today"]');
    expect(done).not.toBeNull();
    expect(root.textContent).toContain('Done for today');
    // Unseen cards queue (≤ 15 new a day) — they are never claimed as "due tomorrow".
    expect(root.textContent).not.toMatch(/more due tomorrow/);
    const keep = byText(root, 'a', 'Keep going')!;
    expect(keep).not.toBeUndefined();
    keep.click();
    expect(root.querySelector('.flashcard-cue')).not.toBeNull();
  });

  it('Progress shows the same "for today" number Revise uses', () => {
    markTopicStudied(STONE, true);
    // Expectation comes from the app's own due-count source of truth (new cards are
    // capped per day), so the test cannot drift from the rule it is checking.
    const n = flashcardDue(collectCuratedCards(), loadState().flashcards, Date.now()).today;
    const root = document.createElement('div');
    progress.render(root);
    const tile = byText(root, '.pv-stat', 'Flashcards for today')!;
    expect(tile.querySelector('.pv-stat-value')!.textContent).toBe(String(n));
  });
});

describe('M5 — review blocks open that day\u2019s wrong + guessed answers', () => {
  beforeEach(() => {
    reset();
    location.hash = '';
  });

  it('lists the test\u2019s wrong and correct-but-guessed questions, scoped', () => {
    const ivc = getSubtopic('hist-ancient-ivc')!.mcqs;
    const wrongId = ivc[0]!.id;
    const guessId = ivc[1]!.id;
    updateState((s) => {
      s.progress[wrongId] = { seen: 1, correct: 0, wrong: 1, lastResult: 'wrong' };
      s.progress[guessId] = { seen: 1, correct: 1, wrong: 0, lastResult: 'correct', lastConfidence: 'guess' };
    });
    recordTestAttempt({
      at: Date.now(),
      kind: 'week-test',
      total: 2,
      attempted: 2,
      correct: 1,
      wrong: 1,
      skipped: 0,
      net: 0.67,
      guessAttempted: 1,
      guessCorrect: 1,
      marksLostToWrong: 0.33,
      ...({ dateISO: localISO(Date.now()), reviewIds: [wrongId, guessId] } as object),
    });
    notebook.openScopedReview([wrongId, guessId], 'Review today\u2019s week test', 'Wrong + guessed.');
    const root = document.createElement('div');
    notebook.render(root);
    expect(root.querySelector('[data-scope="test-review"]')).not.toBeNull();
    expect(root.querySelectorAll('.review-card')).toHaveLength(2);
    expect(root.textContent).toContain('Guessed \u2014 correct');
    expect(root.textContent).toContain('Wrong');
    expect(byText(root, 'button', 'Review these 2')).not.toBeUndefined();
    // The record keeps its review ids for the block.
    expect((loadState().testAttempts.at(-1) as { reviewIds?: string[] }).reviewIds).toEqual([wrongId, guessId]);
  });
});

describe('D16 — Today offers "Resume test" for an autosaved test', () => {
  beforeEach(() => {
    reset();
    location.hash = '';
  });

  it('shows the resume card with progress + time left, and Resume opens the Mock page', () => {
    const ids = getSubtopic('hist-ancient-ivc')!.mcqs.slice(0, 3).map((m) => m.id);
    saveTestSession({
      v: 1,
      kind: 'week-test',
      title: 'Week test \u00b7 3 Q',
      itemIds: ids,
      selected: [1, null, null],
      confidences: [null, null, null],
      flagged: [false, false, false],
      idx: 1,
      remainingMs: 125_000,
      durationMs: 180_000,
      savedAt: Date.now(),
      results: { type: 'week', dateISO: '2026-10-17', count: 3, requested: 3, durationMin: 3, sectionByIndex: ['paper1', 'paper1', 'paper1'], short: false },
    });
    const root = document.createElement('div');
    today.render(root);
    const cardEl = root.querySelector('.resume-test-card');
    expect(cardEl).not.toBeNull();
    expect(cardEl!.textContent).toContain('Unfinished: Week test');
    expect(cardEl!.textContent).toContain('1 of 3 answered');
    expect(cardEl!.textContent).toContain('2:05 left');
    byText(cardEl!, 'button', 'Resume test')!.click();
    expect(location.hash).toBe('#/practice/mock');
    const view = document.createElement('div');
    mock.render(view);
    expect(view.querySelector('.mock-running')).not.toBeNull();
    expect(view.textContent).toContain('Question 2 of 3');
  });
});
