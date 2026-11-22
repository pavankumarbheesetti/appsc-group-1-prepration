/**
 * Revision sheets (`#/revise/sheets`, `#/revise/sheets/:id`): one sheet per
 * topic, one box per key (ruler, site, text, war, Act). Each box is a short
 * label → value list, plus the traps the paper sets. A sheet can show its keys
 * in time order, and dynasty sheets draw every key on a lane chart so you see
 * who ruled at the same time. "Cover and recall" hides every value until tapped.
 */
import { getSheet, getSheets } from '../content/loader';
import type { Sheet, SheetKey } from '../content/sheet-types';
import { byPart, chrono, everything, inOrder, lanesOf, previousInLane, sameTime, sheetSpan, yearText, yearsLabel } from '../lib/sheets';
import { SHEET_PARTS } from '../content/sheet-types';
import { navigate, routeParam } from '../router/router';
import { getSheetsRevised, setSheetRevised } from '../state/store';
import { el, mount } from './dom';
import { icon } from './components/icon';

export const SHEETS_PATH = '/revise/sheets';

const ordered = (): Sheet[] => byPart(getSheets()).flatMap((g) => g.sheets);

/* ------------------------------------------------------------------ index */

export function renderIndex(root: HTMLElement): void {
  const done = getSheetsRevised();
  const all = ordered();
  const n = all.filter((s) => done[s.id]).length;
  mount(root, el('div', { class: 'sh' }, [
    el('button', { class: 'btn btn-ghost sh-back', type: 'button', onClick: () => navigate('/revise') }, [el('span', { text: '‹ Revise' })]),
    el('h1', { class: 'page-title', text: 'Revision sheets' }),
    el('p', { class: 'section-lead', text: 'One sheet per topic. Every key has its years and the facts the paper asks, in a few lines. Read the lessons first; use these to revise.' }),
    el('p', { class: 'sh-count tnum', text: `${n} of ${all.length} sheets revised` }),
    el('a', { class: 'btn btn-primary sh-all', attrs: { href: `#${SHEETS_PATH}/all` }, text: 'Everything in one table, oldest first' }),
    ...byPart(getSheets()).map((g) => el('section', { class: 'sh-part' }, [
      el('h2', { class: 'sh-part-title', text: g.part }),
      el('div', { class: 'sh-tiles' }, g.sheets.map((s) => el('a', {
        class: `sh-tile${done[s.id] ? ' is-done' : ''}`,
        attrs: { href: `#${SHEETS_PATH}/${s.id}` },
      }, [
        el('strong', { class: 'sh-tile-title', text: s.title }),
        el('span', { class: 'sh-tile-meta tnum', text: [sheetSpan(s), `${s.keys.length} keys`, s.chart ? 'chart' : ''].filter(Boolean).join(' · ') }),
        done[s.id] ? el('span', { class: 'sh-tile-done' }, [icon('check', 14), el('span', { text: `Revised ${done[s.id]}` })]) : null,
      ]))),
    ])),
  ]));
}

/* ------------------------------------------------------------------ sheet */

function focusKey(id: string): void {
  const node = document.getElementById(`k-${id}`);
  if (!node) return;
  node.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  node.classList.add('is-flash');
  window.setTimeout(() => node.classList.remove('is-flash'), 1600);
}

/** Lane chart: one row per lane, bars on a common year axis. */
function laneChart(keys: readonly SheetKey[]): HTMLElement {
  const d = inOrder(keys);
  const min = Math.min(...d.map((k) => k.years.from));
  const max = Math.max(...d.map((k) => k.years.to));
  const width = Math.max(max - min, 1);
  const pct = (y: number) => ((y - min) / width) * 100;
  const step = [25, 50, 100, 200, 250, 500].find((s) => width / s <= 10) ?? 1000;
  const ticks: number[] = [];
  for (let y = Math.ceil(min / step) * step; y <= max; y += step) ticks.push(y);
  return el('div', { class: 'sh-chart-wrap' }, [
    el('div', { class: 'sh-chart' }, [
      el('div', { class: 'sh-axis' }, [
        el('span', { class: 'sh-lane-name' }),
        el('div', { class: 'sh-axis-track' }, ticks.map((t) => el('span', { class: 'sh-tick tnum', attrs: { style: `left:${pct(t)}%` }, text: yearText(t) }))),
      ]),
      ...lanesOf(d).map((lane) => el('div', { class: 'sh-lane' }, [
        el('span', { class: 'sh-lane-name', text: lane }),
        el('div', { class: 'sh-track' }, d.filter((k) => k.tag === lane).map((k) => el('button', {
          class: 'sh-bar', type: 'button',
          attrs: { style: `left:${pct(k.years.from)}%;width:${Math.max(pct(k.years.to) - pct(k.years.from), 1.2)}%`, title: `${k.name}: ${yearsLabel(k)}` },
          onClick: () => focusKey(k.id),
        }, [el('span', { text: k.name })]))),
      ])),
    ]),
  ]);
}

/** One table row: the key cell, then one cell per fact, each with its own small header. */
function keyRow(k: SheetKey, sheet: Sheet, showSheet = false): HTMLElement {
  const rows = [...k.rows];
  if (sheet.chart) {
    const prev = previousInLane(k, sheet.keys);
    const mates = sameTime(k, sheet.keys);
    rows.push({ k: 'Before', v: prev ? `${prev.name} (${yearsLabel(prev)})` : 'First in this row' });
    rows.push({ k: 'Same time', v: mates.length ? mates.map((m) => m.name).join(', ') : 'None here' });
  }
  const reveal = (e: Event) => (e.currentTarget as HTMLElement).classList.toggle('is-shown');
  return el('tr', { class: 'sh-tr', attrs: { id: `k-${k.id}` } }, [
    el('th', { class: 'sh-tk', attrs: { scope: 'row' } }, [
      el('strong', { class: 'sh-tk-name', text: k.name }),
      k.years ? el('span', { class: 'sh-tk-years tnum', text: yearsLabel(k) }) : null,
      k.hook ? el('span', { class: 'sh-tk-hook', text: k.hook }) : null,
      showSheet ? el('a', { class: 'sh-tk-sheet', attrs: { href: `#${SHEETS_PATH}/${sheet.id}` }, text: sheet.title }) : k.tag && !sheet.chart ? el('span', { class: 'sh-tk-sheet', text: k.tag }) : null,
    ]),
    ...rows.map((r) => el('td', { class: 'sh-td', onClick: reveal }, [
      el('span', { class: 'sh-td-h', text: r.k }),
      el('span', { class: 'sh-td-v', text: r.v }),
    ])),
    k.traps?.length
      ? el('td', { class: 'sh-td sh-td-trap', onClick: reveal }, [
          el('span', { class: 'sh-td-h', text: 'Don\u2019t confuse' }),
          el('span', { class: 'sh-td-v', text: k.traps.join(' · ') }),
        ])
      : null,
  ]);
}

function bigTable(rows: HTMLElement[]): HTMLElement {
  return el('div', { class: 'sh-table-wrap' }, [el('table', { class: 'sh-table' }, [el('tbody', {}, rows)])]);
}

function coverButton(page: HTMLElement): HTMLElement {
  const btn = el('button', { class: 'btn btn-ghost sh-tool', type: 'button', attrs: { 'aria-pressed': 'false' } }, [icon('revise', 15), el('span', { text: 'Cover and recall' })]);
  btn.addEventListener('click', () => {
    const on = !page.classList.contains('is-covered');
    page.classList.toggle('is-covered', on);
    page.querySelectorAll('.is-shown').forEach((r) => r.classList.remove('is-shown'));
    btn.setAttribute('aria-pressed', String(on));
    btn.replaceChildren(icon('revise', 15), el('span', { text: on ? 'Show all' : 'Cover and recall' }));
  });
  return btn;
}

/** `#/revise/sheets/all`: every key of every sheet in one table, oldest first. */
export function renderAll(root: HTMLElement, part?: Sheet['part']): void {
  const page = el('div', { class: 'sh' });
  const list = everything(getSheets(), part);
  mount(root, el('div', {}, [page]));
  page.append(
    el('button', { class: 'btn btn-ghost sh-back', type: 'button', onClick: () => navigate(SHEETS_PATH) }, [el('span', { text: '‹ All revision sheets' })]),
    el('h1', { class: 'page-title', text: 'Everything, one table' }),
    el('p', { class: 'section-lead', text: `${list.length} rows, oldest first. Each cell has its own heading.` }),
    el('div', { class: 'sh-filter' }, [undefined, ...SHEET_PARTS].map((p) => el('button', {
      class: `sh-chip${p === part ? ' is-on' : ''}`, type: 'button', onClick: () => renderAll(root, p),
    }, [el('span', { text: p ?? 'All' })]))),
    el('div', { class: 'sh-toolbar' }, [coverButton(page), el('button', { class: 'btn btn-ghost sh-tool', type: 'button', onClick: printSheet }, [el('span', { text: 'Print' })])]),
    el('p', { class: 'sh-cover-hint', text: 'Values are hidden. Say each one, then tap the cell to check.' }),
    bigTable(list.map((e) => keyRow(e.key, e.sheet, true))),
  );
}

/** Print ONLY the sheet (print.css keys off `body.print-sheet`). */
function printSheet(): void {
  document.body.classList.add('print-sheet');
  const done = (): void => {
    document.body.classList.remove('print-sheet');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  try {
    window.print();
  } catch {
    /* jsdom: print is not implemented */
  }
}

export function renderSheet(root: HTMLElement): void {
  const id = routeParam(`${SHEETS_PATH}/:id`, 'id');
  if (id === 'all') {
    renderAll(root);
    return;
  }
  const sheet = id ? getSheet(id) : undefined;
  if (!sheet) {
    renderIndex(root);
    return;
  }
  const all = ordered();
  const i = all.findIndex((s) => s.id === sheet.id);
  const prev = all[i - 1];
  const next = all[i + 1];
  const done = getSheetsRevised()[sheet.id];
  const page = el('div', { class: 'sh' });

  const coverBtn = coverButton(page);
  const doneBtn = el('button', {
    class: `btn ${done ? 'btn-ghost' : 'btn-primary'} sh-tool sh-done`, type: 'button',
    onClick: () => { setSheetRevised(sheet.id, !done); renderSheet(root); },
  }, [icon('check', 15), el('span', { text: done ? `Revised ${done} · undo` : 'Mark revised' })]);

  mount(root, el('div', {}, [page]));
  const parts: (HTMLElement | null)[] = [
    el('button', { class: 'btn btn-ghost sh-back', type: 'button', onClick: () => navigate(SHEETS_PATH) }, [el('span', { text: '‹ All revision sheets' })]),
    el('p', { class: 'sh-eyebrow', text: `${sheet.part} · sheet ${all.filter((s) => s.part === sheet.part).indexOf(sheet) + 1}` }),
    el('h1', { class: 'page-title', text: sheet.title }),
    el('p', { class: 'sh-meta tnum', text: [sheetSpan(sheet), `${sheet.keys.length} keys`].filter(Boolean).join(' · ') }),
    sheet.intro ? el('p', { class: 'section-lead', text: sheet.intro }) : null,
    el('div', { class: 'sh-toolbar' }, [
      coverBtn,
      el('button', { class: 'btn btn-ghost sh-tool', type: 'button', onClick: printSheet }, [el('span', { text: 'Print' })]),
      doneBtn,
    ]),
    el('p', { class: 'sh-cover-hint', text: 'Values are hidden. Say each one, then tap the cell to check.' }),
    sheet.chart ? laneChart(sheet.keys) : null,
    bigTable(chrono(sheet.keys).map((e) => keyRow(e.key, sheet))),
    el('nav', { class: 'sh-pager' }, [
      prev ? el('a', { class: 'sh-pager-link', attrs: { href: `#${SHEETS_PATH}/${prev.id}` } }, [el('span', { class: 'sh-label', text: 'Previous' }), el('strong', { text: prev.title })]) : el('span'),
      next ? el('a', { class: 'sh-pager-link is-next', attrs: { href: `#${SHEETS_PATH}/${next.id}` } }, [el('span', { class: 'sh-label', text: 'Next' }), el('strong', { text: next.title })]) : el('span'),
    ]),
  ];
  page.append(...parts.filter((x): x is HTMLElement => x !== null));
}
