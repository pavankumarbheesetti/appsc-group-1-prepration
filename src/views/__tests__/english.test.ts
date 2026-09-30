import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '../english';
import { __resetForTests, loadState } from '../../state/store';
import { grammarMCQs, WRITING_FORMATS } from '../../content/english-qualifying';

describe('english module (#/english)', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
  });

  it('opens on the Overview tab with the four section tabs', () => {
    const root = document.createElement('div');
    render(root);
    const tabs = [...root.querySelectorAll('.learn-tab')].map((t) => t.textContent);
    expect(tabs).toEqual(['Overview', 'Grammar practice', 'Writing skills', 'Reading']);
    // Overview shows the marks table and the qualifying note.
    expect(root.textContent).toContain('The qualifying English paper');
    expect(root.textContent).toContain('QUALIFYING');
    expect(root.querySelector('.eng-overview-table')).not.toBeNull();
  });

  it('runs a grammar quiz through the shared runner and shows a score at the end', () => {
    const root = document.createElement('div');
    render(root);
    // Switch to the Grammar tab.
    [...root.querySelectorAll<HTMLElement>('.learn-tab')].find((t) => t.textContent?.includes('Grammar'))!.click();
    // Focus the smallest area so the run is short: filter by 'tenses'.
    const sel = root.querySelector<HTMLSelectElement>('.eng-grammar select')!;
    sel.value = 'tenses';
    sel.dispatchEvent(new Event('change'));
    root.querySelector<HTMLButtonElement>('.eng-quiz-setup .btn-primary')!.click();
    // A quiz question card appears with A–D option cards.
    expect(root.querySelector('.question-card')).not.toBeNull();
    // Answer every question by clicking the first option then advancing.
    let guard = 0;
    while (guard < 20) {
      guard += 1;
      const opt = root.querySelector<HTMLButtonElement>('.option-card');
      if (!opt) break;
      opt.click(); // reveals
      const next = root.querySelector<HTMLButtonElement>('.focus-advance .btn');
      if (!next) break;
      next.click();
      if (root.querySelector('.eng-results')) break;
    }
    // Results card with an X/Y score is shown.
    expect(root.querySelector('.eng-results')).not.toBeNull();
    expect(root.querySelector('.eng-results-num')?.textContent).toMatch(/\d+\/\d+/);
  });

  it('persists a writing draft and checklist ticks to state.english', () => {
    const root = document.createElement('div');
    render(root);
    [...root.querySelectorAll<HTMLElement>('.learn-tab')].find((t) => t.textContent?.includes('Writing'))!.click();
    // The first format card is the Letter.
    const firstKey = WRITING_FORMATS[0]!.key;
    const ta = root.querySelector<HTMLTextAreaElement>('.eng-fmt .mains-textarea')!;
    ta.value = 'one two three four five';
    ta.dispatchEvent(new Event('input'));
    expect(root.textContent).toContain('5 words');
    expect(loadState().english[firstKey]?.draft).toBe('one two three four five');

    // Tick the first checklist criterion.
    const box = root.querySelector<HTMLInputElement>('.eng-fmt .eng-check-row input[type="checkbox"]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(loadState().english[firstKey]?.checks[0]).toBe(true);
  });

  it('shows a reading passage with a control to answer its questions', () => {
    const root = document.createElement('div');
    render(root);
    [...root.querySelectorAll<HTMLElement>('.learn-tab')].find((t) => t.textContent?.includes('Reading'))!.click();
    expect(root.querySelector('.eng-passage-card')).not.toBeNull();
    // Starting the passage quiz mounts the shared runner.
    root.querySelector<HTMLButtonElement>('.eng-passage-actions .btn-primary')!.click();
    expect(root.querySelector('.question-card')).not.toBeNull();
  });

  it('grammar area filter never selects an out-of-range answer (data sanity)', () => {
    // A guard mirroring the content test, so the view suite fails loudly too.
    for (const q of grammarMCQs) expect(q.answerIndex).toBeLessThan(q.options.length);
  });
});
