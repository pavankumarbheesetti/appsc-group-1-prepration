/**
 * NAV spec (NAV-REVIEW §3–4) — view-level checks against the real app shell:
 * Learn breadcrumb + origin-aware back, tabs as URLs, old-route redirects,
 * unknown routes, one h1 + focus + document.title per page, the "Next up"
 * footers (Learn notes, practice results, Revise end, mock results), the notes
 * table of contents, and theme / text size controlled in ONE place.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderApp } from '../../app';
import { navigate } from '../../router/router';
import { openLearn } from '../learn';
import { renderFlashcards } from '../revise';
import { renderResultsRoute } from '../mock';
import { nextUpFooter } from '../shell';
import { getSubtopic } from '../../content/loader';
import { isMainsNote } from '../../engine/flashcards';
import { markTopicStudied, isTopicStudied } from '../../lib/study-status';
import { markRowKeyDone, START_HERE_KEY } from '../../lib/day-tasks';
import { __resetForTests, recordTestAttempt, setPlanStartDate } from '../../state/store';

const STONE = 'hist-ancient-stone-age';

function setClock(iso: string): void {
  vi.setSystemTime(new Date(`${iso}T10:00:00`));
}

/** Mount the full app into the document (focus checks need a live DOM). */
function app(): HTMLElement {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  document.body.appendChild(root);
  renderApp(root);
  return root;
}

function view(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('#view')!;
}

function buttonByText(root: ParentNode, text: string): HTMLElement {
  const b = [...root.querySelectorAll<HTMLElement>('button, a')].find((x) => x.textContent?.trim().startsWith(text));
  if (!b) throw new Error(`control not found: ${text}`);
  return b;
}

/** Simulate a browser Back/Forward to `hash` (an entry we created at `pos`). */
function historyGo(hash: string, pos: number): void {
  history.replaceState({ navPos: pos }, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

beforeEach(() => {
  localStorage.clear();
  __resetForTests();
  location.hash = '';
  vi.useFakeTimers({ toFake: ['Date'] });
  setClock('2026-10-14');
  setPlanStartDate('2026-10-14');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Learn — breadcrumb, h1, origin-aware back', () => {
  it('Today → Start reading opens the topic Notes with ‹ Today, the Topics tab active, one h1 focused, a page title', () => {
    // Finish the orientation row so the hero's "Up now" is a topic.
    markRowKeyDone('2026-10-14', START_HERE_KEY);
    const root = app();
    const start = [...view(root).querySelectorAll<HTMLElement>('.hero-actions button')].find((b) => b.textContent?.trim().startsWith('Start'))!;
    expect(start).toBeDefined();
    start.click();
    expect(location.hash).toMatch(/^#\/learn\/[^/]+\/notes\?from=today$/);
    const id = decodeURIComponent(location.hash.split('/')[2]!);
    const sub = getSubtopic(id)!;

    // Topics stays highlighted on the sidebar AND the mobile tab bar.
    const topicsSide = [...root.querySelectorAll<HTMLElement>('.sidebar .nav-item')].find((n) => n.textContent === 'Topics')!;
    const topicsTab = [...root.querySelectorAll<HTMLElement>('.tabbar .tab-item')].find((n) => n.textContent === 'Topics')!;
    expect(topicsSide.getAttribute('aria-current')).toBe('page');
    expect(topicsTab.getAttribute('aria-current')).toBe('page');

    // Exactly one h1 (the topic), focused; the top bar carries the name + ‹ Today.
    const h1s = document.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toBe(sub.meta.name);
    expect(document.activeElement).toBe(h1s[0]);
    expect(root.querySelector('.topbar-title')?.textContent).toBe(sub.meta.name);
    const back = root.querySelector<HTMLElement>('.topbar-back')!;
    expect(back.hidden).toBe(false);
    expect(back.textContent).toContain('Today');
    expect(view(root).querySelector('.learn-back')?.textContent).toContain('Today');
    expect(document.title).toBe(`${sub.meta.name} \u00b7 Topics \u00b7 APPSC Focus`);

    back.click();
    expect(location.hash).toBe('#/');
  });

  it('shows the breadcrumb Topics › Subject › Chapter › Topic with Subject/Chapter linking to the filtered Topics list', () => {
    const root = app();
    navigate('/topics');
    openLearn(STONE);
    const crumbs = [...view(root).querySelectorAll('nav[aria-label="Breadcrumb"] li')].map((li) => li.textContent);
    expect(crumbs[0]).toBe('Topics');
    expect(crumbs.at(-1)).toBe('Stone Age');
    expect(crumbs).toHaveLength(4);
    const links = [...view(root).querySelectorAll<HTMLAnchorElement>('nav[aria-label="Breadcrumb"] a')];
    expect(links[1]!.getAttribute('href')).toBe('#/topics?s=HIST');
    expect(links[2]!.getAttribute('href')).toMatch(/^#\/topics\?s=HIST&c=/);
    expect(view(root).querySelector('[aria-current="page"]')?.textContent).toBe('Stone Age');
    // The phone collapse: the parent link + the trail subtitle.
    expect(view(root).querySelector('.crumb-up')?.textContent).toBe(`\u2039 ${crumbs[2]}`);
    expect(view(root).querySelector('.learn-trail')?.textContent).toContain('\u203a');
  });

  it.each([
    ['/plan', 'Plan', '#/plan'],
    ['/', 'Today', '#/'],
    ['/progress', 'Progress', '#/progress'],
  ])('from %s the back link reads ‹ %s and returns there', (origin, label, hash) => {
    const root = app();
    navigate(origin);
    openLearn(STONE);
    const back = view(root).querySelector<HTMLElement>('.learn-back')!;
    expect(back.textContent).toContain(label);
    expect(back.textContent).not.toContain('Syllabus');
    back.click();
    expect(location.hash).toBe(hash);
  });

  it('from Topics the back link returns to the topic’s chapter in the list', () => {
    const root = app();
    navigate('/topics');
    openLearn(STONE);
    const back = view(root).querySelector<HTMLElement>('.learn-back')!;
    expect(back.textContent).toContain('Topics');
    back.click();
    expect(location.hash).toMatch(/^#\/topics\?s=HIST&c=/);
    // The chapter is expanded in the list.
    expect(view(root).querySelector('.track-chapter.open')).not.toBeNull();
  });

  it('origin survives moving between tabs and a reload of the deep link', () => {
    const root = app();
    navigate('/plan');
    openLearn(STONE);
    view(root).querySelector<HTMLElement>('#learn-tab-practice')!.click();
    expect(location.hash).toBe(`#/learn/${STONE}/practice?from=plan`);
    // "Reload": a fresh app on the same hash.
    const again = app();
    expect(view(again).querySelector('#learn-tab-practice')?.getAttribute('aria-selected')).toBe('true');
    expect(view(again).querySelector('.learn-back')?.textContent).toContain('Plan');
  });
});

describe('Old routes, unknown routes, titles', () => {
  it.each([
    ['#/planner', '#/plan'],
    ['#/syllabus', '#/topics'],
    ['#/drill', '#/practice'],
    ['#/mock', '#/practice/mock'],
    ['#/notebook', '#/revise/mistakes'],
    ['#/today', '#/'],
    [`#/learn/${STONE}`, `#/learn/${STONE}/notes`],
  ])('%s redirects to %s', (from, to) => {
    location.hash = from;
    app();
    expect(location.hash).toBe(to);
  });

  it('the legacy Learn tab name "drill" opens Practice', () => {
    location.hash = `#/learn/${STONE}/drill`;
    const root = app();
    expect(view(root).querySelector('#learn-tab-practice')?.getAttribute('aria-selected')).toBe('true');
  });

  it('an unknown route lands on Today with the hash corrected', () => {
    location.hash = '#/nope/really';
    const root = app();
    expect(location.hash).toBe('#/');
    expect(view(root).textContent).toContain('Up now');
  });

  it('every destination has a unique document.title, one h1, and focus on it', () => {
    const root = app();
    const titles = new Set<string>();
    for (const path of ['/', '/plan', '/topics', '/practice', '/practice/mock', '/revise', '/revise/mistakes', '/progress', '/mains', '/languages', '/settings', `/learn/${STONE}/notes`, `/learn/${STONE}/practice`]) {
      navigate(path);
      expect(document.querySelectorAll('h1')).toHaveLength(1);
      expect(document.activeElement?.tagName).toBe('H1');
      expect(document.title).toMatch(/ \u00b7 APPSC Focus$/);
      titles.add(document.title);
    }
    expect(titles.size).toBe(13);
    expect(view(root)).toBeTruthy();
  });

  it('Today has no duplicate "Today" heading in the hero', () => {
    const root = app();
    expect(view(root).querySelector('.hero-title')).toBeNull();
    const headings = [...document.querySelectorAll('h1, h2')].filter((h) => h.textContent === 'Today');
    expect(headings).toHaveLength(1);
  });

  it('a skip link is the first focusable element and moves focus into the page', () => {
    const root = app();
    const first = root.querySelector('a, button');
    expect(first?.classList.contains('skip-link')).toBe(true);
    expect(first?.textContent).toBe('Skip to content');
    (first as HTMLElement).click();
    // Focus lands inside the main landmark (its h1, or main itself).
    expect(view(root).contains(document.activeElement)).toBe(true);
  });
});

describe('Notes — table of contents, single heading, collapsed checklist, Next up', () => {
  it('lists one TOC row per note (title only) in the side list and the Contents chip', () => {
    const root = app();
    openLearn(STONE, { from: 'topics' });
    const sub = getSubtopic(STONE)!;
    const prelims = sub.notes.filter((n) => !isMainsNote(n));
    const side = [...view(root).querySelectorAll('.learn-toc .toc-link')].map((a) => a.textContent);
    expect(side).toEqual(prelims.map((n) => n.title));
    expect(view(root).querySelector('.contents-chip')?.textContent).toContain(`Contents \u00b7 1/${prelims.length}`);
    // The chip opens a sheet with the same entries.
    const chip = view(root).querySelector<HTMLElement>('.contents-chip')!;
    const sheet = view(root).querySelector<HTMLElement>('.contents-sheet')!;
    expect(sheet.hidden).toBe(true);
    chip.click();
    expect(sheet.hidden).toBe(false);
    expect(sheet.querySelectorAll('.toc-link')).toHaveLength(prelims.length);
    // The tab bar + chip live in ONE sticky container.
    expect(chip.closest('.learn-tabbar')).not.toBeNull();
  });

  it('never repeats a note heading (the body’s own leading heading is dropped)', () => {
    const root = app();
    openLearn(STONE);
    for (const art of view(root).querySelectorAll('.reading > article.note')) {
      const first = art.querySelector('.note-body')?.firstElementChild;
      expect(first?.tagName).not.toBe('H3');
    }
  });

  it('collapses the exam-point checklist and ends each note with "Next: … ↓"', () => {
    const root = app();
    openLearn(STONE);
    const cov = view(root).querySelector<HTMLDetailsElement>('details.learn-coverage')!;
    expect(cov).not.toBeNull();
    expect(cov.open).toBe(false);
    expect(cov.querySelector('summary')?.textContent).toMatch(/Coverage \d+%/);
    const nexts = [...view(root).querySelectorAll('.note-next')].map((n) => n.textContent);
    expect(nexts[0]).toMatch(/^Next: .+ \u2193$/);
  });

  it('ends with a Next-up footer: Finished reading? → Practice N questions + Mark studied & skip practice', () => {
    const root = app();
    openLearn(STONE, { from: 'today' });
    const footer = view(root).querySelector<HTMLElement>('.learn-panel .next-up')!;
    expect(footer.querySelector('.next-up-eyebrow')?.textContent).toBe('Finished reading?');
    const n = getSubtopic(STONE)!.mcqs.length;
    expect(footer.querySelector('.next-up-primary')?.textContent).toBe(`Practice ${n} questions`);
    expect([...footer.querySelectorAll('.next-up-link')].map((b) => b.textContent)).toEqual(['Mark studied & skip practice']);
    (footer.querySelector('.next-up-primary') as HTMLElement).click();
    expect(location.hash).toBe(`#/learn/${STONE}/practice?from=today`);
  });
});

describe('Practice results — own URL, Next up, browser Back', () => {
  it('Start practice → End session → results URL; "Mark studied & go to next topic" lands on the next topic’s Notes', () => {
    const root = app();
    openLearn(STONE, { tab: 'practice', from: 'today' });
    const posBefore = (history.state as { navPos: number }).navPos;
    buttonByText(view(root), 'Start practice').click();
    expect(view(root).querySelector('.focus-stage')).not.toBeNull();
    buttonByText(view(root), 'End session').click();
    expect(location.hash).toBe(`#/learn/${STONE}/practice/results?from=today`);
    expect(view(root).textContent).toContain('Practice complete');
    const footer = view(root).querySelector<HTMLElement>('.next-up')!;
    // N12: the score line is stated once (the card), the footer just says next up.
    expect(footer.querySelector('.next-up-eyebrow')?.textContent).toBe('Next up');
    expect((view(root).textContent ?? '').match(/Stone Age \u2014 /g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(footer.querySelector('.next-up-primary')?.textContent).toBe('Mark studied & go to next topic');
    expect([...footer.querySelectorAll('.next-up-link')].map((b) => b.textContent)).toContain('Back to notes');

    // Browser Back from results → Learn › Practice (not Today).
    historyGo(`#/learn/${STONE}/practice?from=today`, posBefore);
    expect(view(root).querySelector('#learn-tab-practice')?.getAttribute('aria-selected')).toBe('true');
    expect(view(root).textContent).toContain('Start practice');

    // Forward again shows the results, then go to the next topic.
    historyGo(`#/learn/${STONE}/practice/results?from=today`, posBefore + 1);
    view(root).querySelector<HTMLElement>('.next-up-primary')!.click();
    expect(isTopicStudied(STONE)).toBe(true);
    expect(location.hash).toMatch(/^#\/learn\/[^/]+\/notes\?from=today$/);
    expect(location.hash).not.toContain(STONE);
  });

  it('once studied, the results footer offers "Next: <topic> (time)" from today’s plan', () => {
    markTopicStudied(STONE, true);
    const root = app();
    openLearn(STONE, { tab: 'practice', from: 'today' });
    buttonByText(view(root), 'Start practice').click();
    buttonByText(view(root), 'End session').click();
    expect(view(root).querySelector('.next-up-primary')?.textContent).toMatch(/^(Next: .+|Today\u2019s plan done \u2713.*)$/);
  });
});

describe('Revise end + mock results footers', () => {
  it('a finished flashcard session ends with "N cards reviewed · M due tomorrow" + Revise more', () => {
    markTopicStudied(STONE, true);
    document.body.innerHTML = '';
    const root = document.createElement('main');
    document.body.appendChild(root);
    renderFlashcards(root);
    for (let i = 0; i < 60 && !root.querySelector('.next-up'); i += 1) {
      const show = [...root.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.startsWith('Show answer'));
      if (show) show.click();
      const good = [...root.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.startsWith('Good'));
      if (good) good.click();
      if (!show && !good) break;
    }
    const footer = root.querySelector('.next-up');
    expect(footer).not.toBeNull();
    expect(footer!.querySelector('.next-up-eyebrow')?.textContent).toMatch(/^\d+ cards? reviewed \u00b7 \d+ due tomorrow$/);
    expect([...footer!.querySelectorAll('.next-up-link')].map((b) => b.textContent)).toEqual(['Revise more']);
  });

  it('mock results (reload of the results URL) show Score · negative with Review answers', () => {
    recordTestAttempt({
      at: 1234,
      dateISO: '2026-10-14',
      kind: 'mock',
      total: 10,
      attempted: 9,
      correct: 6,
      wrong: 3,
      skipped: 1,
      net: 5,
      guessAttempted: 0,
      guessCorrect: 0,
      marksLostToWrong: 1,
      reviewIds: ['x'],
    } as Parameters<typeof recordTestAttempt>[0]);
    location.hash = '#/practice/mock/results/1234';
    const root = document.createElement('div');
    renderResultsRoute(root);
    const footer = root.querySelector('.next-up')!;
    expect(footer.querySelector('.next-up-eyebrow')?.textContent).toBe('Score 5/10 \u00b7 \u22121.0 negative');
    const links = [...footer.querySelectorAll('.next-up-link')].map((b) => b.textContent);
    expect(links).toContain('Review answers');
  });

  it('the footer component renders ONE primary and at most two ghost links', () => {
    const noop = (): void => undefined;
    const f = nextUpFooter({
      eyebrow: 'e',
      primary: { label: 'Go', onClick: noop },
      secondary: [{ label: 'a', onClick: noop }, { label: 'b', onClick: noop }, { label: 'c', onClick: noop }],
    });
    expect(f.querySelectorAll('.btn-primary')).toHaveLength(1);
    expect(f.querySelectorAll('.next-up-link')).toHaveLength(2);
  });
});

describe('Theme + text size live in ONE place (Settings) plus one Aa popover', () => {
  /** Controls that are not inside a hidden ancestor. */
  function visible(root: HTMLElement, sel: string): Element[] {
    return [...root.querySelectorAll(sel)].filter((n) => !n.closest('[hidden]'));
  }

  it('no always-on theme / text-size controls in the shell; one Aa button', () => {
    const root = app();
    expect(visible(root, '.sidebar [aria-label="Text size"], .topbar [aria-label="Text size"]')).toHaveLength(0);
    expect(root.querySelectorAll('.aa-btn')).toHaveLength(1);
    expect(visible(root, '[aria-label="Text size"]')).toHaveLength(0); // Today
    navigate('/settings');
    expect(visible(root, '[aria-label="Text size"]')).toHaveLength(1);
    expect(visible(root, '[aria-label="Theme"]')).toHaveLength(1);
    expect(view(root).textContent).toContain('Appearance');
  });

  it('the Aa popover changes theme and text size (persisted, applied)', () => {
    const root = app();
    const aa = root.querySelector<HTMLElement>('.aa-btn')!;
    aa.click();
    expect(aa.getAttribute('aria-expanded')).toBe('true');
    const pop = root.querySelector<HTMLElement>('.aa-pop')!;
    expect(pop.hidden).toBe(false);
    (pop.querySelector('[aria-label="Use dark theme"]') as HTMLElement).click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    (pop.querySelector('[aria-label="Increase text size"]') as HTMLElement).click();
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.1');
    expect(pop.textContent).toContain('110%');
    pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(pop.hidden).toBe(true);
    expect(document.activeElement).toBe(aa);
  });
});
