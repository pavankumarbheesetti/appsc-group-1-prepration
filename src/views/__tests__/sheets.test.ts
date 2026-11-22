import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderIndex, renderSheet } from '../sheets';
import { render as renderRevise } from '../revise';
import { renderChapter } from '../history-learn';
import { getChapters, getSheets, getSheetsForChapter } from '../../content/loader';
import { chrono, everything, inOrder, lanesOf, previousInLane, sameTime, yearsLabel } from '../../lib/sheets';
import { getSheetsRevised } from '../../state/store';

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.body.replaceChildren();
  window.location.hash = '';
});

const open = (hash: string, fn: (r: HTMLElement) => void): HTMLElement => {
  window.location.hash = hash;
  const root = document.createElement('div');
  document.body.append(root);
  fn(root);
  return root;
};

describe('sheet helpers', () => {
  const keys = [
    { id: 'a', name: 'A', tag: 'North', years: { from: -300, to: -200 }, rows: [] },
    { id: 'b', name: 'B', tag: 'North', years: { from: -190, to: 100 }, rows: [] },
    { id: 'c', name: 'C', tag: 'South', years: { from: -250, to: 50 }, rows: [] },
    { id: 'd', name: 'D', rows: [] },
  ];
  it('labels years in BCE and CE', () => {
    expect(yearsLabel(keys[0]!)).toBe('300 – 200 BCE');
    expect(yearsLabel(keys[1]!)).toBe('190 BCE – 100 CE');
    expect(yearsLabel({ years: { from: 1526, to: 1526 } })).toBe('1526');
    expect(yearsLabel({ years: { from: 1, to: 2, label: 'c. 1' } })).toBe('c. 1');
    expect(yearsLabel(keys[3]!)).toBe('');
  });
  it('finds order, lanes, the one before and the ones at the same time', () => {
    expect(inOrder(keys).map((k) => k.id)).toEqual(['a', 'c', 'b']);
    expect(lanesOf(keys)).toEqual(['North', 'South']);
    expect(previousInLane(keys[1]!, keys)?.id).toBe('a');
    expect(previousInLane(keys[0]!, keys)).toBeNull();
    expect(previousInLane(keys[3]!, keys)).toBeNull();
    expect(sameTime(keys[2]!, keys).map((k) => k.id)).toEqual(['a', 'b']);
    expect(sameTime(keys[3]!, keys)).toEqual([]);
  });
  it('puts undated keys beside the dated key before them', () => {
    const k = (id: string, y?: number) => ({ id, name: id, rows: [], ...(y === undefined ? {} : { years: { from: y, to: y } }) });
    expect(chrono([k('x'), k('b', 10), k('y'), k('a', 5)]).map((e) => e.key.id)).toEqual(['a', 'x', 'b', 'y']);
    expect(chrono([k('z')], 7)[0]!.at).toBe(7);
  });
});

describe('revision sheets content', () => {
  it('covers every history chapter and has rich keys', () => {
    for (const c of getChapters()) expect(getSheetsForChapter(c.id).length, c.id).toBeGreaterThan(0);
    const keys = getSheets().flatMap((s) => s.keys);
    expect(keys.length).toBeGreaterThan(300);
    for (const k of keys) expect(k.rows.length, k.id).toBeGreaterThanOrEqual(3);
  });
});

describe('revision sheets pages', () => {
  it('is reached from the Revise hub', () => {
    const root = open('#/revise', renderRevise);
    expect(root.textContent).toContain('Revision sheets');
  });

  it('lists sheets by part and opens one', () => {
    const root = open('#/revise/sheets', renderIndex);
    expect(root.textContent).toContain('Ancient India');
    expect(root.textContent).toContain('Polity');
    expect(root.querySelectorAll('.sh-tile').length).toBe(getSheets().length);
  });

  it('shows one table row per key, oldest first, and covers values', () => {
    const root = open('#/revise/sheets/s-mughal', renderSheet);
    const names = [...root.querySelectorAll('.sh-tk-name')].map((n) => n.textContent);
    expect(names).toContain('Akbar');
    expect(names.indexOf('Babur')).toBeLessThan(names.indexOf('Akbar'));
    expect(root.querySelector('.sh-td-h')?.textContent).toBeTruthy();
    const cover = [...root.querySelectorAll<HTMLButtonElement>('.sh-tool')].find((b) => b.textContent?.includes('Cover'))!;
    cover.click();
    expect(root.querySelector('.sh')!.classList.contains('is-covered')).toBe(true);
    const cell = root.querySelector<HTMLElement>('.sh-td')!;
    cell.click();
    expect(cell.classList.contains('is-shown')).toBe(true);
    cover.click();
    expect(root.querySelector('.sh')!.classList.contains('is-covered')).toBe(false);
  });

  it('shows everything in one table with part filters', () => {
    const root = open('#/revise/sheets/all', renderSheet);
    const rows = root.querySelectorAll('.sh-tr');
    expect(rows.length).toBe(everything(getSheets()).length);
    expect(rows[0]!.textContent).toContain('Palaeolithic');
    [...root.querySelectorAll<HTMLButtonElement>('.sh-filter .sh-chip')].find((b) => b.textContent === 'Polity')!.click();
    expect(root.querySelectorAll('.sh-tr').length).toBe(everything(getSheets(), 'Polity').length);
    expect(root.querySelector('.sh-tk-sheet')?.getAttribute('href')).toContain('#/revise/sheets/s-po');
  });

  it('draws a lane chart with before and same-time rows', () => {
    const root = open('#/revise/sheets/s-mchart', renderSheet);
    expect(root.querySelectorAll('.sh-bar').length).toBeGreaterThan(20);
    expect(root.textContent).toContain('Same time');
    expect(root.textContent).toContain('Before');
    const bar = root.querySelector<HTMLButtonElement>('.sh-bar')!;
    bar.click();
    expect(root.querySelector('.sh-tr.is-flash')).not.toBeNull();
  });

  it('shows traps as their own cell', () => {
    const root = open('#/revise/sheets/s-ivc', renderSheet);
    expect(root.querySelector('.sh-td-trap')?.textContent).toContain('Don');
  });

  it('marks a sheet revised and undoes it', () => {
    const root = open('#/revise/sheets/s-ages', renderSheet);
    root.querySelector<HTMLButtonElement>('.sh-done')!.click();
    expect(getSheetsRevised()['s-ages']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(root.querySelector('.sh-done')!.textContent).toContain('undo');
    expect(open('#/revise/sheets', renderIndex).querySelector('.sh-tile.is-done')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.sh-done')!.click();
    expect(getSheetsRevised()['s-ages']).toBeUndefined();
  });

  it('pages between sheets and falls back to the index', () => {
    const root = open('#/revise/sheets/s-ages', renderSheet);
    expect(root.querySelector('.sh-pager-link.is-next')?.textContent).toContain('Indus');
    expect(open('#/revise/sheets/nope', renderSheet).textContent).toContain('sheets revised');
  });

  it('prints without throwing', () => {
    const root = open('#/revise/sheets/s-ages', renderSheet);
    [...root.querySelectorAll<HTMLButtonElement>('.sh-tool')].find((b) => b.textContent === 'Print')!.click();
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('print-sheet')).toBe(false);
  });

  it('links each history chapter to its sheets', () => {
    const root = open('#/topics/history/ancient-to-232bce', renderChapter);
    const links = [...root.querySelectorAll<HTMLAnchorElement>('.hl-sheets-link')].map((a) => a.getAttribute('href'));
    expect(links).toContain('#/revise/sheets/s-ages');
  });
});
