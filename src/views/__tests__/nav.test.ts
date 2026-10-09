import { describe, it, expect, beforeEach } from 'vitest';
import { renderApp } from '../../app';
import { __resetForTests } from '../../state/store';

/**
 * App shell / nav coherence tests: the Progress tab must open the real
 * analytics view (#/progress), the wrong-answer Notebook lives UNDER Revise
 * (keeping the #/notebook route working), the new Mock tab opens the timed
 * mock setup (#/mock), and the header search button stays.
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
    expect(navSections(root)).toEqual(['Plan', 'Learn', 'Practice', 'Revise', 'Skills', 'Track']);
  });

  it('lists the grouped nav destinations in order (Timeline & Weak areas removed)', () => {
    const root = document.createElement('div');
    renderApp(root);
    expect(navLabels(root)).toEqual([
      'Today',
      'Planner',
      'Syllabus',
      'Drill',
      'Mock',
      'Revise',
      'Mains',
      'Languages',
      'Progress',
    ]);
  });

  it('lands on the Today view by default (route "/")', () => {
    const root = document.createElement('div');
    renderApp(root);
    // Today is the default route; its countdown ("days to Prelims") is present.
    expect(location.hash === '' || location.hash === '#/').toBe(true);
    expect(root.querySelector('#view')?.textContent).toContain('days to Prelims');
  });

  it('routes Planner to #/planner and shows the editable exam date', () => {
    const root = document.createElement('div');
    renderApp(root);
    const planner = [...root.querySelectorAll<HTMLElement>('.sidebar .nav-item')].find(
      (b) => b.textContent?.includes('Planner'),
    );
    expect(planner).toBeDefined();
    planner!.click();
    expect(location.hash).toBe('#/planner');
    const dateInput = root.querySelector<HTMLInputElement>('#view input[type="date"]');
    expect(dateInput).not.toBeNull();
    expect(dateInput!.value).toBe('2027-01-24');
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

  it('routes Mock to #/mock and shows the timed-mock setup banner', () => {
    const root = document.createElement('div');
    renderApp(root);
    const mock = [...root.querySelectorAll<HTMLElement>('.sidebar .nav-item')].find(
      (b) => b.textContent?.includes('Mock'),
    );
    expect(mock).toBeDefined();
    mock!.click();
    expect(location.hash).toBe('#/mock');
    const view = root.querySelector('#view');
    // The no-compensatory-time / negative-marking banner is present on setup.
    expect(view?.textContent).toContain('negative marking');
    expect(view?.textContent).toContain('no compensatory time');
    // And a Start control is offered (a full Paper-I mock is the default).
    expect(view?.textContent).toMatch(/Start Paper-I/);
  });

  it('keeps the #/notebook route working and highlights Revise for it', () => {
    const root = document.createElement('div');
    renderApp(root);
    location.hash = '#/notebook';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    // Notebook still renders its own content...
    expect(root.querySelector('#view')?.textContent).toContain('notebook');
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
    expect(tabLabels).toEqual(['Today', 'Syllabus', 'Drill', 'Revise', 'More']);
    // The drawer starts hidden; tapping "More" opens it.
    const more = [...root.querySelectorAll<HTMLElement>('.tabbar .tab-item')].find(
      (b) => b.textContent?.includes('More'),
    )!;
    const drawer = root.querySelector<HTMLElement>('.more-drawer')!;
    expect(drawer.hasAttribute('hidden')).toBe(true);
    more.click();
    expect(drawer.hasAttribute('hidden')).toBe(false);
    // The drawer lists the non-primary destinations, e.g. Planner and Settings.
    expect(drawer.textContent).toContain('Planner');
    expect(drawer.textContent).toContain('Settings');
    // Navigating from the drawer closes it again.
    const plannerLink = [...drawer.querySelectorAll<HTMLElement>('.nav-item')].find(
      (b) => b.textContent?.includes('Planner'),
    )!;
    plannerLink.click();
    expect(location.hash).toBe('#/planner');
    expect(drawer.hasAttribute('hidden')).toBe(true);
    // "More" is highlighted because Planner is not one of the primary tabs.
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
