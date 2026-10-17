// @vitest-environment jsdom
/**
 * DOM RENDER AUDIT — renders EVERY MCQ on disk through the REAL stem renderer
 * ({@link renderQuestionStem}, used by drill, drill review, mock running/review
 * and OMR) and asserts the rendered structure is sound:
 *
 * - match tables: two header cells, one row per key with BOTH columns present
 *   (equal cell counts), no empty cells, no cell that is a lone digit, every
 *   List-I / List-II key shown in order, every key the option codes reference
 *   actually rendered;
 * - statement lists: exactly one `<li>` per statement;
 * - Assertion–Reason: both labelled blocks;
 * - globally: no raw pipe-table text, and no "List-II:" header text swallowed
 *   into a list item or table cell.
 *
 * Failures are collected per item so one run reports every broken question.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderQuestionStem } from '../quiz';
import { parseMatchOptions } from '../../lib/question-structure';
import { MCQBankSchema, type MCQItem } from '../../content/types';

const CONTENT = resolve(__dirname, '../../../content');

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/^mcq-.*\.json$/.test(f)) out.push(p);
  }
  return out;
}

function allMcqs(): MCQItem[] {
  const items: MCQItem[] = [];
  for (const f of walk(CONTENT)) {
    const parsed = MCQBankSchema.safeParse(JSON.parse(readFileSync(f, 'utf8')));
    if (parsed.success) items.push(...parsed.data.items);
  }
  return items;
}

function render(item: MCQItem): HTMLElement {
  const host = document.createElement('div');
  for (const node of renderQuestionStem(item)) {
    if (node) host.append(typeof node === 'string' ? document.createTextNode(node) : node);
  }
  return host;
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Every problem found in one rendered item. */
function auditItem(item: MCQItem): string[] {
  const host = render(item);
  const problems: string[] = [];

  // Global: no raw pipe-table syntax leaked as text (separator rows / List headers).
  const plain = text(host);
  if (/\|\s*:?-{3,}/.test(plain) || /\|\s*List[\s-]*I/i.test(plain)) problems.push('raw "|" table text');
  for (const li of host.querySelectorAll('li')) {
    if (/List[\s-]*II\s*:/i.test(text(li))) problems.push(`"List-II:" inside list item: ${text(li).slice(0, 50)}`);
  }

  // Any match table (structured or fallback-parsed) must be well-formed.
  for (const table of host.querySelectorAll('table.match-table')) {
    if (table.querySelectorAll('thead th').length !== 2) problems.push('match table without two header cells');
    for (const tr of table.querySelectorAll('tbody tr')) {
      const tds = [...tr.querySelectorAll('td')];
      if (tds.length !== 2) problems.push(`match row with ${tds.length} cells`);
      for (const td of tds) {
        const t = text(td);
        if (t === '') problems.push('empty match cell');
        if (/^\d$/.test(t)) problems.push(`match cell is a lone digit "${t}"`);
        if (/List[\s-]*II/i.test(t)) problems.push(`List-II header inside a cell: ${t.slice(0, 50)}`);
      }
    }
  }

  if (item.match) {
    const table = host.querySelector('table.match-table');
    if (!table) return [...problems, 'structured match rendered without a table'];
    const rows = [...table.querySelectorAll('tbody tr')];
    const n = Math.max(item.match.left.length, item.match.right.length);
    if (rows.length !== n) problems.push(`match rows ${rows.length} != ${n}`);
    const leftCells = rows.map((r) => text(r.querySelectorAll('td')[0]!));
    const rightCells = rows.map((r) => text(r.querySelectorAll('td')[1]!));
    if (leftCells.length !== rightCells.length) problems.push('unequal column cell counts');
    item.match.left.forEach((e, i) => {
      if (!leftCells[i]?.startsWith(`${e.key}.`)) problems.push(`List-I key ${e.key} lost (row ${i + 1})`);
    });
    item.match.right.forEach((e, i) => {
      if (!rightCells[i]?.startsWith(`${e.key}.`)) problems.push(`List-II key ${e.key} lost (row ${i + 1})`);
    });
    const shownL = new Set(leftCells.map((c) => c.split('.')[0]));
    const shownR = new Set(rightCells.map((c) => c.split('.')[0]));
    for (const p of parseMatchOptions(item.options)?.flat() ?? []) {
      if (!shownL.has(p.left)) problems.push(`option key ${p.left} not rendered`);
      if (!shownR.has(p.right)) problems.push(`option key ${p.right} not rendered`);
    }
  }

  if (item.statements) {
    const lis = host.querySelectorAll('ol.stmt-list > li');
    if (lis.length !== item.statements.length) problems.push(`statements ${lis.length} != ${item.statements.length}`);
    for (const li of lis) if (text(li) === '') problems.push('empty statement');
  }

  if (item.assertion !== undefined) {
    if (!host.querySelector('.ar-assertion') || !host.querySelector('.ar-reason')) problems.push('A-R blocks missing');
  }

  return problems;
}

describe('DOM render audit — every MCQ through the real stem renderer', () => {
  const items = allMcqs();

  it('loads the full MCQ corpus', () => {
    expect(items.length).toBeGreaterThan(3000);
    // Computed after the question-format round (q-final, 2026-10-13): every one
    // of the 129 MCQ banks parses, 3369 items in all (360 match, 939 statements,
    // 40 A-R). Update to the new computed totals when the bank grows.
    expect(walk(CONTENT)).toHaveLength(129);
    expect(items).toHaveLength(3369);
    expect(items.filter((i) => i.match).length).toBe(360);
    expect(items.filter((i) => i.statements).length).toBe(951);
    expect(items.filter((i) => i.assertion !== undefined).length).toBe(45);
  });

  it('renders every match / statement / A-R stem without structural defects', () => {
    const failures: string[] = [];
    for (const item of items) {
      const problems = auditItem(item);
      if (problems.length > 0) failures.push(`${item.id}: ${problems.join('; ')}`);
    }
    expect(failures, failures.slice(0, 40).join('\n')).toEqual([]);
  });

  it('renders the reported regressions correctly (C. P. Radhakrishnan, ECLGS 5.0)', () => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const post = byId.get('ca-national-mcq-4');
    const scheme = byId.get('ca-national-mcq-36');
    if (post) {
      const cells = [...render(post).querySelectorAll('tbody td')].map(text);
      expect(cells).toContain('2. C. P. Radhakrishnan');
      expect(cells).toHaveLength(8);
    }
    if (scheme) {
      expect(text(render(scheme))).toContain('ECLGS 5.0');
      expect(text(render(scheme))).not.toContain('5. 0');
    }
  });
});
