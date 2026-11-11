import { afterEach, describe, expect, it } from 'vitest';
import { render, pickMatchPairs, chronicleData } from '../year-explorer';
import { yearSnapshot } from '../../lib/year-snapshot';

const setHash = (h: string): void => {
  window.location.hash = h;
};

afterEach(() => {
  document.body.replaceChildren();
  setHash('');
});

describe('year explorer view', () => {
  it('opens the requested year with posts, events and people shown inline', () => {
    setHash('#/timeline/year?y=1857');
    const root = document.createElement('div');
    document.body.append(root);
    render(root);
    expect(root.querySelector('.yx-year')?.textContent).toContain('1857');
    expect(root.textContent).toContain('Lord Canning');
    expect(root.textContent).toContain('Revolt of 1857');
    expect(root.querySelector('.yx-detail')).not.toBeNull();
    expect(root.querySelectorAll('.yx-profile').length).toBeGreaterThan(0);
    expect(root.querySelector('details')).toBeNull();
  });

  it('shows dated facts in the year they happened (Harappa 1921)', () => {
    setHash('#/timeline/year?y=1921');
    const root = document.createElement('div');
    render(root);
    expect(root.textContent).toContain('Daya Ram Sahni');
  });

  it('snaps a year with no entries to the nearest year that has some', () => {
    setHash('#/timeline/year?y=1');
    const root = document.createElement('div');
    render(root);
    const shown = root.querySelector('.yx-year')?.textContent ?? '';
    expect(shown).not.toBe('');
  });

  it('steps between years with entries only', () => {
    setHash('#/timeline/year?y=1857');
    const root = document.createElement('div');
    render(root);
    const next = [...root.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Next year with events')!;
    next.click();
    expect(root.querySelector('.yx-year')?.textContent).not.toContain('1857');
    const counts = root.querySelector('.yx-counts')?.textContent ?? '';
    expect(counts).toMatch(/\d+ events/);
  });

  it('searches people and opens a profile dialog', () => {
    setHash('#/timeline/year?y=1857');
    const root = document.createElement('div');
    document.body.append(root);
    render(root);
    const input = root.querySelector<HTMLInputElement>('.yx-search-input')!;
    input.value = 'dalhousie';
    input.dispatchEvent(new Event('input'));
    const row = root.querySelector<HTMLButtonElement>('.yx-search-row')!;
    expect(row.textContent).toContain('Dalhousie');
    row.click();
    expect(document.querySelector('.yx-card')?.textContent).toContain('Doctrine of Lapse');
  });

  it('builds match-the-following pairs with distinct sides', () => {
    const snap = yearSnapshot(1931, chronicleData());
    const pairs = pickMatchPairs(snap);
    expect(new Set(pairs.map((p) => p.left)).size).toBe(pairs.length);
    expect(new Set(pairs.map((p) => p.right)).size).toBe(pairs.length);
  });
});
