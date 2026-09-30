import { describe, it, expect, beforeEach } from 'vitest';
import * as syllabus from '../syllabus';
import { __resetForTests } from '../../state/store';

/**
 * Syllabus tracker semantics: rows default to CHRONOLOGICAL (taxonomy `order`)
 * — Stone Age → IVC → Early Vedic … — and the progress bar shows LEARNER
 * PROGRESS (0% on a fresh profile), never authoring coverage.
 */
function rowNames(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.track-row-name')].map((n) => n.textContent ?? '');
}

describe('syllabus tracker', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
  });

  it('defaults to chronological order and shows Progress (0% fresh), not coverage', () => {
    const root = document.createElement('div');
    syllabus.render(root);

    // Expand the subject, then its chapter, to reveal the subtopic rows.
    (root.querySelector('.track-subject-summary') as HTMLElement).click();
    (root.querySelector('.track-chapter-summary') as HTMLElement).click();

    const names = rowNames(root);
    expect(names.slice(0, 3)).toEqual([
      'Stone Age',
      'Indus Valley Civilization',
      'Early Vedic Period',
    ]);
    // Ancient India is the first chapter of the first subject: its 23 subtopics
    // render first, ending in "Travelers in Ancient India".
    expect(names[22]).toBe('Travelers in Ancient India');

    // The row meter is learner progress, labelled and 0% on a fresh profile —
    // NOT the old authoring-coverage percentage.
    const firstRow = root.querySelector('.track-row')!;
    expect(firstRow.textContent).toContain('Progress');
    expect(firstRow.textContent).toContain('0%');
    expect(firstRow.textContent).not.toContain('covered');
  });

  it('exposes a Chronological / Priority sort toggle (Chronological default)', () => {
    const root = document.createElement('div');
    syllabus.render(root);
    const chips = [...root.querySelectorAll('.filter-bar .chip')].map((c) => c.textContent);
    expect(chips).toEqual(['Chronological', 'Priority']);
    // The default (Chronological) chip is the accented/active one.
    const active = root.querySelector('.filter-bar .chip-accent');
    expect(active?.textContent).toBe('Chronological');
  });

  it('summaries are truthful (material coverage + mastered), never "% covered"', () => {
    const root = document.createElement('div');
    syllabus.render(root);
    const stat = root.querySelector('.track-summary-stat')?.textContent ?? '';
    // HIST leads with how many of its 47 subtopics actually have material yet
    // (now 47 of 47), then mastery — never a misleading "% covered".
    expect(stat).toContain('have material');
    expect(stat).toContain('mastered');
    expect(stat).toContain('% progress');
    expect(stat).not.toContain('covered');
    expect(stat).toMatch(/47\/47 have material/);
  });
});
