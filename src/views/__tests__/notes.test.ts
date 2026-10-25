import { describe, it, expect, beforeEach } from 'vitest';
import { buildNoteArticle, buildMainsNotesSection } from '../notes';
import { __resetForTests, loadState } from '../../state/store';
import type { NoteItem } from '../../content/types';

/**
 * Notes rendering semantics after the active-recall overhaul:
 *  - the "Must remember" block is PRIMARY and carries a "Test yourself" control
 *    that hides the points, prompts recall, then reveals with a self-rating that
 *    seeds the note's spaced-repetition cards;
 *  - the authored mnemonic is DEMOTED to one short, muted INLINE line
 *    ("Memory hook — <text>") in the closing panel — never a bare label.
 */
function makeNote(): NoteItem {
  return {
    id: 'n1',
    subjectCode: 'HIST',
    title: 'Discovery & Excavators',
    body: 'Some **markdown** body.',
    keyPoints: [
      'Charles Masson first came across Harappa.',
      'John Marshall announced the discovery in 1924.',
    ],
    mnemonic: 'M-C-M order to remember the excavators.',
  };
}

describe('notes — Test yourself (active recall)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('renders the Must-remember key points with a Test yourself control', () => {
    const article = buildNoteArticle(makeNote(), 'note-1');
    expect(article.querySelector('.note-keypoints')).not.toBeNull();
    const testBtn = [...article.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Test yourself'),
    );
    expect(testBtn).toBeDefined();
    expect(testBtn!.getAttribute('aria-expanded')).toBe('false');
    // Points visible by default.
    expect(article.querySelectorAll('.keypoint-list li').length).toBe(2);
  });

  it('hides the points and shows a recall prompt, then reveals them', () => {
    const article = buildNoteArticle(makeNote(), 'note-1');
    const testBtn = [...article.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Test yourself'),
    )!;
    testBtn.click();
    // Points hidden, prompt shown.
    expect(article.querySelectorAll('.keypoint-list li').length).toBe(0);
    expect(article.querySelector('.note-recall-prompt')?.textContent).toContain(
      'Recall the key points',
    );
    expect(testBtn.getAttribute('aria-expanded')).toBe('true');

    // Reveal brings the points back plus a self-rating.
    const reveal = [...article.querySelectorAll('button')].find((b) => b.textContent?.includes('Reveal'))!;
    reveal.click();
    expect(article.querySelectorAll('.keypoint-list li').length).toBe(2);
    expect(article.querySelector('.note-recall-rate')).not.toBeNull();
  });

  it('self-rating "Got it" seeds this note\u2019s SR cards and returns to idle', () => {
    const article = buildNoteArticle(makeNote(), 'note-1');
    (
      [...article.querySelectorAll('button')].find((b) => b.textContent?.includes('Test yourself'))!
    ).click();
    ([...article.querySelectorAll('button')].find((b) => b.textContent?.includes('Reveal'))!).click();
    ([...article.querySelectorAll('button')].find((b) => b.textContent?.includes('Got it'))!).click();

    const sr = loadState().flashcards;
    // Key-point + cloze cards for the note are now scheduled.
    expect(Object.keys(sr).length).toBeGreaterThan(0);
    expect(Object.keys(sr).some((id) => id.startsWith('fc:n1#'))).toBe(true);
    expect(Object.keys(sr).some((id) => id.startsWith('cz:n1#'))).toBe(true);
    // Back to idle: points visible, no rating controls.
    expect(article.querySelectorAll('.keypoint-list li').length).toBe(2);
    expect(article.querySelector('.note-recall-rate')).toBeNull();
  });
});

describe('notes — Memory hook (demoted mnemonic)', () => {
  beforeEach(() => __resetForTests());

  it('renders the mnemonic INLINE as one labelled line (value visible, not a headline)', () => {
    const article = buildNoteArticle(makeNote(), 'note-1');
    const hook = article.querySelector('.note-end .note-mnemonic') as HTMLElement | null;
    expect(hook).not.toBeNull();
    // Inline paragraph — no collapsed disclosure hiding the value.
    expect(hook!.tagName).toBe('P');
    expect(article.querySelector('details.note-mnemonic')).toBeNull();
    expect(hook!.querySelector('.note-mnemonic-label')?.textContent).toBe('Memory hook');
    // The authored text is preserved (never deleted) and shown on the same line.
    expect(hook!.querySelector('.note-mnemonic-text')?.textContent).toContain('M-C-M order');
    expect(hook!.textContent).toBe('Memory hook \u2014 M-C-M order to remember the excavators.');
    // Exactly once per note.
    expect(article.querySelectorAll('.note-mnemonic').length).toBe(1);
    expect(article.textContent?.split('M-C-M order').length).toBe(2);
  });

  it('keeps the Must remember / Test yourself block inside the closing panel', () => {
    const article = buildNoteArticle(makeNote(), 'note-1');
    const end = article.querySelector('footer.note-end')!;
    expect(end.querySelector('.note-keypoints-title')?.textContent).toBe('Must remember');
    expect([...end.querySelectorAll('button')].some((b) => b.textContent?.includes('Test yourself'))).toBe(true);
    expect(article.querySelectorAll('.note-keypoints').length).toBe(1);
  });

  it('never renders the label for a blank mnemonic', () => {
    const article = buildNoteArticle({ ...makeNote(), mnemonic: '   ' }, 'note-1');
    expect(article.querySelector('.note-mnemonic')).toBeNull();
    expect(article.textContent).not.toContain('Memory hook');
  });

  it('omits the memory hook when the note has none', () => {
    const note = makeNote();
    delete note.mnemonic;
    const article = buildNoteArticle(note, 'note-1');
    expect(article.querySelector('.note-mnemonic')).toBeNull();
    expect(article.textContent).not.toContain('Memory hook');
  });
});

describe('notes — "For Mains" collapsed section (STANDARDS §8a)', () => {
  beforeEach(() => __resetForTests());

  function mainsNote(id: string, title: string): NoteItem {
    return { id, subjectCode: 'HIST', title, body: 'Analytical Mains dimensions.', tags: ['mains'] };
  }

  it('renders mains-tagged notes inside a collapsed <details> with an explainer', () => {
    const section = buildMainsNotesSection(
      [mainsNote('a-note-mains-angle', 'For Mains — Mauryan state')],
      'learn-note-mains',
    )!;
    expect(section).not.toBeNull();
    expect(section.tagName.toLowerCase()).toBe('details');
    expect((section as HTMLDetailsElement).open).toBe(false); // collapsed by default
    const summary = section.querySelector('summary');
    expect(summary?.textContent).toContain('For Mains (read in the December revision)');
    expect(section.querySelector('.notes-for-mains-lead')?.textContent).toContain('December revision');
    // The note article is present inside the collapsed section.
    expect(section.querySelector('.note-title')?.textContent).toContain('For Mains — Mauryan state');
  });

  it('returns null when there are no mains notes (robust whether or not one exists)', () => {
    expect(buildMainsNotesSection([], 'learn-note-mains')).toBeNull();
  });
});
