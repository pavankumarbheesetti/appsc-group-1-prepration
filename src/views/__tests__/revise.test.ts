import { describe, it, expect, beforeEach } from 'vitest';
import { mountFlashcards } from '../revise';
import { buildCuratedDeck } from '../../engine/flashcards';
import type { CardItem } from '../../content/types';
import { __resetForTests } from '../../state/store';

/** Curated-card factory. */
function curated(id: string, front: string, back: string): CardItem {
  return { id, subjectCode: 'HIST', subtopicId: 'sub', front, back, verified: true };
}

/** Click the first button whose visible text contains `label`. */
function click(root: HTMLElement, label: string): void {
  const btn = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(label),
  );
  if (!btn) throw new Error(`button not found: ${label}`);
  btn.click();
}

/** The currently-shown flashcard question text. */
function cue(root: HTMLElement): string {
  return root.querySelector('.flashcard-cue')?.textContent ?? '';
}

describe('revise flashcard runner — curated deck + Again re-queue', () => {
  beforeEach(() => {
    __resetForTests();
    location.hash = '';
  });

  it('runs a curated deck as question → answer with a Show answer reveal', () => {
    const deck = buildCuratedDeck([curated('c1', 'First?', 'One'), curated('c2', 'Second?', 'Two')]);
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountFlashcards(root, deck);

    // The session header shows the honest "N cards for today", not a raw due count.
    expect(root.querySelector('.focus-count')?.textContent).toContain('cards for today');
    expect(cue(root)).toBe('First?');
    click(root, 'Show answer');
    expect(root.querySelector('.flashcard-answer-text')?.textContent).toBe('One');
    root.remove();
  });

  it('re-queues an "Again" card so it returns before the session ends', () => {
    const deck = buildCuratedDeck([curated('c1', 'First?', 'One'), curated('c2', 'Second?', 'Two')]);
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountFlashcards(root, deck);

    // Card 1 → Again (wrong): should be re-queued to the end of the live session.
    click(root, 'Show answer');
    click(root, 'Again');
    // Now card 2 is shown; grade it Good.
    expect(cue(root)).toBe('Second?');
    click(root, 'Show answer');
    click(root, 'Good');
    // The re-queued card 1 must reappear (not the completion screen).
    expect(cue(root)).toBe('First?');
    root.remove();
  });

  it('shows the ready-topics empty state when there are no curated cards', () => {
    const root = document.createElement('div');
    mountFlashcards(root, []);
    expect(root.textContent).toContain('Flashcards appear here once a topic has been reviewed');
  });
});
