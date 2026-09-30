import { describe, it, expect } from 'vitest';
import { resolveImage, availableImageKeys } from '../assets';
import { getBanks } from '../loader';
import type { Figure } from '../types';

// Guards the image pipeline: (1) the newly added hand-authored SVG figures
// (under src/assets/figures/**) are discovered by the stem-keyed resolver, and
// (2) EVERY figure key referenced by any note bank actually resolves — so a
// typo in a `figure.src` breaks the test rather than silently rendering nothing.

/** A few representative keys from the new src/assets/figures/** subtree. */
const NEW_FIGURE_KEYS = [
  'geo-india-monsoon',
  'geo-india-drainage',
  'geo-ap-rivers-projects',
  'geo-ap-regions-districts',
  'pol-parliament-structure',
  'pol-fundamental-rights',
  'econ-budget-structure',
  'hist-1857-centres',
  'hist-temple-styles',
  'sci-five-kingdoms',
];

describe('image resolver — new figure subtree', () => {
  it('discovers the new figures under src/assets/figures/**', () => {
    const keys = new Set(availableImageKeys());
    for (const k of NEW_FIGURE_KEYS) {
      expect(keys.has(k), `missing resolver key: ${k}`).toBe(true);
    }
  });

  it('resolves each new figure key to a non-empty asset URL', () => {
    for (const k of NEW_FIGURE_KEYS) {
      const url = resolveImage(k);
      expect(url, `unresolved key: ${k}`).toBeTruthy();
      expect(typeof url).toBe('string');
    }
  });

  it('returns undefined for an unknown key (graceful degradation)', () => {
    expect(resolveImage('definitely-not-a-real-figure-key')).toBeUndefined();
  });
});

describe('content ↔ image integrity', () => {
  // Collect every figure referenced by every notes bank (lead `figure` + the
  // `figures` array), paired with the note id for a readable failure message.
  const refs: { note: string; fig: Figure }[] = [];
  for (const { bank } of getBanks('notes')) {
    if (bank.kind !== 'notes') continue;
    for (const note of bank.items) {
      if (note.figure) refs.push({ note: note.id, fig: note.figure });
      for (const f of note.figures ?? []) refs.push({ note: note.id, fig: f });
    }
  }

  it('references at least the seeded figure set', () => {
    // Sanity floor: IVC (~14) + the new cross-subject figures (40) are wired.
    expect(refs.length).toBeGreaterThanOrEqual(50);
  });

  it('every note figure src resolves to an inlined asset', () => {
    const broken = refs
      .filter(({ fig }) => resolveImage(fig.src) === undefined)
      .map(({ note, fig }) => ({ note, src: fig.src }));
    expect(broken).toEqual([]);
  });

  it('every note figure carries non-empty alt text (accessibility)', () => {
    const noAlt = refs
      .filter(({ fig }) => !fig.alt || fig.alt.trim().length === 0)
      .map(({ note, fig }) => ({ note, src: fig.src }));
    expect(noAlt).toEqual([]);
  });
});
