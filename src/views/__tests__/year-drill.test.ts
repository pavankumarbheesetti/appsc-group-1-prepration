import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, taughtEvents, yearDrill, yearDrillCounts } from '../year-drill';
import { __resetForTests, loadState } from '../../state/store';
import { yearCardId } from '../../lib/year-drill';

beforeEach(() => {
  localStorage.clear();
  __resetForTests();
});
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

const pick = (root: HTMLElement, right: boolean): void => {
  const q = root.querySelector('.yd-q')!.textContent!;
  const ev = taughtEvents().find((e) => q.endsWith(e.title.replace(/\b\d{3,4}\b/g, '____')))!;
  const answer = String(ev.date.year);
  const btn = [...root.querySelectorAll<HTMLButtonElement>('.yd-option')].find((b) => (b.textContent === answer) === right)!;
  btn.click();
};

describe('year drill', () => {
  it('asks the year, marks it, shows the hook, and schedules the card', () => {
    const events = taughtEvents().filter((e) => e.id === 'tl-plassey' || e.id === 'tl-buxar');
    const root = yearDrill(events, 1);
    document.body.append(root);
    expect(root.querySelector('.yd-q')?.textContent).toMatch(/^In which year\?/);
    expect(root.querySelectorAll('.yd-option')).toHaveLength(4);
    pick(root, true);
    expect(root.querySelector('.yd-ok')).not.toBeNull();
    expect(root.querySelector('.yd-hook')?.textContent).toContain('Remember the year');
    expect(root.querySelectorAll('.yd-option[disabled]')).toHaveLength(4);
    const state = loadState();
    expect(Object.keys(state.flashcards).filter((k) => k.startsWith('yr:'))).toHaveLength(1);
  });

  it('brings a wrong year back at the end and reports it', () => {
    const events = taughtEvents().filter((e) => e.id === 'tl-plassey' || e.id === 'tl-buxar');
    const root = yearDrill(events, 2);
    document.body.append(root);
    pick(root, false);
    expect(root.querySelector('.yd-no')?.textContent).toContain('come back');
    root.querySelector<HTMLButtonElement>('.yd .btn-primary')!.click();
    pick(root, true);
    root.querySelector<HTMLButtonElement>('.yd .btn-primary')!.click();
    expect(root.querySelector('.hl-kicker')?.textContent).toBe('Try again');
    pick(root, true);
    root.querySelector<HTMLButtonElement>('.yd .btn-primary')!.click();
    expect(root.querySelector('.yd-score')?.textContent).toBe('1 / 2 right first time');
    expect(root.textContent).toContain('Years to work on');
    root.querySelector<HTMLButtonElement>('.btn-secondary')!.click();
    expect(root.querySelector('.yd-q')).not.toBeNull();
  });

  it('praises a perfect round and handles an empty list', () => {
    const events = taughtEvents().filter((e) => e.id === 'tl-plassey');
    const root = yearDrill(events, 3);
    pick(root, true);
    root.querySelector<HTMLButtonElement>('.yd .btn-primary')!.click();
    expect(root.textContent).toContain('Every year right');
    expect(yearDrill([]).textContent).toContain('Nothing to drill');
  });

  it('counts due and new years and renders the page', () => {
    const before = yearDrillCounts();
    expect(before.due).toBe(0);
    expect(before.fresh).toBe(taughtEvents().length);
    const root = document.createElement('div');
    render(root);
    expect(root.querySelector('h1')?.textContent).toBe('Year drill');
    root.querySelector<HTMLButtonElement>('.yd-actions .btn-primary')!.click();
    expect(root.querySelector('.yd-q')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.yd-actions .btn-secondary')!.click();
    expect(root.querySelector('.hl-kicker')?.textContent).toContain(`of ${taughtEvents().length}`);
    expect(yearCardId('x')).toBe('yr:x');
  });
});
