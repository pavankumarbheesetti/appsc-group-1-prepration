/**
 * Notes heading hierarchy — the fix for "all headings are the same size; it is
 * hard to see where a sub-topic ends":
 *  - LEVEL 1: each note is a numbered SECTION (`Section 3 of 8` eyebrow + an h2
 *    title on the Learn page) with its own header;
 *  - LEVEL 2: `##` / `###` body sections render as h3 / h4 with stable ids;
 *  - LEVEL 3: `####` renders as h5 and bold-only run-in labels as p.md-label;
 *  - END: Must remember / memory hook / Source sit in one closing panel;
 *  - CONTENTS: the "On this page" list is nested (notes → their sections) and
 *    the tracker highlights both levels.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isRunInLabel, markdownHeadings, renderMarkdown } from '../dom';
import { buildMainsNotesSection, buildNoteArticle, noteSections, noteSectionId, sourceRunEnds, stripLeadHeading } from '../notes';
import { renderApp } from '../../app';
import { __setTocCurrentForTests, openLearn } from '../learn';
import { getBanks, getSubtopic } from '../../content/loader';
import { isMainsNote } from '../../engine/flashcards';
import { __resetForTests, setPlanStartDate } from '../../state/store';
import type { NoteItem } from '../../content/types';

const SERIES = 'ment-number-series-coding';
const STONE = 'hist-ancient-stone-age';

function block(md: string): HTMLElement {
  const host = document.createElement('div');
  host.append(...renderMarkdown(md));
  return host;
}

function note(over: Partial<NoteItem> = {}): NoteItem {
  return {
    id: 'n1',
    subjectCode: 'MENT',
    title: 'Arithmetic series',
    body: [
      'Intro paragraph.',
      '',
      '### First differences',
      '',
      '**The idea in one sentence**',
      'Add the same amount each time.',
      '',
      '#### A worked case',
      'Text.',
      '',
      '### Ratios',
      '',
      '**Common traps**',
      '- Forcing addition.',
    ].join('\n'),
    keyPoints: ['Check differences first.'],
    source: 'NCERT Class 6',
    ...over,
  } as NoteItem;
}

describe('renderMarkdown — level-3 headings and run-in labels', () => {
  it('renders #### as an h5 (it used to leak as "#### text")', () => {
    const host = block('#### Buddhist sites\nText');
    expect(host.querySelector('h5')?.textContent).toBe('Buddhist sites');
    expect(host.textContent).not.toContain('####');
  });

  it('marks a bold-only short line as a compact label, not emphasised prose', () => {
    const host = block('**The idea in one sentence**\nBody.\n\n**TL;DR:**\n\n**This whole sentence is emphasised.**');
    const labels = [...host.querySelectorAll('p.md-label')].map((p) => p.textContent);
    expect(labels).toEqual(['The idea in one sentence', 'TL;DR:']);
  });

  it('isRunInLabel rejects inline run-ins, long lines and sentences', () => {
    expect(isRunInLabel('**Common traps**')).toBe(true);
    expect(isRunInLabel('**In one line:** the rest of the sentence')).toBe(false);
    expect(isRunInLabel('**Introduction.**')).toBe(false);
    expect(isRunInLabel(`**${'x'.repeat(61)}**`)).toBe(false);
  });

  it('markdownHeadings lists exactly the headings renderMarkdown emits (every real note)', () => {
    let checked = 0;
    for (const { bank } of getBanks('notes')) {
      if (bank.kind !== 'notes') continue;
      for (const n of bank.items) {
        const body = stripLeadHeading(n.body);
        const dom = [...block(body).children]
          .filter((c) => /^H[345]$/.test(c.tagName))
          .map((c) => Number(c.tagName.slice(1)));
        expect(markdownHeadings(body).map((h) => h.level), n.id).toEqual(dom);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('buildNoteArticle — section structure', () => {
  it('renders a numbered eyebrow above the title when given a position', () => {
    const art = buildNoteArticle(note(), 'learn-note-n1', { index: 3, total: 8, titleTag: 'h2' });
    const head = art.querySelector('header.note-head')!;
    expect(head.firstElementChild?.className).toBe('note-eyebrow');
    expect(head.querySelector('.note-eyebrow')?.textContent).toBe('Section 3 of 8');
    const title = head.querySelector('.note-title')!;
    expect(title.tagName).toBe('H2');
    expect(art.getAttribute('aria-labelledby')).toBe(title.id);
    expect(art.dataset.section).toBe('3');
  });

  it('omits the eyebrow without a position (or for a single note) and defaults to h3', () => {
    expect(buildNoteArticle(note(), 'a').querySelector('.note-eyebrow')).toBeNull();
    expect(buildNoteArticle(note(), 'a', { index: 1, total: 1 }).querySelector('.note-eyebrow')).toBeNull();
    expect(buildNoteArticle(note(), 'a').querySelector('.note-title')?.tagName).toBe('H3');
  });

  it('gives body sections (h4 from ###) stable ids and keeps #### / labels as level 3', () => {
    const art = buildNoteArticle(note(), 'learn-note-n1');
    const secs = [...art.querySelectorAll('.note-body > .note-section-heading')];
    expect(secs.map((h) => [h.tagName, h.id, h.textContent])).toEqual([
      ['H4', noteSectionId('learn-note-n1', 0), 'First differences'],
      ['H4', noteSectionId('learn-note-n1', 1), 'Ratios'],
    ]);
    expect(art.querySelector('.note-body > h5')?.classList.contains('note-section-heading')).toBe(false);
    expect([...art.querySelectorAll('.note-body > p.md-label')].map((p) => p.textContent)).toEqual([
      'The idea in one sentence',
      'Common traps',
    ]);
  });

  it('ends with ONE closing panel holding Must remember, the memory hook and Source', () => {
    const art = buildNoteArticle(note({ mnemonic: 'A hook.' }), 'x');
    const end = art.querySelector(':scope > footer.note-end')!;
    expect(end).not.toBeNull();
    expect(art.lastElementChild).toBe(end);
    expect(end.querySelector('.note-keypoints')).not.toBeNull();
    expect(end.querySelector('.note-mnemonic')).not.toBeNull();
    expect(end.lastElementChild?.className).toBe('note-source');
    expect(end.getAttribute('aria-label')).toBe('End of Arithmetic series');
  });

  it('has no closing panel when there is nothing to close with', () => {
    const art = buildNoteArticle(note({ keyPoints: [], source: undefined }), 'x');
    expect(art.querySelector('.note-end')).toBeNull();
  });

  it('noteSections lists the top-most body level with ids matching the DOM', () => {
    const mixed = note({ body: 'p\n\n## Part A\n\n### a1\n\n## Part B\n\n### b1' });
    const secs = noteSections(mixed, 'z');
    expect(secs.map((s) => s.title)).toEqual(['Part A', 'Part B']);
    const art = buildNoteArticle(mixed, 'z');
    for (const s of secs) expect(art.querySelector(`#${s.anchor}`)?.tagName).toBe('H3');
    expect(noteSections(note(), 'z').map((s) => s.title)).toEqual(['First differences', 'Ratios']);
  });
});

describe('Learn Notes — numbered sections and nested contents', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
    location.hash = '';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T10:00:00'));
    setPlanStartDate('2026-10-14');
  });

  function app(): HTMLElement {
    document.body.innerHTML = '';
    const root = document.createElement('div');
    document.body.appendChild(root);
    renderApp(root);
    return root;
  }

  it('numbers every Prelims note "Section i of N" under an h2 title', () => {
    const root = app();
    openLearn(SERIES, { from: 'topics' });
    const prelims = getSubtopic(SERIES)!.notes.filter((n) => !isMainsNote(n));
    const arts = [...root.querySelectorAll<HTMLElement>('.learn-notes-layout .reading > article.note')];
    expect(arts).toHaveLength(prelims.length);
    arts.forEach((a, i) => {
      expect(a.querySelector('.note-eyebrow')?.textContent).toBe(`Section ${i + 1} of ${prelims.length}`);
      expect(a.querySelector('.note-head > .note-title')?.tagName).toBe('H2');
    });
    // The gold format's ### sections are h4 level-2 headings; its labels are level 3.
    expect(arts[0]!.querySelectorAll('.note-body > h4.note-section-heading').length).toBeGreaterThan(1);
    expect(arts[0]!.querySelector('.note-body > p.md-label')?.textContent).toBe('The idea in one sentence');
  });

  it('nests each note’s sections under its title in the side list and the sheet', () => {
    const root = app();
    openLearn(SERIES, { from: 'topics' });
    const prelims = getSubtopic(SERIES)!.notes.filter((n) => !isMainsNote(n));
    for (const nav of root.querySelectorAll<HTMLElement>('.learn-toc, .contents-sheet')) {
      const groups = [...nav.querySelectorAll(':scope > ol.toc-list > li.toc-group')];
      expect(groups).toHaveLength(prelims.length);
      const first = groups[0]!;
      expect(first.querySelector(':scope > a.toc-link')?.textContent).toBe(prelims[0]!.title);
      const subs = [...first.querySelectorAll<HTMLAnchorElement>(':scope > ol.toc-sub a.toc-sublink')];
      expect(subs.length).toBeGreaterThan(1);
      // Every sub-entry points at a real level-2 heading inside that note.
      for (const a of subs) {
        const target = document.getElementById(a.getAttribute('href')!.slice(1));
        expect(target?.closest('article.note')?.id).toBe(`learn-note-${prelims[0]!.id}`);
        expect(target?.classList.contains('note-section-heading')).toBe(true);
      }
    }
  });

  it('tracks both levels: the current note expands and the current section is marked', () => {
    const root = app();
    openLearn(STONE, { from: 'topics' });
    const side = root.querySelector<HTMLElement>('.learn-toc')!;
    const group = (i: number): HTMLElement => side.querySelectorAll<HTMLElement>('li.toc-group')[i]!;
    expect(group(0).classList.contains('is-current')).toBe(true);
    expect(group(0).querySelector('.toc-link')?.getAttribute('aria-current')).toBe('location');
    // Find a note with sections and move the tracker into its 2nd section.
    const groups = [...side.querySelectorAll<HTMLElement>('li.toc-group')];
    const gi = groups.findIndex((g) => g.querySelectorAll('.toc-sublink').length > 1);
    expect(gi).toBeGreaterThan(0);
    __setTocCurrentForTests(gi, 1);
    expect(group(0).classList.contains('is-current')).toBe(false);
    expect(group(0).querySelector('.toc-link')?.classList.contains('is-read')).toBe(true);
    expect(group(gi).classList.contains('is-current')).toBe(true);
    const subs = [...group(gi).querySelectorAll<HTMLElement>('.toc-sublink')];
    expect(subs[1]!.classList.contains('is-current')).toBe(true);
    expect(subs[1]!.getAttribute('aria-current')).toBe('location');
    expect(subs[0]!.classList.contains('is-current')).toBe(false);
    // The note link yields aria-current to the section while one is current.
    expect(group(gi).querySelector('.toc-link')?.hasAttribute('aria-current')).toBe(false);
    expect(root.querySelector('.contents-chip')?.textContent).toContain(`Contents \u00b7 ${gi + 1}/${groups.length}`);
  });
});

describe('notes CSS — a descending heading ladder built from tokens', () => {
  const css = readFileSync(resolve(__dirname, '../../styles/components.css'), 'utf8');
  /** The rule in the hierarchy block (first match after its banner). */
  const start = css.indexOf('Notes heading hierarchy (3 levels');
  const rule = (sel: string): string => {
    const i = css.indexOf(`\n${sel} {`, start);
    expect(i, sel).toBeGreaterThan(-1);
    return css.slice(i, css.indexOf('}', i));
  };

  it('title --fs-2xl > ## --fs-xl > ### --fs-lg > labels --fs-sm', () => {
    expect(rule('.note-head .note-title')).toContain('font-size: var(--fs-2xl)');
    expect(rule('.note > .note-body > h3')).toContain('font-size: var(--fs-xl)');
    expect(rule('.note > .note-body > h4')).toContain('font-size: var(--fs-lg)');
    const label = rule('.note-body > p.md-label');
    expect(label).toContain('font-size: var(--fs-sm)');
    expect(label).toContain('text-transform: uppercase');
  });

  it('separates sections and closes each one with a tinted panel', () => {
    expect(rule('.reading > .note')).toContain('border-top: 4px solid var(--accent)');
    const end = rule('.note-end');
    expect(end).toContain('background: var(--accent-soft)');
    expect(end).toContain('border-top: 3px solid var(--accent)');
    expect(rule('.toc-group.is-current > .toc-sub')).toContain('display: flex');
  });
});

/**
 * The last two on-screen repetitions:
 *  - SOURCE: a run of sections citing the byte-identical source shows the
 *    `Source:` line once, on the run's LAST section; distinct sources all stay;
 *  - CONTENTS: every destination is listed exactly once (no duplicate anchors,
 *    no sub-entry restating its note title).
 */
describe('Notes — one Source per run of sections', () => {
  const src = (id: string, source?: string): NoteItem => note({ id, title: `T ${id}`, source });

  it('sourceRunEnds marks only the last note of each shared-source run', () => {
    const notes = [src('a', 'NCERT Class 6'), src('b', 'NCERT Class 6'), src('c', 'Laxmikanth'), src('d'), src('e', 'Laxmikanth')];
    // 'e' re-cites Laxmikanth, already shown on 'c' → not printed again.
    expect(sourceRunEnds(notes)).toEqual([false, true, true, false, false]);
    expect(sourceRunEnds([])).toEqual([]);
    // A shared set carries across calls for one page (Prelims → For Mains).
    const shown = new Set<string>();
    expect(sourceRunEnds([src('x', 'A')], shown)).toEqual([true]);
    expect(sourceRunEnds([src('y', 'A'), src('z', 'B')], shown)).toEqual([false, true]);
  });

  it('a shared-source run renders ONE Source; a distinct source still renders', () => {
    const notes = [src('a', 'NCERT Class 6'), src('b', 'NCERT Class 6'), src('c', 'NCERT Class 6'), src('d', 'Laxmikanth')];
    const show = sourceRunEnds(notes);
    const arts = notes.map((n, i) => buildNoteArticle(n, `x-${n.id}`, { showSource: show[i] }));
    const lines = arts.map((a) => a.querySelector('.note-source')?.textContent ?? null);
    expect(lines).toEqual([null, null, 'Source: NCERT Class 6', 'Source: Laxmikanth']);
    // Still the LAST item of the closing panel, and the panel survives for key points.
    expect(arts[2]!.querySelector('footer.note-end')?.lastElementChild?.className).toBe('note-source');
    expect(arts[0]!.querySelector('footer.note-end .note-keypoints')).not.toBeNull();
    // Default (no option) keeps rendering the source.
    expect(buildNoteArticle(notes[0]!, 'y').querySelector('.note-source')?.textContent).toBe('Source: NCERT Class 6');
  });

  it('a For-Mains section applies the same rule', () => {
    const mains = [src('m1', 'Laxmikanth'), src('m2', 'Laxmikanth')];
    const sec = buildMainsNotesSection(mains, 'mp')!;
    expect([...sec.querySelectorAll('.note-source')].map((p) => p.textContent)).toEqual(['Source: Laxmikanth']);
  });
});

describe('Learn Notes — real pages: no repeated Source, contents listed once', () => {
  const PAGES = ['ment-venn-nonverbal', 'pol-foreign-policy-ir', 'hist-ancient-early-vedic', 'ca-national'];

  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
    location.hash = '';
  });

  function open(id: string): HTMLElement {
    document.body.innerHTML = '';
    const root = document.createElement('div');
    document.body.appendChild(root);
    renderApp(root);
    openLearn(id, { from: 'topics' });
    return root;
  }

  it.each(PAGES)('%s: every distinct source shows, none is repeated back-to-back', (id) => {
    const root = open(id);
    const prelims = getSubtopic(id)!.notes.filter((n) => !isMainsNote(n));
    // Prelims sections only (the collapsed For-Mains block has its own run).
    const arts = [...root.querySelectorAll<HTMLElement>('.learn-notes-layout > .reading > article.note')];
    expect(arts).toHaveLength(prelims.length);
    const shown = arts.map((a) => a.querySelector('.note-end .note-source')?.textContent ?? null);
    const rendered = shown.filter((s): s is string => s !== null);
    // No rendered Source line repeats anywhere on the page (incl. For Mains).
    const all = [...root.querySelectorAll('.learn-notes-layout .note-source')].map((p) => p.textContent);
    expect(new Set(all).size, id).toBe(all.length);
    // Every distinct learner-facing source is still on the page.
    const expected = new Set(prelims.map((n) => buildNoteArticle(n, 'probe').querySelector('.note-source')?.textContent).filter(Boolean));
    expect(new Set(rendered)).toEqual(expected);
  });

  it.each(PAGES)('%s: contents has no duplicate anchors and no sub-entry restating its note', (id) => {
    const root = open(id);
    for (const nav of root.querySelectorAll<HTMLElement>('.learn-toc, .contents-sheet')) {
      const hrefs = [...nav.querySelectorAll<HTMLAnchorElement>('a.toc-link, a.toc-sublink')].map((a) => a.getAttribute('href')!);
      expect(new Set(hrefs).size, id).toBe(hrefs.length);
      for (const g of nav.querySelectorAll<HTMLElement>('li.toc-group')) {
        const parent = g.querySelector(':scope > a.toc-link')!.textContent!.trim().toLowerCase();
        const subs = [...g.querySelectorAll('a.toc-sublink')].map((a) => a.textContent!.trim().toLowerCase());
        expect(subs, `${id}: ${parent}`).not.toContain(parent);
        expect(new Set(subs).size, `${id}: ${parent}`).toBe(subs.length);
      }
      // Note titles are listed once each, and every entry resolves on the page.
      const titles = [...nav.querySelectorAll('a.toc-link')].map((a) => a.textContent);
      expect(new Set(titles).size, id).toBe(titles.length);
      for (const h of hrefs) expect(document.getElementById(h.slice(1)), h).not.toBeNull();
    }
  });

  it('noteSections skips a body heading that restates the title but keeps later ids aligned', () => {
    const n = note({ title: 'Mirror images', body: '### Mirror images\n\nIntro.\n\n### Water images\n\nText.' });
    const secs = noteSections(n, 'm');
    expect(secs).toEqual([{ anchor: noteSectionId('m', 1), title: 'Water images' }]);
    const art = buildNoteArticle(n, 'm');
    expect(art.querySelector(`#${secs[0]!.anchor}`)?.textContent).toBe('Water images');
  });

  it('no real note lists its own title (or one anchor twice) among its sections', () => {
    let checked = 0;
    for (const { bank } of getBanks('notes')) {
      if (bank.kind !== 'notes') continue;
      for (const n of bank.items) {
        const secs = noteSections(n, 'a');
        const t = n.title.trim().toLowerCase();
        expect(secs.map((s) => s.title.trim().toLowerCase()), n.id).not.toContain(t);
        expect(new Set(secs.map((s) => s.anchor)).size, n.id).toBe(secs.length);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
