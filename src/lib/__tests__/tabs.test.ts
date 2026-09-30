import { describe, it, expect } from 'vitest';
import { nextTabIndex } from '../tabs';

/**
 * Roving-tabindex / arrow-key logic for the WAI-ARIA tabs pattern:
 * Left/Up = previous (wraps), Right/Down = next (wraps), Home = first,
 * End = last; non-navigation keys return null.
 */
describe('nextTabIndex', () => {
  it('moves to the next tab and wraps at the end', () => {
    expect(nextTabIndex('ArrowRight', 0, 4)).toBe(1);
    expect(nextTabIndex('ArrowDown', 1, 4)).toBe(2);
    expect(nextTabIndex('ArrowRight', 3, 4)).toBe(0); // wrap
  });

  it('moves to the previous tab and wraps at the start', () => {
    expect(nextTabIndex('ArrowLeft', 2, 4)).toBe(1);
    expect(nextTabIndex('ArrowUp', 1, 4)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 4)).toBe(3); // wrap
  });

  it('jumps to first (Home) and last (End)', () => {
    expect(nextTabIndex('Home', 2, 4)).toBe(0);
    expect(nextTabIndex('End', 0, 4)).toBe(3);
  });

  it('returns null for non-navigation keys', () => {
    expect(nextTabIndex('Enter', 0, 4)).toBeNull();
    expect(nextTabIndex('a', 0, 4)).toBeNull();
    expect(nextTabIndex(' ', 0, 4)).toBeNull();
  });

  it('returns null when there are no tabs', () => {
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
  });
});
