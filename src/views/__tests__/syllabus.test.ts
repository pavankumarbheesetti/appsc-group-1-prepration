import { describe, it, expect, beforeEach } from 'vitest';
import * as syllabus from '../syllabus';
import { __resetForTests } from '../../state/store';
import { markTopicStudied } from '../../lib/study-status';

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
    expect(firstRow.textContent).toContain('Accuracy');
    expect(firstRow.textContent).toContain('0%');
    expect(firstRow.textContent).not.toContain('covered');
    // ONE status chip per row — the study status, not a mastery label.
    expect(firstRow.querySelectorAll('.study-status-chip')).toHaveLength(1);
    expect(firstRow.textContent).toContain('Not started');
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

  it('summaries lead with the studied count (same source as the plan), accuracy separate', () => {
    const root = document.createElement('div');
    syllabus.render(root);
    const stat = root.querySelector('.track-summary-stat')?.textContent ?? '';
    // HIST: 47 in-scope subtopics, none studied on a fresh profile.
    expect(stat).toContain('Studied 0 of 47');
    expect(stat).not.toContain('covered');
    expect(stat).not.toContain('mastered');
    // The page headline counts the whole Prelims scope.
    expect(root.querySelector('.syll-studied-headline')!.textContent).toContain('Studied 0 of 117');
  });

  it('marking topics studied updates the headline + subject count + row chip', () => {
    markTopicStudied('hist-ancient-stone-age', true, '2026-10-10');
    markTopicStudied('ment-number-system', true, '2026-10-10');
    const root = document.createElement('div');
    syllabus.render(root);
    expect(root.querySelector('.syll-studied-headline')!.textContent).toContain('Studied 2 of 117');
    expect(root.querySelector('.track-summary-stat')!.textContent).toContain('Studied 1 of 47');
    (root.querySelector('.track-subject-summary') as HTMLElement).click();
    (root.querySelector('.track-chapter-summary') as HTMLElement).click();
    const first = root.querySelector('.track-row')!;
    expect(first.querySelector('.study-status-chip')!.textContent).toContain('Studied');
  });
});
