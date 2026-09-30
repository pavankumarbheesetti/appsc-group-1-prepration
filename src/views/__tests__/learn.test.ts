import { describe, it, expect, beforeEach } from 'vitest';
import * as learn from '../learn';
import { getSubtopic, getSubtopics } from '../../content/loader';
import { __resetForTests } from '../../state/store';

/**
 * Learn workspace graceful-empty semantics: a content-less subtopic (planned
 * but not yet authored) must show a friendly whole-page empty state — never a
 * row of broken, empty tabs — while an authored subtopic still shows its tabs.
 */
function tabLabels(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.learn-tab')].map((t) => t.querySelector('span')?.textContent ?? '');
}

// Pick the first content-less subtopic dynamically so this stays valid as more
// subtopics get authored (skip-guard when none remain).
const contentless = getSubtopics().find((s) => {
  const v = getSubtopic(s.id);
  return v !== undefined && v.notes.length === 0 && v.mcqs.length === 0 && v.mains.length === 0;
});

describe('learn workspace — content-less handling', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
  });

  it.skipIf(!contentless)('renders a friendly empty state (no tabs) for a subtopic with no material', () => {
    location.hash = `#/learn/${contentless!.id}`;
    const root = document.createElement('div');
    learn.render(root);

    // Header still names the subtopic; body is the empty state, not tabs.
    expect(root.querySelector('.learn-title')?.textContent).toBe(contentless!.name);
    expect(root.querySelectorAll('.learn-tab').length).toBe(0);
    const empty = root.querySelector('.empty-state');
    expect(empty).toBeTruthy();
    expect(empty?.textContent).toContain('coming soon');
    // A way back is offered.
    expect(root.textContent).toContain('Back to Syllabus');
  });

  it('shows the Notes / Practice / Mains tabs for an authored subtopic (Indus Valley)', () => {
    location.hash = '#/learn/hist-ancient-ivc';
    const root = document.createElement('div');
    learn.render(root);

    expect(tabLabels(root)).toEqual(['Notes', 'Practice', 'Mains']);
    // No whole-page empty state when material exists.
    expect(root.querySelector('.learn-panel .empty-state')).toBeFalsy();
  });

  it('falls back to a not-found card for an unknown subtopic id', () => {
    location.hash = '#/learn/not-a-real-id';
    const root = document.createElement('div');
    learn.render(root);
    expect(root.textContent).toContain('Subtopic not found');
  });
});

/**
 * The Learn tab bar is an accessible WAI-ARIA tablist: tabs expose
 * id + aria-controls + aria-selected + a roving tabindex, the panel is a
 * labelled tabpanel, and Left/Right/Home/End arrow keys move AND activate tabs.
 */
describe('learn workspace — tab ARIA + roving arrow keys', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
  });

  it('exposes proper tablist/tab/tabpanel semantics with a roving tabindex', () => {
    location.hash = '#/learn/hist-ancient-ivc';
    const root = document.createElement('div');
    learn.render(root);

    const tablist = root.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();
    const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.length).toBe(3);

    // Active (first) tab: selected + tabindex 0 + controls the panel.
    const active = tabs[0]!;
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(active.getAttribute('tabindex')).toBe('0');
    expect(active.getAttribute('aria-controls')).toBe('learn-tabpanel');
    // Inactive tabs are removed from the Tab order (roving).
    expect(tabs.slice(1).every((t) => t.getAttribute('tabindex') === '-1')).toBe(true);

    // The panel is labelled by the active tab.
    const panel = root.querySelector<HTMLElement>('#learn-tabpanel[role="tabpanel"]');
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute('aria-labelledby')).toBe(active.id);
    expect(panel!.getAttribute('tabindex')).toBe('0');
  });

  it('activates the next tab on ArrowRight (automatic activation)', () => {
    location.hash = '#/learn/hist-ancient-ivc';
    const root = document.createElement('div');
    document.body.appendChild(root); // so post-switch focus-by-id resolves
    learn.render(root);

    const first = root.querySelector<HTMLElement>('[role="tab"]')!;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
    // The SECOND tab is now selected and in the Tab order; the first is not.
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]!.getAttribute('tabindex')).toBe('0');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('false');
    // The panel is now labelled by the newly-active tab.
    expect(root.querySelector('#learn-tabpanel')!.getAttribute('aria-labelledby')).toBe(tabs[1]!.id);

    root.remove();
  });
});
