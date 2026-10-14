/**
 * Mental Ability FORMULA SHEET (route `#/formula-sheet`) — the one-page sheet
 * the light day before Prelims promises ("AP + CA key facts · formula sheet",
 * FLOW-QA D9).
 *
 * Generated, never hand-copied: every row comes from the "TL;DR" tables of the
 * Mental Ability notes (quantitative + reasoning lanes; the psychological
 * "abilities" topics are left out — they are concepts, not formulas). Topics
 * follow the learning sequence. A Print button prints only the sheet; an
 * "I've read it" button ticks the light-day row on Today.
 */
import { getLearningSequence, getSubtopic, getSubtopics } from '../content/loader';
import type { NoteItem } from '../content/types';
import { FORMULA_SHEET_KEY, isRowKeyDone, markRowKeyDone } from '../lib/day-tasks';
import { todayISO } from '../lib/dates';
import { navigate } from '../router/router';
import { el, mount, renderInline } from './dom';
import { button } from './components/button';
import { chip } from './components/chip';

/** One topic's formula rows. */
export interface FormulaSection {
  subtopicId: string;
  name: string;
  rows: Array<{ formula: string; meaning: string }>;
}

/**
 * Pull every TL;DR table row out of `notes` (markdown: a `**TL;DR**` line, then
 * a `| … | … |` table; the header and `|---|` rows are skipped). PURE.
 */
export function tldrRows(notes: readonly Pick<NoteItem, 'body'>[]): Array<{ formula: string; meaning: string }> {
  const out: Array<{ formula: string; meaning: string }> = [];
  for (const note of notes) {
    const lines = note.body.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^\s*\*\*TL;DR\*\*\s*$/.test(lines[i]!)) continue;
      let j = i + 1;
      let header = true;
      while (j < lines.length && lines[j]!.trim().startsWith('|')) {
        const cells = lines[j]!.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const isRule = cells.every((c) => /^:?-{2,}:?$/.test(c));
        if (header) header = false;
        else if (!isRule && cells.length >= 2 && cells[0]) out.push({ formula: cells[0], meaning: cells.slice(1).join(' — ') });
        j += 1;
      }
      i = j - 1;
    }
  }
  return out;
}

/** The sheet's sections: quant + reasoning MENT topics in learning order. */
export function formulaSections(): FormulaSection[] {
  const steps = getLearningSequence().subjects['MENT'] ?? [];
  const ordered = steps.filter((s) => s.stream !== 'abilities').map((s) => s.id);
  const known = new Set(ordered);
  // Any MENT topic missing from the sequence still appears (at the end).
  for (const s of getSubtopics('MENT')) if (!known.has(s.id)) ordered.push(s.id);
  const abilities = new Set(steps.filter((s) => s.stream === 'abilities').map((s) => s.id));
  const out: FormulaSection[] = [];
  for (const id of ordered) {
    if (abilities.has(id)) continue;
    const view = getSubtopic(id);
    if (!view) continue;
    const rows = tldrRows(view.notes);
    if (rows.length > 0) out.push({ subtopicId: id, name: view.meta.name, rows });
  }
  return out;
}

/** Print ONLY the sheet (print.css keys off `body.print-formula`). @internal */
function printSheet(): void {
  document.body.classList.add('print-formula');
  const done = (): void => {
    document.body.classList.remove('print-formula');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  try {
    window.print();
  } catch {
    /* jsdom: print is not implemented */
  }
}

/** Render the formula sheet into `root`. */
export function render(root: HTMLElement): void {
  const today = todayISO();
  const sections = formulaSections();
  const actions = el('div', { class: 'hero-actions formula-sheet-actions' });
  const drawActions = (): void => {
    const read = isRowKeyDone(today, FORMULA_SHEET_KEY);
    actions.replaceChildren(
      button({ label: 'Print', variant: 'secondary', iconName: 'notes', onClick: printSheet }),
      read
        ? chip({ text: 'Read \u2713', tone: 'ok', iconName: 'check' })
        : button({
            label: 'I\u2019ve read it',
            variant: 'primary',
            iconName: 'check',
            onClick: () => {
              markRowKeyDone(today, FORMULA_SHEET_KEY, true);
              drawActions();
            },
          }),
      button({ label: 'Back to Today', variant: 'ghost', onClick: () => navigate('/') }),
    );
  };
  drawActions();

  const body = sections.length === 0
    ? [el('p', { class: 'section-lead', text: 'No formula tables found in the Mental Ability notes yet.' })]
    : sections.map((s) =>
        el('section', { class: 'formula-topic' }, [
          el('h3', { class: 'formula-topic-title', text: s.name }),
          el('table', { class: 'md-table formula-table' }, [
            el('tbody', {}, s.rows.map((r) =>
              el('tr', {}, [
                el('td', { class: 'formula-cell' }, renderInline(r.formula)),
                el('td', {}, renderInline(r.meaning)),
              ]),
            )),
          ]),
        ]),
      );

  mount(
    root,
    el('article', { class: 'card formula-sheet', attrs: { 'aria-labelledby': 'formula-sheet-title' } }, [
      el('h2', { class: 'card-title', attrs: { id: 'formula-sheet-title' }, text: 'Mental Ability formula sheet' }),
      el('p', { class: 'section-lead', text: `One page, ${sections.length} topics \u2014 every line comes from the TL;DR table of a Mental Ability note.` }),
      actions,
      el('div', { class: 'formula-grid' }, body),
    ]),
  );
}
