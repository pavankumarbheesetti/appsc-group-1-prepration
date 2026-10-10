/**
 * Notes view — a clean reading experience.
 *
 * A sticky table-of-contents (desktop; wraps inline on mobile) links to each
 * note, and note bodies are rendered with the safe {@link renderMarkdown}
 * helper (real DOM nodes only — never innerHTML) at a comfortable measure.
 */
import { getBanks } from '../content/loader';
import { SUBJECTS, type Figure, type NoteItem, type SubjectCode } from '../content/types';
import { resolveImage } from '../content/assets';
import { buildClozeCards, buildFlashcards, isMainsNote } from '../engine/flashcards';
import { newCard, review, type Grade } from '../engine/spaced-repetition';
import { updateState } from '../state/store';
import { el, mount, renderMarkdown, type Child } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { icon } from './components/icon';

/** A note paired with a stable anchor id for TOC linking. @internal */
interface TocEntry {
  anchor: string;
  title: string;
  subject: SubjectCode;
  note: NoteItem;
}

/**
 * Render a single figure as a `<figure>`/`<figcaption>`.
 *
 * The `src` is an image KEY resolved to an inlined URL; an UNKNOWN key resolves
 * to `undefined`, in which case we render nothing (graceful degradation — never
 * a broken image). Images are lazy + async-decoded and always carry alt text.
 * @internal
 */
function renderFigure(fig: Figure): HTMLElement | null {
  const url = resolveImage(fig.src);
  if (url === undefined) return null; // unknown key → render nothing
  // Distinguish vector diagrams from raster photos so CSS can `object-fit`
  // sensibly: rasters COVER the reserved box (no CLS, no distortion), while
  // SVG diagrams CONTAIN it so they are never cropped.
  const isSvg = /image\/svg/.test(url) || /\.svg(?:[?#]|$)/.test(url);
  const img = el('img', {
    class: isSvg ? 'note-figure-img is-svg' : 'note-figure-img',
    attrs: { src: url, alt: fig.alt, loading: 'lazy', decoding: 'async' },
  });
  const kids: Child[] = [img];
  if (fig.caption) kids.push(el('figcaption', { class: 'note-figcaption', text: fig.caption }));
  return el('figure', { class: 'note-figure' }, kids);
}

/** Ids of every SR card this note seeds (key-point + cloze). @internal */
function noteCardIds(note: NoteItem): string[] {
  return [
    ...buildFlashcards([note]).map((c) => c.id),
    ...buildClozeCards([note]).map((c) => c.id),
  ];
}

/**
 * Seed this note's recall cards into the flashcards SR map with `grade`.
 * "Got it" (correct) promotes them so they resurface later; "Review" (wrong)
 * keeps them due now so they come back soon. Cards not yet seen are created on
 * first sighting. @internal
 */
function seedRecall(note: NoteItem, grade: Grade): void {
  const ids = noteCardIds(note);
  if (ids.length === 0) return;
  const now = Date.now();
  updateState((s) => {
    for (const id of ids) {
      s.flashcards[id] = review(s.flashcards[id] ?? newCard(id, now), grade, now);
    }
  });
}

/**
 * Render the "Must remember" key-points block WITH a "Test yourself" active-recall
 * control. Active recall beats re-reading: the control hides the points and asks
 * the learner to recall them first, then Reveal shows them back with an optional
 * self-rating that seeds this note's spaced-repetition cards. Fully keyboard
 * accessible; motion is governed globally by the reduced-motion rule. @internal
 */
function renderKeyPoints(note: NoteItem): HTMLElement {
  const points = note.keyPoints ?? [];
  const aside = el('aside', { class: 'note-keypoints', attrs: { 'aria-label': 'Must remember' } });

  const list = (): HTMLElement =>
    el('ul', { class: 'keypoint-list' }, points.map((p) => el('li', { text: p })));

  // A polite live region announces state changes (recall → revealed → rated).
  const body = el('div', { class: 'note-keypoints-body', attrs: { 'aria-live': 'polite' } });

  const testBtn = button({
    label: 'Test yourself',
    variant: 'ghost',
    iconName: 'sparkles',
    ariaLabel: `Test yourself on the key points for ${note.title}`,
    onClick: () => showPrompt(),
  });
  testBtn.setAttribute('aria-expanded', 'false');

  const header = el('div', { class: 'note-keypoints-head' }, [
    el('p', { class: 'note-keypoints-title' }, [icon('target', 16), el('span', { text: 'Must remember' })]),
    testBtn,
  ]);

  /** Idle: points visible, "Test yourself" offered. */
  const showIdle = (): void => {
    testBtn.setAttribute('aria-expanded', 'false');
    body.replaceChildren(list());
  };

  /** Recall mode: points hidden, learner recalls from memory, then reveals. */
  const showPrompt = (): void => {
    testBtn.setAttribute('aria-expanded', 'true');
    body.replaceChildren(
      el('div', { class: 'note-recall' }, [
        el('p', { class: 'note-recall-prompt', text: `Recall the key points for “${note.title}”, then reveal.` }),
        button({ label: 'Reveal', variant: 'primary', iconName: 'arrow-right', onClick: () => showRevealed() }),
      ]),
    );
  };

  /** Revealed: points shown again with an optional self-rating that seeds SR. */
  const showRevealed = (): void => {
    const rate = (grade: Grade): void => {
      seedRecall(note, grade);
      showIdle();
    };
    body.replaceChildren(
      list(),
      el('div', { class: 'note-recall-rate' }, [
        el('span', { class: 'note-recall-rate-label', text: 'How did you do?' }),
        button({ label: 'Got it', variant: 'primary', iconName: 'check', onClick: () => rate('correct') }),
        button({ label: 'Review', variant: 'secondary', onClick: () => rate('wrong') }),
      ]),
    );
  };

  showIdle();
  aside.append(header, body);
  return aside;
}

/**
 * Render the OPTIONAL "Memory hook" as a collapsed disclosure — a minor,
 * secondary aid. Evidence favours active recall over mnemonics, so the authored
 * hook is preserved but tucked into a `<details>` that stays closed by default
 * rather than shown as a prominent callout. @internal
 */
function renderMnemonic(mnemonic: string): HTMLElement {
  const details = el('details', { class: 'note-mnemonic' }, [
    el('summary', { class: 'note-mnemonic-summary' }, [
      el('span', { class: 'note-mnemonic-label', text: 'Memory hook (optional)' }),
    ]),
    el('p', { class: 'note-mnemonic-text', text: mnemonic }),
  ]);
  return details;
}

/** Build one note article with body + optional figures/retention blocks. */
export function buildNoteArticle(note: NoteItem, anchorId: string): HTMLElement {
  const kids: Child[] = [el('h3', { class: 'note-title', text: note.title })];
  // Lead figure sits above the body; extra figures follow it.
  if (note.figure) kids.push(renderFigure(note.figure));
  kids.push(el('div', { class: 'note-body' }, renderMarkdown(note.body)));
  if (note.figures) for (const fig of note.figures) kids.push(renderFigure(fig));
  if (note.keyPoints && note.keyPoints.length > 0) kids.push(renderKeyPoints(note));
  if (note.mnemonic) kids.push(renderMnemonic(note.mnemonic));
  if (note.source) kids.push(el('p', { class: 'note-source', text: `Source: ${note.source}` }));
  return el('article', { class: 'note card', attrs: { id: anchorId } }, kids);
}

/**
 * The collapsed "For Mains" section rendered AFTER all Prelims notes (STANDARDS
 * §8a). Mains-tagged notes carry analytical MAINS dimensions, not Prelims facts,
 * so they are kept out of the Prelims reading order and tucked into a
 * `<details>` (closed by default) with a short explainer: read them in the
 * December revision, not during the first-pass Prelims study. Returns `null`
 * when there are no mains notes, so callers can append it unconditionally.
 */
export function buildMainsNotesSection(notes: readonly NoteItem[], anchorPrefix: string): HTMLElement | null {
  if (notes.length === 0) return null;
  const articles = notes.map((n, i) => buildNoteArticle(n, `${anchorPrefix}-${n.id}-${i}`));
  return el('details', { class: 'notes-for-mains' }, [
    el('summary', { class: 'notes-for-mains-summary' }, [
      icon('notebook', 16),
      el('span', { text: `For Mains (read in the December revision) \u00b7 ${notes.length}` }),
    ]),
    el('p', { class: 'section-lead notes-for-mains-lead', text: 'These are the analytical Mains angles for topics you studied for Prelims. Skip them on your first pass \u2014 read them in the December revision cycle, when you revisit each topic for Mains. They are not drilled as flashcards.' }),
    el('div', { class: 'reading' }, articles),
  ]);
}

/** Split notes into Prelims (reading order) and For-Mains (collapsed, last). @internal */
function partitionMainsNotes(notes: readonly NoteItem[]): { prelims: NoteItem[]; mains: NoteItem[] } {
  const prelims: NoteItem[] = [];
  const mains: NoteItem[] = [];
  for (const n of notes) (isMainsNote(n) ? mains : prelims).push(n);
  return { prelims, mains };
}

/** Render the notes view into `root`. */
export function render(root: HTMLElement): void {
  // Group notes: subject → topic → items, and collect a flat TOC. Mains-tagged
  // notes are held OUT of the Prelims reading order + TOC and rendered LAST in
  // one collapsed "For Mains" section (STANDARDS §8a).
  const bySubject = new Map<SubjectCode, Map<string, NoteItem[]>>();
  const mainsNotes: NoteItem[] = [];
  const toc: TocEntry[] = [];
  let n = 0;
  for (const { bank } of getBanks('notes')) {
    if (bank.kind !== 'notes') continue;
    const { prelims, mains } = partitionMainsNotes(bank.items);
    mainsNotes.push(...mains);
    if (prelims.length === 0) continue;
    const topics = bySubject.get(bank.subjectCode) ?? new Map<string, NoteItem[]>();
    const list = topics.get(bank.topic) ?? [];
    list.push(...prelims);
    topics.set(bank.topic, list);
    bySubject.set(bank.subjectCode, topics);
    for (const note of prelims) {
      n += 1;
      toc.push({ anchor: `note-${n}`, title: note.title, subject: bank.subjectCode, note });
    }
  }

  if (toc.length === 0 && mainsNotes.length === 0) {
    mount(
      root,
      card({ title: 'Notes' }, [
        el('div', { class: 'empty-state' }, [
          el('span', { class: 'empty-icon' }, [icon('book-open', 26)]),
          el('h3', { text: 'No notes yet' }),
          el('p', { text: 'Study notes will appear here once content banks are added.' }),
        ]),
      ]),
    );
    return;
  }

  // Reading column: subject → topic → notes, each note anchored for the TOC.
  const reading = el('div', { class: 'reading' });
  let idx = 0;
  for (const [subject, topics] of bySubject) {
    reading.appendChild(el('h2', { class: 'section-title', text: SUBJECTS[subject] }));
    for (const [topic, items] of topics) {
      reading.appendChild(el('h3', { class: 'topic', text: topic }));
      for (const note of items) {
        idx += 1;
        reading.appendChild(buildNoteArticle(note, `note-${idx}`));
      }
    }
  }

  // The collapsed "For Mains" section always comes LAST (STANDARDS §8a).
  const mainsSection = buildMainsNotesSection(mainsNotes, 'note-mains');
  if (mainsSection) reading.appendChild(mainsSection);

  const tocNav = el('nav', { class: 'toc', ariaLabel: 'Notes contents' }, [
    el('span', { class: 'toc-eyebrow', text: 'Contents' }),
    ...toc.map((t) =>
      el('button', {
        class: 'toc-link',
        type: 'button',
        text: t.title,
        onClick: () => {
          document.getElementById(t.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      }),
    ),
  ]);

  mount(root, el('div', { class: 'notes-layout' }, [tocNav, reading]));
}
