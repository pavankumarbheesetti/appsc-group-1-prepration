import { describe, it, expect, beforeEach } from 'vitest';
import * as drill from '../drill';
import { __resetForTests } from '../../state/store';

/**
 * Drill "Refine" — the Subtopic selector (Subject → Subtopic → Tier).
 *
 * Behaviour pinned here:
 *   - With "All subjects", the Subtopic select is disabled and offers only
 *     "All subtopics".
 *   - Choosing a subject enables + populates it with that subject's
 *     MCQ-bearing subtopics, each labelled "Name (N)".
 *   - Choosing a specific subtopic scopes ALL preset counts to it (Full
 *     practice count == that subtopic's total MCQ count).
 *   - Changing subject resets the subtopic back to "All".
 */
function q<T extends Element>(root: HTMLElement, sel: string): T {
  const node = root.querySelector<T>(sel);
  if (!node) throw new Error(`missing ${sel}`);
  return node;
}

function subtopicSelect(root: HTMLElement): HTMLSelectElement {
  return q<HTMLSelectElement>(root, 'select[aria-label="Subtopic filter"]');
}
function subjectSelect(root: HTMLElement): HTMLSelectElement {
  return q<HTMLSelectElement>(root, 'select[aria-label="Subject filter"]');
}

/** The count label of a preset card by its title, e.g. "Full practice". */
function presetCount(root: HTMLElement, title: string): string {
  for (const card of root.querySelectorAll('.preset-card')) {
    if (card.querySelector('.preset-title')?.textContent === title) {
      return card.querySelector('.preset-count')?.textContent ?? '';
    }
  }
  throw new Error(`no preset card titled ${title}`);
}

function fireChange(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

describe('drill refine — subtopic selector', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
  });

  it('disables the subtopic select and offers only "All subtopics" for All subjects', () => {
    const root = document.createElement('div');
    drill.render(root);
    const sub = subtopicSelect(root);
    expect(sub.disabled).toBe(true);
    expect([...sub.options].map((o) => o.textContent)).toEqual(['All subtopics']);
  });

  it('populates + enables the subtopic select when a subject is chosen, with "Name (N)" labels', () => {
    const root = document.createElement('div');
    drill.render(root);
    fireChange(subjectSelect(root), 'HIST');

    const sub = subtopicSelect(root);
    expect(sub.disabled).toBe(false);
    // First option is always the "All subtopics" default.
    expect(sub.options[0]?.textContent).toBe('All subtopics');
    // IVC is offered and labelled with its real MCQ count (17, lean exemplar).
    const ivc = [...sub.options].find((o) => o.value === 'hist-ancient-ivc');
    expect(ivc).toBeTruthy();
    expect(ivc?.textContent).toMatch(/\(19\)$/);
    // Every populated option carries a "(N)" count suffix.
    for (const opt of [...sub.options].slice(1)) {
      expect(opt.textContent).toMatch(/\(\d+\)$/);
    }
  });

  it('scopes all preset counts to the chosen subtopic', () => {
    const root = document.createElement('div');
    drill.render(root);
    fireChange(subjectSelect(root), 'HIST');
    fireChange(subtopicSelect(root), 'hist-ancient-ivc');

    // Full practice == the subtopic's total (IVC has 19 MCQs).
    expect(presetCount(root, 'Full practice')).toBe('19 total');
    // Quick == min(10, total).
    expect(presetCount(root, 'Quick 10')).toBe('10 questions');
  });

  it('resets the subtopic to "All" when the subject changes', () => {
    const root = document.createElement('div');
    drill.render(root);
    fireChange(subjectSelect(root), 'HIST');
    fireChange(subtopicSelect(root), 'hist-ancient-ivc');
    expect(presetCount(root, 'Full practice')).toBe('19 total');

    // Re-selecting a subject resets subtopic → All (full HIST pool = 917).
    fireChange(subjectSelect(root), 'HIST');
    expect(subtopicSelect(root).value).toBe('');
    expect(presetCount(root, 'Full practice')).toBe('946 total');
  });
});
