import { describe, it, expect, beforeEach } from 'vitest';
import { render, renderWorkspace } from '../mains';
import { __resetForTests, loadState } from '../../state/store';
import { getBanks } from '../../content/loader';
import type { MainsBank } from '../../content/types';

/** The first real Mains question id from the loaded content banks. */
function firstMainsId(): string {
  for (const loaded of getBanks('mains')) {
    if (loaded.bank.kind !== 'mains') continue;
    const bank = loaded.bank as MainsBank;
    const first = bank.items[0];
    if (first) return first.id;
  }
  throw new Error('no mains items found in content');
}

describe('mains hub (#/mains)', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
  });

  it('renders the two hub tabs and the guide by default', () => {
    const root = document.createElement('div');
    render(root);
    const tabs = [...root.querySelectorAll('.learn-tab')].map((t) => t.textContent);
    expect(tabs).toEqual(['How to write', 'Question library']);
    // The guide's paper-overview accordion is open by default.
    expect(root.textContent).toContain('Exam structure — the five papers');
    expect(root.textContent).toContain('Directive words');
  });

  it('switches to the Question library and lists questions with a filter bar', () => {
    const root = document.createElement('div');
    render(root);
    const libTab = [...root.querySelectorAll<HTMLElement>('.learn-tab')].find((t) =>
      t.textContent?.includes('Question library'),
    )!;
    libTab.click();
    expect(root.querySelector('.filter-bar')).not.toBeNull();
    expect(root.querySelectorAll('.mains-row').length).toBeGreaterThan(0);
    // Both filter selects (subtopic + paper) are present.
    expect(root.querySelectorAll('.filter-bar select').length).toBe(2);
  });
});

describe('mains writing workspace (#/mains/:id)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('renders the framework, model and practice pad for a real question', () => {
    const id = firstMainsId();
    location.hash = `#/mains/${id}`;
    const root = document.createElement('div');
    renderWorkspace(root);
    expect(root.querySelector('.mains-ws')).not.toBeNull();
    expect(root.textContent).toContain('Framework');
    expect(root.querySelector('.mains-textarea')).not.toBeNull();
    // Word count starts at zero for an unwritten answer.
    expect(root.textContent).toContain('0 words');
  });

  it('persists the draft as the learner types (live word count)', () => {
    const id = firstMainsId();
    location.hash = `#/mains/${id}`;
    const root = document.createElement('div');
    renderWorkspace(root);
    const ta = root.querySelector<HTMLTextAreaElement>('.mains-textarea')!;
    ta.value = 'one two three four';
    ta.dispatchEvent(new Event('input'));
    expect(root.textContent).toContain('4 words');
    expect(loadState().mains[id]?.draft).toBe('one two three four');
  });

  it('scores the self-eval rubric and persists per-criterion scores', () => {
    const id = firstMainsId();
    location.hash = `#/mains/${id}`;
    const root = document.createElement('div');
    renderWorkspace(root);
    // Each criterion offers 0/1/2 buttons; click the "2" of the first criterion.
    const firstGroup = root.querySelector('.mains-score-group')!;
    const two = [...firstGroup.querySelectorAll<HTMLButtonElement>('.mains-score')].find(
      (b) => b.textContent === '2',
    )!;
    two.click();
    expect(two.classList.contains('is-active')).toBe(true);
    // The total meter updates and the score is saved.
    expect(root.querySelector('.mains-rubric-score')?.textContent).toContain('/10');
    expect(loadState().mains[id]?.rubric[0]).toBe(2);
  });

  it('shows a friendly not-found card for an unknown id', () => {
    location.hash = '#/mains/does-not-exist';
    const root = document.createElement('div');
    renderWorkspace(root);
    expect(root.textContent).toContain('Question not found');
  });
});
