import { describe, it, expect, beforeEach } from 'vitest';
import * as start from '../start';
import { __resetForTests, setPlanStartDate, setExamDate, getExamDate } from '../../state/store';
import { prettyDate } from '../today';

describe('Start-here guide (#/start)', () => {
  beforeEach(() => {
    __resetForTests();
    setExamDate('2027-01-24');
    setPlanStartDate('2026-10-10');
    location.hash = '';
  });

  it('renders all five beginner sections with accessible headings', () => {
    const root = document.createElement('div');
    start.render(root);
    const headings = [...root.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toContain('The exam in 1 minute');
    expect(headings).toContain('How your plan works');
    expect(headings).toContain('How to study one topic');
    expect(headings).toContain('How to handle negative marking');
    expect(headings).toContain('If you miss a day');
  });

  it('states the correct exam facts (two 120-mark papers, −⅓, 1:50 gateway)', () => {
    const root = document.createElement('div');
    start.render(root);
    const text = root.textContent ?? '';
    expect(text).toContain('120 questions');
    expect(text).toContain('Paper-I · General Studies');
    expect(text).toContain('Paper-II · General Aptitude');
    expect(text).toContain('Mental Ability'); // Paper-II Part A
    expect(text).toContain('Current Events'); // Paper-II Part B(ii)
    expect(text).toContain('−0.33'); // negative marking (1/3)
    expect(text).toContain('1:50'); // shortlist ratio
    expect(text).toContain('not'); // Prelims marks do not count in merit
  });

  it('derives the key dates from the live plan (apply-by + Prelims date)', () => {
    const root = document.createElement('div');
    start.render(root);
    const text = root.textContent ?? '';
    expect(text).toContain('27 Oct 2026'); // apply-by
    expect(text).toContain(prettyDate(getExamDate())); // 24 Jan 2027
    expect(text).toContain('announced later'); // Mains
  });

  it('derives the plan phases and explains the Full / Standard / Quick passes', () => {
    const root = document.createElement('div');
    start.render(root);
    const text = root.textContent ?? '';
    expect(text).toContain('First pass');
    expect(text).toContain('Revision cycle');
    expect(text).toContain('Final weeks');
    expect(text).toContain('Full');
    expect(text).toContain('Standard');
    expect(text).toContain('Quick pass');
  });
});
