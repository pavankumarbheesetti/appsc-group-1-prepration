import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderApp } from '../../app';
import { __resetForTests } from '../../state/store';

/**
 * App shell / nav coherence tests (NAV spec §3.1–3.2): six primary
 * destinations + Tracks + Settings gear, the 5-item mobile tab bar whose More
 * sheet never repeats a tab, old routes as redirects, and the header search.
 */
function navLabels(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.sidebar .nav .nav-item .nav-label')].map(
    (n) => n.textContent ?? '',
  );
}

/** The uppercase section eyebrows rendered in the sidebar, in order. */
function navSections(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.sidebar .nav .nav-group .nav-eyebrow')].map(
    (n) => n.textContent ?? '',
  );
}

describe('app shell nav', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
  });

  it('groups the primary nav into labelled sections', () => {
    const root = document.createElement('div');
    renderApp(root);
    // (no eyebrow) Today · Plan — Study — Tracks.
    expect(navSections(root)).toEqual(['Study', 'Tracks']);
  });

  it('lists the six primary destinations + the Tracks group, in order (spec names)', () => {
    const root = document.createElement('div');
    renderApp(root);
    expect(navLabels(root)).toEqual(['Today', 'Plan', 'Topics', 'Practice', 'Revise', 'Progress', 'Mains', 'Languages']);
    // Settings is the footer gear, not a group item.
    const footer = [...root.querySelectorAll('.sidebar-footer .nav-label')].map((n) => n.textContent);
    expect(footer).toEqual(['Settings']);
  });

  it('lands on the Today view by default (route "/")', () => {
    const root = document.createElement('div');
    renderApp(root);
    // Today is the default route; its countdown ("days to Prelims") is present.
    expect(location.hash === '' || location.hash === '#/').toBe(true);
    expect(root.querySelector('#view')?.textContent).toContain('days to Prelims');
  });

  it('routes Plan to #/plan with the this-week default (exam date lives in Settings)', () => {
    const root = document.createElement('div');
    renderApp(root);
    const planner = [...root.querySelectorAll<HTMLElement>('.sidebar .nav-item')].find(
      (b) => b.textContent?.trim() === 'Plan',
    );
    expect(planner).toBeDefined();
    planner!.click();
    expect(location.hash).toBe('#/plan');
    const view = root.querySelector('#view')!;
    // The default view leads with THIS WEEK (not the dense 15-week grid) and no
    // longer embeds an editable exam-date input (that duplicated Settings).
    expect(view.querySelector('.planner-week')).not.toBeNull();
    expect(view.querySelector('input[type="date"]')).toBeNull();
    expect(view.textContent).toContain('Change in Settings');
  });

  it('routes Progress to #/progress and renders the analytics view', () => {
    const root = document.createElement('div');
    renderApp(root);
    const progress = [...root.querySelectorAll<HTMLElement>('.sidebar .nav-item')].find(
      (b) => b.textContent?.includes('Progress'),
    );
    expect(progress).toBeDefined();
    progress!.click();
    expect(location.hash).toBe('#/progress');
    // Fresh profile → the friendly empty state, not the old notebook.
    expect(root.querySelector('#view')?.textContent).toContain('No progress');
  });

  it('Practice → "Timed mock" segment routes to #/practice/mock and shows the timed-mock setup banner', () => {
    const root = document.createElement('div');
    renderApp(root);
    const practice = [...root.querySelectorAll<HTMLElement>('.sidebar .nav-item')].find(
      (b) => b.textContent?.includes('Practice'),
    );
    practice!.click();
    expect(location.hash).toBe('#/practice');
    const segs = [...root.querySelectorAll<HTMLElement>('#view .practice-seg')];
    expect(segs.map((x) => x.querySelector('.practice-seg-label')?.textContent)).toEqual(['Quick practice', 'Timed mock']);
    expect(segs[0]!.getAttribute('aria-current')).toBe('page');
    segs[1]!.click();
    expect(location.hash).toBe('#/practice/mock');
    // Practice stays the highlighted destination for the mock.
    expect(practice!.getAttribute('aria-current')).toBe('page');
    const view = root.querySelector('#view');
    // The no-compensatory-time / negative-marking banner is present on setup.
    expect(view?.textContent).toContain('negative marking');
    expect(view?.textContent).toContain('no compensatory time');
    // And a Start control is offered (a full Paper-I mock is the default).
    expect(view?.textContent).toMatch(/Start Paper-I/);
  });

  it('keeps the old #/notebook route working (→ #/revise/mistakes) and highlights Revise for it', () => {
    const root = document.createElement('div');
    renderApp(root);
    location.hash = '#/notebook';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(location.hash).toBe('#/revise/mistakes');
    // "My mistakes" (was Notebook) renders...
    expect(root.querySelector('#view')?.textContent).toContain('My mistakes');
    // ...and the Revise nav item is the active one (Notebook lives under Revise).
    const revise = [...root.querySelectorAll<HTMLElement>('.sidebar .nav-item')].find(
      (b) => b.textContent?.includes('Revise'),
    );
    expect(revise?.getAttribute('aria-current')).toBe('page');
  });

  it('keeps the header search button', () => {
    const root = document.createElement('div');
    renderApp(root);
    const search = root.querySelector('.topbar .icon-btn[aria-label^="Search"]');
    expect(search).not.toBeNull();
  });

  it('no longer lists Timeline or Weak areas in the sidebar nav', () => {
    const root = document.createElement('div');
    renderApp(root);
    const labels = navLabels(root);
    expect(labels).not.toContain('Timeline');
    expect(labels).not.toContain('Weak areas');
  });

  it('routes Settings (bottom gear) to #/settings and shows data controls', () => {
    const root = document.createElement('div');
    renderApp(root);
    const settings = [...root.querySelectorAll<HTMLElement>('.sidebar .nav-item')].find(
      (b) => b.textContent?.includes('Settings'),
    );
    expect(settings).toBeDefined();
    settings!.click();
    expect(location.hash).toBe('#/settings');
    const view = root.querySelector('#view');
    // Exam date (synced with Planner), export/import, and reset are all present.
    expect(view?.querySelector('input[type="date"]')).not.toBeNull();
    expect(view?.textContent).toContain('Export progress');
    expect(view?.textContent).toContain('Import progress');
    expect(view?.textContent).toContain('Reset all progress');
    expect(settings!.getAttribute('aria-current')).toBe('page');
  });

  it('mobile tab bar shows five compact tabs including a "More" drawer opener', () => {
    const root = document.createElement('div');
    renderApp(root);
    const tabLabels = [...root.querySelectorAll('.tabbar .tab-item .nav-label')].map(
      (n) => n.textContent ?? '',
    );
    expect(tabLabels).toEqual(['Today', 'Topics', 'Practice', 'Revise', 'More']);
    // The drawer starts hidden; tapping "More" opens it.
    const more = [...root.querySelectorAll<HTMLElement>('.tabbar .tab-item')].find(
      (b) => b.textContent?.includes('More'),
    )!;
    const drawer = root.querySelector<HTMLElement>('.more-drawer')!;
    expect(drawer.hasAttribute('hidden')).toBe(true);
    more.click();
    expect(drawer.hasAttribute('hidden')).toBe(false);
    // The drawer lists ONLY the non-tab destinations (+ a search field).
    const moreLabels = [...drawer.querySelectorAll('.nav-item .nav-label')].map((n) => n.textContent);
    expect(moreLabels).toEqual(['Plan', 'Progress', 'Mains', 'Languages', 'Settings']);
    expect(drawer.querySelector('.search-field')).not.toBeNull();
    // Navigating from the drawer closes it again.
    const plannerLink = [...drawer.querySelectorAll<HTMLElement>('.nav-item')].find(
      (b) => b.textContent?.includes('Plan'),
    )!;
    plannerLink.click();
    expect(location.hash).toBe('#/plan');
    expect(drawer.hasAttribute('hidden')).toBe(true);
    // "More" is highlighted because Plan is not one of the tabs.
    expect(more.getAttribute('aria-current')).toBe('page');
  });

  it('routes Languages to #/languages and opens the Telugu course from the hub', () => {
    const root = document.createElement('div');
    renderApp(root);
    const languages = [...root.querySelectorAll<HTMLElement>('.sidebar .nav-item')].find(
      (b) => b.textContent?.includes('Languages'),
    );
    expect(languages).toBeDefined();
    languages!.click();
    expect(location.hash).toBe('#/languages');
    const view = root.querySelector('#view');
    expect(view?.textContent).toContain('Telugu');
    expect(view?.textContent).toContain('English'); // English now lives here too
    // Opening the Telugu course from the hub keeps Languages highlighted.
    const teluguCard = view?.querySelector<HTMLElement>('button.tel-lang-card');
    expect(teluguCard).toBeDefined();
    teluguCard!.click();
    expect(location.hash).toBe('#/telugu');
    expect(languages!.getAttribute('aria-current')).toBe('page');
    expect(root.querySelector('#view')?.textContent).toContain('abugida');
  });

  it('routes Mains to #/mains and shows the writing hub tabs', () => {
    const root = document.createElement('div');
    renderApp(root);
    const mains = [...root.querySelectorAll<HTMLElement>('.sidebar .nav-item')].find(
      (b) => b.textContent?.includes('Mains'),
    );
    expect(mains).toBeDefined();
    mains!.click();
    expect(location.hash).toBe('#/mains');
    const view = root.querySelector('#view');
    // The hub offers the two top-level tabs.
    expect(view?.textContent).toContain('How to write');
    expect(view?.textContent).toContain('Question library');
    // Mains is the active nav item.
    expect(mains!.getAttribute('aria-current')).toBe('page');
  });

  it('opens the English module from the Languages hub and keeps Languages highlighted', () => {
    const root = document.createElement('div');
    renderApp(root);
    const languages = [...root.querySelectorAll<HTMLElement>('.sidebar .nav-item')].find(
      (b) => b.textContent?.includes('Languages'),
    );
    languages!.click();
    // The English card is the second actionable language card in the hub.
    const cards = [...root.querySelectorAll<HTMLElement>('#view button.tel-lang-card')];
    const englishCard = cards.find((c) => c.textContent?.includes('English'))!;
    expect(englishCard).toBeDefined();
    englishCard.click();
    expect(location.hash).toBe('#/english');
    const view = root.querySelector('#view');
    // The English hub shows its section tabs and the qualifying note.
    expect(view?.textContent).toContain('Grammar practice');
    expect(view?.textContent).toContain('Writing skills');
    expect(view?.textContent).toContain('QUALIFYING');
    // Languages stays the active nav item for the English module.
    expect(languages!.getAttribute('aria-current')).toBe('page');
  });
});

describe('app shell — sidebar is an internal scroll container (trapped-footer fix)', () => {
  it('declares overflow-y:auto + dynamic viewport height on .sidebar', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
    // Isolate the first `.sidebar { … }` rule block.
    const start = css.indexOf('.sidebar {');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('}', start));
    // The root fix: the rail scrolls internally (so Settings/Theme/Text-size are
    // always reachable) and sizes to the dynamic viewport.
    expect(block).toMatch(/overflow-y:\s*auto/);
    expect(block).toMatch(/overscroll-behavior:\s*contain/);
    expect(block).toMatch(/height:\s*100dvh/);
    expect(block).not.toMatch(/height:\s*100vh/);
  });
});
