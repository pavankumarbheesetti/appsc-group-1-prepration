import { describe, it, expect, beforeEach } from 'vitest';
import { render, renderLanguagesHub } from '../telugu';
import { __resetForTests, loadState } from '../../state/store';
import { VOWELS, CONSONANTS } from '../../content/telugu';

describe('languages hub (#/languages)', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
  });

  it('links Telugu and English, both available under the Languages hub', () => {
    const root = document.createElement('div');
    renderLanguagesHub(root);
    expect(root.textContent).toContain('Telugu');
    expect(root.textContent).toContain('English');
    expect(root.textContent).toContain('Available now');
    // Both language cards are now actionable buttons.
    expect(root.querySelectorAll('button.tel-lang-card').length).toBe(2);
  });
});

describe('telugu course (#/telugu)', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
  });

  it('opens on the Intro stage with the full stage nav', () => {
    const root = document.createElement('div');
    render(root);
    const stages = [...root.querySelectorAll('.tel-stage-btn .tel-stage-label')].map((n) => n.textContent);
    expect(stages).toEqual([
      'Intro',
      'Vowels',
      'Consonants',
      'Gunintalu',
      'Vattulu',
      'Numbers',
      'Words',
      'Sentences',
    ]);
    // Intro prose is shown, no glyph cards yet.
    expect(root.textContent).toContain('abugida');
    expect(root.querySelectorAll('.tel-card').length).toBe(0);
  });

  it('renders a glyph card per vowel with translit, Hear it and a canvas', () => {
    const root = document.createElement('div');
    render(root);
    const vowelsBtn = [...root.querySelectorAll<HTMLElement>('.tel-stage-btn')].find((b) =>
      b.textContent?.includes('Vowels'),
    )!;
    vowelsBtn.click();
    expect(root.querySelectorAll('.tel-card').length).toBe(VOWELS.length);
    // First vowel's transliteration and a tracing canvas are present.
    expect(root.querySelector('.tel-translit')?.textContent).toBe('a');
    expect(root.querySelector('canvas.tel-canvas')).not.toBeNull();
    // "Hear it" and "Mark learned" controls exist on the card.
    expect(root.textContent).toContain('Hear it');
    expect(root.textContent).toContain('Mark learned');
  });

  it('does not throw when Hear it is clicked without speech synthesis (jsdom)', () => {
    const root = document.createElement('div');
    render(root);
    [...root.querySelectorAll<HTMLElement>('.tel-stage-btn')]
      .find((b) => b.textContent?.includes('Consonants'))!
      .click();
    const hear = [...root.querySelectorAll<HTMLButtonElement>('.tel-card .btn')].find((b) =>
      b.textContent?.includes('Hear it'),
    )!;
    expect(() => hear.click()).not.toThrow();
  });

  it('persists per-glyph progress via Mark learned and reflects it in the counter', () => {
    const root = document.createElement('div');
    render(root);
    [...root.querySelectorAll<HTMLElement>('.tel-stage-btn')]
      .find((b) => b.textContent?.includes('Consonants'))!
      .click();
    const firstCard = root.querySelector<HTMLElement>('.tel-card')!;
    const mark = [...firstCard.querySelectorAll<HTMLButtonElement>('.btn')].find((b) =>
      b.textContent?.includes('Mark learned'),
    )!;
    mark.click();
    // Store now records the first consonant as learned.
    expect(loadState().telugu[CONSONANTS[0]!.id]).toBe(true);
    // The card reflects the learned state and the button relabels.
    expect(firstCard.classList.contains('is-learned')).toBe(true);
    expect(mark.textContent).toContain('Learned');
    // The Consonants stage-nav count advances to 1/36.
    const conBtn = [...root.querySelectorAll<HTMLElement>('.tel-stage-btn')].find((b) =>
      b.textContent?.includes('Consonants'),
    )!;
    expect(conBtn.querySelector('.tel-stage-count')?.textContent).toBe(`1/${CONSONANTS.length}`);
  });
});
