/**
 * Day-1 real-use fixes: explicit "Mark as studied" status on Today (row ticks,
 * the "Up now" hero moving on, restart-from-today on the behind banner), the
 * Revise deck / early-revise block scoped to STUDIED topics only, and the
 * Telugu block as the next lesson with an explicit target.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as today from '../today';
import { collectCuratedCards, renderFlashcards } from '../revise';
import * as telugu from '../telugu';
import { studyMarkBar } from '../learn';
import { getSubtopic } from '../../content/loader';
import { TELUGU_LESSONS } from '../../content/telugu';
import { buildLessonCheck, lessonForDay, lessonTarget } from '../../lib/telugu';
import { markTopicStudied, topicStatus } from '../../lib/study-status';
import {
  __resetForTests,
  getTeluguLessonsDone,
  loadState,
  setPlanStartDate,
  setTeluguLessonDone,
} from '../../state/store';

const STONE = 'hist-ancient-stone-age';
const IVC = 'hist-ancient-ivc';
const N = TELUGU_LESSONS.length;

function setClock(iso: string): void {
  vi.setSystemTime(new Date(`${iso}T10:00:00`));
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const b = [...root.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.includes(text));
  if (!b) throw new Error(`button not found: ${text}`);
  return b;
}

function renderToday(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  today.render(root);
  return root;
}

function heroTitle(root: HTMLElement): string {
  return root.querySelector('.hero-now-title')?.textContent ?? '';
}

function row(root: HTMLElement, text: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>('.today-check')].find((r) => r.textContent?.includes(text));
}

beforeEach(() => {
  localStorage.clear();
  __resetForTests();
  location.hash = '';
  document.body.innerHTML = '';
  vi.useFakeTimers({ toFake: ['Date'] });
  setClock('2026-10-13');
});
afterEach(() => vi.useRealTimers());

describe('Today — behind banner with "restart my plan from today"', () => {
  it('offers the restart option; confirming moves the start to today, keeps progress, clears "behind"', () => {
    setPlanStartDate('2026-10-10');
    markTopicStudied('ment-number-system', true, '2026-10-11');
    const studyBefore = structuredClone(loadState().study);
    const root = renderToday();
    expect(root.textContent).toContain('days behind');
    buttonByText(root, 'restart my plan from today').click();
    // A confirm step first — nothing changed yet.
    expect(loadState().settings.planStartDate).toBe('2026-10-10');
    buttonByText(root, 'Yes, restart from today').click();
    expect(loadState().settings.planStartDate).toBe('2026-10-13');
    expect(loadState().study).toEqual(studyBefore);
    expect(root.textContent).not.toContain('behind');
  });

  it('Cancel leaves the plan untouched', () => {
    setPlanStartDate('2026-10-10');
    const root = renderToday();
    buttonByText(root, 'restart my plan from today').click();
    buttonByText(root, 'Cancel').click();
    expect(loadState().settings.planStartDate).toBe('2026-10-10');
    expect(root.textContent).toContain('restart my plan from today');
  });
});

describe('Today — Mark as studied: row tick, Studied ✓, hero moves on', () => {
  it('"Up now" is Stone Age with the hint; marking it ticks the row and the hero moves to the next unfinished topic', () => {
    setPlanStartDate('2026-10-13');
    const root = renderToday();
    expect(heroTitle(root)).toBe('Stone Age');
    expect(root.querySelector('.hero-now-hint')?.textContent).toBe('Read the notes, do the practice, then tap Mark as studied');
    expect(row(root, 'Stone Age')?.classList.contains('is-done')).toBe(false);

    buttonByText(root.querySelector('.hero-actions')!, 'Mark as studied').click();
    expect(topicStatus(STONE)).toBe('studied');
    const stone = row(root, 'Stone Age')!;
    expect(stone.classList.contains('is-done')).toBe(true);
    expect(stone.textContent).toContain('Studied \u2713');
    expect(heroTitle(root)).not.toBe('Stone Age');
    expect(heroTitle(root)).toBe('Indus Valley Civilization');
  });

  it('the row tick toggles studied ↔ not studied', () => {
    setPlanStartDate('2026-10-13');
    const root = renderToday();
    root.querySelector<HTMLButtonElement>('.today-check-tick[aria-label="Mark Stone Age as studied"]')!.click();
    expect(topicStatus(STONE)).toBe('studied');
    const tick = root.querySelector<HTMLButtonElement>('.today-check-tick.is-done')!;
    expect(tick.getAttribute('aria-pressed')).toBe('true');
    tick.click();
    expect(topicStatus(STONE)).not.toBe('studied');
  });

  it('the Learn "Mark as studied" bar toggles and offers "Mark as not studied"', () => {
    const bar = studyMarkBar(getSubtopic(STONE)!);
    document.body.appendChild(bar);
    buttonByText(bar, 'Mark as studied').click();
    expect(topicStatus(STONE)).toBe('studied');
    const fresh = document.querySelector('.learn-study-mark')!;
    expect(fresh.getAttribute('data-study-status')).toBe('studied');
    buttonByText(fresh, 'Mark as not studied').click();
    expect(topicStatus(STONE)).not.toBe('studied');
  });
});

describe('Revise — only studied topics; early-revise scoping', () => {
  it('a fresh learner\u2019s deck is EMPTY (no Magadha card); after marking Stone Age only its cards', () => {
    expect(collectCuratedCards()).toEqual([]);
    markTopicStudied(STONE, true, '2026-10-13');
    const deck = collectCuratedCards();
    expect(deck.length).toBeGreaterThan(0);
    expect(deck.every((c) => c.subtopicId === STONE)).toBe(true);
    expect(deck.some((c) => /Magadha/.test(c.front))).toBe(false);
  });

  it('nothing studied → "Flashcards for today\u2019s topic — after you mark it studied" with an explanation, not cards', () => {
    setPlanStartDate('2026-10-13');
    const root = renderToday();
    const r = row(root, 'after you mark it studied')!;
    expect(r).toBeTruthy();
    expect(r.textContent).toContain('Mark Stone Age studied');
    r.querySelector<HTMLButtonElement>('.today-check-btn')!.click();
    expect(location.hash).toBe(`#/learn/${STONE}`); // explanation → the topic, never cards
  });

  it('once today\u2019s topic is studied the block opens ITS cards (and Revise shows where they come from)', () => {
    setPlanStartDate('2026-10-13');
    markTopicStudied(STONE, true, '2026-10-13');
    const root = renderToday();
    const r = row(root, 'Flashcards for today\u2019s topic')!;
    expect(r.textContent).not.toContain('after you mark it studied');
    r.querySelector<HTMLButtonElement>('.today-check-btn')!.click();
    expect(location.hash).toBe('#/revise/flashcards');
    const view = document.createElement('div');
    renderFlashcards(view);
    expect(view.querySelector('.revise-from')?.textContent).toBe('Cards from: Stone Age');
  });

  it('previous days: cards of topics marked studied BEFORE today, most recent first', () => {
    setPlanStartDate('2026-10-10');
    markTopicStudied('ment-number-system', true, '2026-10-11');
    markTopicStudied(IVC, true, '2026-10-12');
    markTopicStudied(STONE, true, '2026-10-13'); // today — not "previous"
    const ctx = today.computeReviseCtx('2026-10-13');
    expect(ctx.mode).toBe('previous');
    expect(ctx.label).toBe('Review yesterday\u2019s flashcards');
    expect(ctx.ids).toEqual([IVC, 'ment-number-system']);
  });
});

describe('Telugu — each block is the NEXT lesson with an explicit target', () => {
  it('the lesson path is ordered and every check has 10 valid 4-option questions', () => {
    expect(N).toBeGreaterThanOrEqual(10);
    expect(TELUGU_LESSONS.map((l) => l.number)).toEqual(TELUGU_LESSONS.map((_, i) => i + 1));
    expect(TELUGU_LESSONS[2]!.title).toBe('Vowels ఋ–ఔ');
    for (const l of TELUGU_LESSONS.slice(1)) {
      const qs = buildLessonCheck(l);
      expect(qs).toHaveLength(10);
      for (const q of qs) {
        expect(new Set(q.options).size).toBe(q.options.length);
        expect(q.options.length).toBe(4);
        expect(q.answerIndex).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('Today\u2019s Telugu row shows "Telugu lesson 3 of N" + target, and advances after completion', () => {
    setPlanStartDate('2026-10-13');
    setTeluguLessonDone('tel-lesson-01', true, '2026-10-11');
    setTeluguLessonDone('tel-lesson-02', true, '2026-10-12');
    let root = renderToday();
    let r = root.querySelector<HTMLElement>('.today-check[data-kind="telugu"]')!;
    expect(r.textContent).toContain(`Telugu lesson 3 of ${N}`);
    expect(r.textContent).toContain('Lesson 3 · Vowels ఋ–ఔ · trace each letter 3 times, then the 10-question check (pass 8/10)');
    expect(r.textContent).toContain('15 m');

    // Completing lesson 3 today ticks the row (it does not jump ahead the same day)…
    setTeluguLessonDone('tel-lesson-03', true, '2026-10-13');
    root = renderToday();
    r = root.querySelector<HTMLElement>('.today-check[data-kind="telugu"]')!;
    expect(r.classList.contains('is-done')).toBe(true);
    expect(r.textContent).toContain('Done \u2713');
    // …and the next Telugu block is lesson 4.
    expect(lessonForDay(getTeluguLessonsDone(), '2026-10-15').lesson?.number).toBe(4);
  });

  it('the block opens that lesson; passing its 10-question check records completion', () => {
    setPlanStartDate('2026-10-13');
    setTeluguLessonDone('tel-lesson-01', true, '2026-10-12');
    setTeluguLessonDone('tel-lesson-02', true, '2026-10-12');
    const root = renderToday();
    root.querySelector<HTMLElement>('.today-check[data-kind="telugu"] .today-check-btn')!.click();
    expect(location.hash).toBe('#/telugu');

    const view = document.createElement('div');
    view.id = 'view';
    document.body.appendChild(view);
    telugu.render(view);
    expect(view.textContent).toContain(`Telugu lesson 3 of ${N}`);
    expect(view.textContent).toContain(`Target: ${lessonTarget(TELUGU_LESSONS[2]!)}`);
    expect(view.querySelectorAll('.tel-card').length).toBe(TELUGU_LESSONS[2]!.glyphIds.length);

    // Answer all 10 questions correctly.
    const qs = buildLessonCheck(TELUGU_LESSONS[2]!, 1);
    buttonByText(view, 'Start the check').click();
    for (const q of qs) {
      const opts = [...view.querySelectorAll<HTMLButtonElement>('.tel-check-options button')];
      opts[q.answerIndex]!.click();
      buttonByText(view, q === qs[qs.length - 1] ? 'See result' : 'Next').click();
    }
    expect(view.textContent).toContain('10/10 correct');
    expect(getTeluguLessonsDone()['tel-lesson-03']).toBe('2026-10-13');
    expect(view.textContent).toContain('Next: lesson 4');
  });
});
