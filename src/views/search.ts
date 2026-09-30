/**
 * Global search / jump-to-question — a Cmd/Ctrl-K overlay.
 *
 * Indexes subtopics (name), notes (title), and MCQs (question text) from the
 * loader into a flat {@link SearchDoc} list, then ranks + groups matches with
 * the PURE {@link searchDocs} helper (unit-tested separately). Selecting:
 *   - a subtopic → opens its Learn workspace,
 *   - a note     → opens the Learn workspace scrolled to that note,
 *   - an MCQ     → opens a focused single-question drill (`#/q/<id>`).
 *
 * Fully keyboard-navigable: ↑/↓ move the highlight across the flat result list,
 * Enter activates, Esc closes. Opening is idempotent (a second toggle closes).
 */
import { getSubtopic, getSubtopics } from '../content/loader';
import { navigate } from '../router/router';
import { searchDocs, totalResults, type GroupedResults, type SearchDoc } from '../lib/search';
import { el } from './dom';
import { icon } from './components/icon';
import { openLearn } from './learn';
import { openDialog, type DialogController } from './dialog';

/** The mounted overlay element, or null when closed. */
let overlay: HTMLElement | null = null;
/** The active dialog controller (focus-trap + global ESC + return-focus). */
let dialog: DialogController | null = null;

/** Build the flat search index from the taxonomy + its discovered content. */
function buildDocs(): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const sub of getSubtopics()) {
    docs.push({ kind: 'subtopic', id: sub.id, title: sub.name, subtopicId: sub.id, subtitle: 'Subtopic' });
    const view = getSubtopic(sub.id);
    if (!view) continue;
    for (const note of view.notes) {
      docs.push({ kind: 'note', id: note.id, title: note.title, subtopicId: sub.id, subtitle: sub.name });
    }
    for (const mcq of view.mcqs) {
      docs.push({ kind: 'mcq', id: mcq.id, title: mcq.question, subtopicId: sub.id, subtitle: sub.name });
    }
  }
  return docs;
}

/** Act on a selected result, then close the overlay. @internal */
function activate(doc: SearchDoc): void {
  closeSearch();
  if (doc.kind === 'subtopic') {
    openLearn(doc.id);
  } else if (doc.kind === 'note') {
    openLearn(doc.subtopicId ?? '', { tab: 'notes', noteId: doc.id });
  } else {
    navigate(`/q/${doc.id}`);
  }
}

/** Close and unmount the overlay (restoring focus to the opener). */
export function closeSearch(): void {
  if (dialog) {
    // The controller runs teardown() (via onClose) and restores focus.
    dialog.close();
    return;
  }
  teardown();
}

/** Remove the overlay DOM and reset module state. @internal */
function teardown(): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  dialog = null;
}

/** Toggle the search overlay: open when closed, close when already open. */
export function openSearch(): void {
  if (overlay) {
    closeSearch();
    return;
  }
  const docs = buildDocs();
  /** Flat, ordered list of currently-shown results (for arrow navigation). */
  let flat: SearchDoc[] = [];
  let selected = 0;

  const input = el('input', {
    class: 'search-input',
    type: 'search',
    ariaLabel: 'Search subtopics, notes and questions',
    attrs: { placeholder: 'Search subtopics, notes, questions…', autocomplete: 'off', spellcheck: 'false' },
  }) as HTMLInputElement;

  const results = el('div', { class: 'search-results', attrs: { role: 'listbox', 'aria-label': 'Search results' } });

  const iconFor = (kind: SearchDoc['kind']): ReturnType<typeof icon> =>
    icon(kind === 'subtopic' ? 'syllabus' : kind === 'note' ? 'notes' : 'drill', 16);

  const groupLabel: Record<keyof GroupedResults, string> = {
    subtopics: 'Subtopics',
    notes: 'Notes',
    mcqs: 'Questions',
  };

  /** Re-run the search and rebuild the results list. */
  const update = (): void => {
    const grouped = searchDocs(input.value, docs);
    flat = [...grouped.subtopics, ...grouped.notes, ...grouped.mcqs];
    selected = 0;
    results.replaceChildren();

    if (input.value.trim() === '') {
      results.append(el('p', { class: 'search-hint', text: 'Type to search subtopics, notes and questions. ↑↓ to navigate, Enter to open, Esc to close.' }));
      return;
    }
    if (totalResults(grouped) === 0) {
      results.append(el('p', { class: 'search-hint', text: `No matches for “${input.value.trim()}”.` }));
      return;
    }

    let flatIndex = 0;
    for (const key of ['subtopics', 'notes', 'mcqs'] as const) {
      const group = grouped[key];
      if (group.length === 0) continue;
      results.append(el('p', { class: 'search-group', text: groupLabel[key] }));
      for (const doc of group) {
        const myIndex = flatIndex;
        const row = el('button', {
          class: 'search-item',
          type: 'button',
          attrs: { role: 'option', 'data-index': String(myIndex) },
          onClick: () => activate(doc),
        }, [
          el('span', { class: 'search-item-icon' }, [iconFor(doc.kind)]),
          el('span', { class: 'search-item-body' }, [
            el('span', { class: 'search-item-title', text: doc.title }),
            doc.subtitle ? el('span', { class: 'search-item-sub', text: doc.subtitle }) : null,
          ]),
        ]);
        row.addEventListener('mousemove', () => {
          if (selected !== myIndex) {
            selected = myIndex;
            paintSelection();
          }
        });
        results.append(row);
        flatIndex += 1;
      }
    }
    paintSelection();
  };

  /** Highlight the currently-selected row and scroll it into view. */
  const paintSelection = (): void => {
    const rows = results.querySelectorAll<HTMLElement>('.search-item');
    rows.forEach((row) => {
      const idx = Number(row.dataset.index);
      const on = idx === selected;
      row.classList.toggle('is-selected', on);
      row.setAttribute('aria-selected', String(on));
      if (on) row.scrollIntoView({ block: 'nearest' });
    });
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flat.length > 0) {
        selected = (selected + 1) % flat.length;
        paintSelection();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length > 0) {
        selected = (selected - 1 + flat.length) % flat.length;
        paintSelection();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const doc = flat[selected];
      if (doc) activate(doc);
    }
  };

  input.addEventListener('input', update);
  input.addEventListener('keydown', onKey);

  const panel = el('div', { class: 'search-panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Global search' } }, [
    el('div', { class: 'search-field' }, [icon('search', 18), input]),
    results,
  ]);

  const backdrop = el('div', { class: 'search-overlay' }, [panel]);

  overlay = backdrop;
  document.body.append(backdrop);
  update();
  // Trap focus, close on global ESC / scrim click, and return focus to whatever
  // opened search (the toolbar button or the Cmd/Ctrl-K origin). The search
  // input is the natural initial focus so typing works immediately.
  dialog = openDialog({
    panel,
    scrim: backdrop,
    initialFocus: input,
    onClose: teardown,
  });
}
