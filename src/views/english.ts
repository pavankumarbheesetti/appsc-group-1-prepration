/**
 * English QUALIFYING module (route `#/english`, under the Languages hub) — the
 * pillar that helps a learner clear the qualifying English paper: practise
 * grammar, learn the writing formats (with practice + self-evaluation) and work
 * through reading comprehension.
 *
 * The view is a tabbed hub with four sections:
 *   - OVERVIEW    — the paper's question types + marks and the qualifying note.
 *   - GRAMMAR     — a quiz over {@link grammarMCQs} via the shared quiz runner,
 *                   with an optional filter by grammar area; shows the score.
 *   - WRITING     — a card per writing format (structure + techniques + model),
 *                   each with a practice textarea (live word count) and a
 *                   self-eval CHECKLIST persisted to `state.english`.
 *   - READING     — a passage plus its questions via the quiz runner.
 *
 * All grammar/RC data is MCQItem-shaped and passed DIRECTLY to `mountQuiz`
 * (the same runner used by Drill/Notebook) — it is NOT registered in the
 * content manifest. Writing helpers/persistence are the pure `lib/english`
 * functions + the store's English accessors. Everything renders with the shared
 * DOM helpers/components so it stays offline-safe and visually consistent.
 */
import type { MCQItem } from '../content/types';
import {
  paperOverview,
  WRITING_FORMATS,
  GRAMMAR_AREAS,
  grammarMCQs,
  readingComprehension,
  type WritingFormat,
  type ReadingPassage,
} from '../content/english-qualifying';
import { checklistTally, countWords, filterByArea } from '../lib/english';
import { navigate } from '../router/router';
import {
  getEnglishEntry,
  saveEnglishDraft,
  saveEnglishChecks,
  clearEnglish,
} from '../state/store';
import { mountQuiz } from './quiz';
import { el, mount, renderMarkdown, type Child } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';
import { icon } from './components/icon';
import { progressBar } from './components/progress';

/* -------------------------------------------------------------------------- */
/* Entry / tabs                                                                */
/* -------------------------------------------------------------------------- */

/** The hub's top-level tabs. */
type EnglishTab = 'overview' | 'grammar' | 'writing' | 'reading';

/** A pending tab to open, set by {@link openEnglish}. @internal */
let pendingTab: EnglishTab | undefined;

/** Open the English module, optionally on a specific tab. */
export function openEnglish(tab?: EnglishTab): void {
  pendingTab = tab;
  navigate('/english');
}

/** Render the English module into `root`. */
export function render(root: HTMLElement): void {
  let activeTab: EnglishTab = pendingTab ?? 'overview';
  pendingTab = undefined;

  const draw = (): void => {
    let panel: HTMLElement;
    switch (activeTab) {
      case 'overview':
        panel = buildOverview();
        break;
      case 'grammar':
        panel = buildGrammar();
        break;
      case 'writing':
        panel = buildWriting();
        break;
      case 'reading':
        panel = buildReading();
        break;
    }
    mount(
      root,
      el('div', { class: 'eng-hub' }, [
        buildIntro(),
        buildTabs(activeTab, (t) => {
          activeTab = t;
          draw();
        }),
        panel,
      ]),
    );
  };
  draw();
}

/** The hub header/intro. @internal */
function buildIntro(): HTMLElement {
  return el('header', { class: 'mains-intro card' }, [
    el('span', { class: 'empty-icon' }, [icon('book-open', 26)]),
    el('div', {}, [
      el('h2', { class: 'card-title', text: 'Qualifying English' }),
      el('p', {
        class: 'section-lead',
        text: 'Clear the qualifying English paper with confidence — drill grammar, master each writing format with practice and self-evaluation, and sharpen reading comprehension.',
      }),
    ]),
  ]);
}

/** The hub tab bar (reuses the Learn/Mains tab styling). @internal */
function buildTabs(active: EnglishTab, select: (t: EnglishTab) => void): HTMLElement {
  const tabs: Array<{ id: EnglishTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'grammar', label: 'Grammar practice' },
    { id: 'writing', label: 'Writing skills' },
    { id: 'reading', label: 'Reading' },
  ];
  return el(
    'div',
    { class: 'learn-tabs', attrs: { role: 'tablist', 'aria-label': 'English sections' } },
    tabs.map((t) =>
      el('button', {
        class: active === t.id ? 'learn-tab is-active' : 'learn-tab',
        type: 'button',
        attrs: { role: 'tab', 'aria-selected': String(active === t.id) },
        onClick: () => select(t.id),
      }, [el('span', { text: t.label })]),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

/** Build the paper-overview panel: question types + marks + qualifying note. @internal */
function buildOverview(): HTMLElement {
  const rows = el('table', { class: 'mains-budget eng-overview-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Question type' }),
        el('th', { text: 'Marks' }),
        el('th', { text: 'What it tests' }),
      ]),
    ]),
    el('tbody', {}, paperOverview.questionTypes.map((q) =>
      el('tr', {}, [
        el('td', { text: q.name }),
        el('td', { class: 'tnum', text: String(q.marks) }),
        el('td', { text: q.note }),
      ]),
    )),
  ]);

  const stat = (label: string, value: string): HTMLElement =>
    el('span', { class: 'mains-stat' }, [
      el('strong', { class: 'tnum', text: value }),
      el('span', { text: label }),
    ]);
  const stats = el('div', { class: 'mains-stats' }, [
    stat('total marks', String(paperOverview.totalMarks)),
    stat('nature', 'Qualifying'),
    stat('standard', 'SSC'),
  ]);

  const note = el('aside', { class: 'tel-explainer', attrs: { 'aria-label': 'Qualifying nature' } }, [
    el('p', { class: 'tel-explainer-title' }, [icon('target', 16), el('span', { text: 'Qualifying paper' })]),
    el('p', { class: 'tel-explainer-body', text: paperOverview.qualifyingNote }),
  ]);

  return el('div', { class: 'eng-overview learn-panel', attrs: { role: 'tabpanel' } }, [
    card({ title: 'The qualifying English paper', class: 'eng-overview-card' }, [
      el('p', { class: 'section-lead', text: `${paperOverview.standard} · total ${paperOverview.totalMarks} marks · qualifying in nature.` }),
      stats,
      rows,
      note,
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Grammar practice (quiz runner)                                              */
/* -------------------------------------------------------------------------- */

/** Build the grammar-practice panel: area filter → quiz runner → score. @internal */
function buildGrammar(): HTMLElement {
  const panel = el('div', { class: 'eng-grammar learn-panel', attrs: { role: 'tabpanel' } });
  let areaTag = ''; // '' = all areas

  const quizHost = el('div', { class: 'eng-quiz-host' });

  // Build the area filter (only areas that actually have questions).
  const areasWithItems = GRAMMAR_AREAS.filter((a) => grammarMCQs.some((q) => q.tags?.includes(a.tag)));
  const areaSel = el('select', { ariaLabel: 'Filter grammar questions by area' }, [
    el('option', { value: '', text: `All areas (${grammarMCQs.length})` }),
    ...areasWithItems.map((a) => {
      const n = filterByArea(grammarMCQs, a.tag).length;
      return el('option', { value: a.tag, text: `${a.label} (${n})` });
    }),
  ]) as HTMLSelectElement;

  const startBtn = button({
    label: 'Start practice',
    variant: 'primary',
    iconName: 'arrow-right',
    onClick: () => runGrammar(quizHost, areaTag),
  });

  areaSel.addEventListener('change', () => {
    areaTag = areaSel.value;
  });

  const setup = card({ class: 'eng-quiz-setup' }, [
    el('h3', { class: 'card-title', text: 'Grammar practice' }),
    el('p', { class: 'section-lead', text: 'Answer one question at a time and get instant feedback with a short explanation. Filter by an area to focus your practice.' }),
    el('div', { class: 'filter-bar' }, [
      el('label', { class: 'field field-row' }, [
        el('span', { class: 'filter-label', text: 'Area' }),
        areaSel,
      ]),
      startBtn,
    ]),
  ]);

  panel.append(setup, quizHost);
  return panel;
}

/** Mount the grammar quiz for `areaTag` into `host`, wiring a results screen. @internal */
function runGrammar(host: HTMLElement, areaTag: string): void {
  startQuiz(host, filterByArea(grammarMCQs, areaTag), 'grammar questions');
}

/* -------------------------------------------------------------------------- */
/* Shared quiz + results helper                                                */
/* -------------------------------------------------------------------------- */

/**
 * Mount `items` in the shared quiz runner into `host`; on completion swap in a
 * results card (score + accuracy) with a "Practise again" button that re-runs
 * the same set. Self-restarting so both grammar and reading reuse it. @internal
 */
function startQuiz(host: HTMLElement, items: readonly MCQItem[], noun: string): void {
  if (items.length === 0) {
    mount(host, el('div', { class: 'empty-state' }, [
      el('span', { class: 'empty-icon' }, [icon('book-open', 24)]),
      el('h3', { text: `No ${noun} here yet` }),
      el('p', { text: 'Try a different selection.' }),
    ]));
    return;
  }
  mountQuiz(host, items, (summary) => {
    const tone = summary.accuracy >= 0.8 ? 'ok' : summary.accuracy >= 0.5 ? 'warn' : 'danger';
    mount(
      host,
      card({ class: 'eng-results' }, [
        el('h3', { class: 'card-title', text: 'Practice complete' }),
        el('div', { class: 'eng-results-score' }, [
          el('span', { class: 'eng-results-num tnum', text: `${summary.correct}/${summary.total}` }),
          chip({ text: `${Math.round(summary.accuracy * 100)}% correct`, tone, iconName: 'check' }),
        ]),
        progressBar({
          value: summary.total === 0 ? 0 : summary.correct / summary.total,
          label: 'Score',
          caption: `${summary.correct}/${summary.total}`,
          success: summary.total > 0 && summary.correct === summary.total,
        }),
        el('div', { class: 'eng-results-actions' }, [
          button({ label: 'Practise again', variant: 'primary', iconName: 'revise', onClick: () => startQuiz(host, items, noun) }),
        ]),
      ]),
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Writing skills (guide + practice + self-eval checklist)                     */
/* -------------------------------------------------------------------------- */

/** Build the writing-skills panel: a card per writing format. @internal */
function buildWriting(): HTMLElement {
  const panel = el('div', { class: 'eng-writing learn-panel', attrs: { role: 'tabpanel' } }, [
    el('p', { class: 'section-lead eng-writing-lead', text: 'Learn each format\u2019s structure and techniques, study the model, then practise and score yourself against the checklist. Your drafts and ticks are saved automatically.' }),
  ]);
  for (const fmt of WRITING_FORMATS) panel.append(buildFormatCard(fmt));
  return panel;
}

/** Build one writing-format card. @internal */
function buildFormatCard(fmt: WritingFormat): HTMLElement {
  const head = el('div', { class: 'eng-fmt-head' }, [
    el('h3', { class: 'card-title', text: fmt.name }),
    chip({ text: fmt.wordLimit, tone: 'muted' }),
  ]);
  const when = el('p', { class: 'section-lead', text: fmt.whenUsed });

  const structure = listBlock('Structure', 'syllabus', fmt.structure, true);
  const techniques = listBlock('Techniques', 'target', fmt.techniques, false);

  const model = el('div', { class: 'eng-fmt-model' }, [
    el('p', { class: 'note-keypoints-title' }, [icon('book-open', 15), el('span', { text: 'Model' })]),
    el('div', { class: 'eng-model-body note-body' }, renderMarkdown(fmt.model)),
  ]);

  return card({ class: 'eng-fmt' }, [
    head,
    when,
    el('div', { class: 'eng-fmt-grid' }, [structure, techniques]),
    model,
    buildPractice(fmt),
    buildChecklist(fmt),
  ]);
}

/** A titled ordered/unordered list block. @internal */
function listBlock(title: string, iconName: 'syllabus' | 'target', items: string[], ordered: boolean): HTMLElement {
  const list = ordered
    ? el('ol', { class: 'eng-fmt-steps' }, items.map((s) => el('li', { text: s })))
    : el('ul', { class: 'mains-tech-list' }, items.map((s) => el('li', { text: s })));
  return el('div', { class: 'eng-fmt-block' }, [
    el('h4', {}, [icon(iconName, 15), el('span', { text: title })]),
    list,
  ]);
}

/** Build the practice textarea with a live word count (persisted draft). @internal */
function buildPractice(fmt: WritingFormat): HTMLElement {
  const saved = getEnglishEntry(fmt.key);

  const textarea = el('textarea', {
    class: 'mains-textarea',
    ariaLabel: `Practise your ${fmt.name}`,
    attrs: { rows: '8', placeholder: `Write your ${fmt.name.toLowerCase()} here\u2026` },
  }) as HTMLTextAreaElement;
  textarea.value = saved?.draft ?? '';

  const countEl = el('span', { class: 'tnum', text: `${countWords(textarea.value)} words` });
  const status = el('span', { class: 'mains-save-status', attrs: { role: 'status', 'aria-live': 'polite' } });

  textarea.addEventListener('input', () => {
    countEl.textContent = `${countWords(textarea.value)} words`;
    saveEnglishDraft(fmt.key, textarea.value);
    status.textContent = '';
  });

  const saveBtn = button({
    label: 'Save draft',
    variant: 'primary',
    onClick: () => {
      saveEnglishDraft(fmt.key, textarea.value);
      status.textContent = 'Saved \u2713';
    },
  });

  return el('div', { class: 'eng-practice' }, [
    el('p', { class: 'note-keypoints-title' }, [icon('notes', 15), el('span', { text: 'Practise' })]),
    textarea,
    el('div', { class: 'mains-word-row' }, [
      countEl,
      el('span', { class: 'mains-budget-hint', text: `Suggested length: ${fmt.wordLimit}` }),
    ]),
    el('div', { class: 'mains-practice-actions' }, [saveBtn, status]),
  ]);
}

/** Build the self-eval checklist (persisted ticks + a live tally). @internal */
function buildChecklist(fmt: WritingFormat): HTMLElement {
  const saved = getEnglishEntry(fmt.key);
  // Seed ticks from saved (only when the length matches the current checklist).
  const checks: boolean[] =
    saved && saved.checks.length === fmt.checklist.length
      ? [...saved.checks]
      : fmt.checklist.map(() => false);

  const result = el('div', { class: 'eng-checklist-result' });

  const paint = (): void => {
    const tally = checklistTally(checks, fmt.checklist.length);
    mount(
      result,
      progressBar({
        value: tally.total === 0 ? 0 : tally.checked / tally.total,
        label: 'Self-evaluation',
        caption: `${tally.checked}/${tally.total}`,
        success: tally.complete,
      }),
    );
  };

  const rows = fmt.checklist.map((criterion, i) => {
    const box = el('input', {
      attrs: { type: 'checkbox', 'aria-label': criterion },
    }) as HTMLInputElement;
    box.checked = checks[i] === true;
    box.addEventListener('change', () => {
      checks[i] = box.checked;
      saveEnglishChecks(fmt.key, checks);
      paint();
    });
    return el('label', { class: 'eng-check-row' }, [box, el('span', { text: criterion })]);
  });

  const clearBtn = button({
    label: 'Reset checklist',
    variant: 'ghost',
    onClick: () => {
      for (let i = 0; i < checks.length; i += 1) checks[i] = false;
      rows.forEach((row) => {
        const box = row.querySelector('input');
        if (box) box.checked = false;
      });
      clearEnglish(fmt.key);
      paint();
    },
  });

  paint();

  return el('div', { class: 'eng-checklist' }, [
    el('p', { class: 'note-keypoints-title' }, [icon('check', 15), el('span', { text: 'Self-evaluation checklist' })]),
    el('div', { class: 'eng-check-list' }, rows),
    result,
    el('div', { class: 'eng-check-actions' }, [clearBtn]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Reading comprehension (passage + quiz runner)                               */
/* -------------------------------------------------------------------------- */

/** Build the reading panel: pick a passage, read it, then answer via the runner. @internal */
function buildReading(): HTMLElement {
  const panel = el('div', { class: 'eng-reading learn-panel', attrs: { role: 'tabpanel' } });
  let activeId = readingComprehension[0]?.id ?? '';

  const passageHost = el('div', { class: 'eng-passage-host' });

  const nav = el('nav', { class: 'eng-passage-nav', ariaLabel: 'Passages' }, readingComprehension.map((p) => {
    const btn = el('button', {
      class: p.id === activeId ? 'eng-passage-btn is-active' : 'eng-passage-btn',
      type: 'button',
      attrs: { 'aria-current': p.id === activeId ? 'true' : 'false' },
      onClick: () => {
        activeId = p.id;
        for (const b of nav.querySelectorAll('.eng-passage-btn')) {
          const on = b.getAttribute('data-id') === p.id;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-current', String(on));
        }
        drawPassage();
      },
    }, [el('span', { text: p.title })]);
    btn.setAttribute('data-id', p.id);
    return btn;
  }));

  const drawPassage = (): void => {
    const passage = readingComprehension.find((p) => p.id === activeId);
    if (!passage) {
      mount(passageHost, el('p', { class: 'section-lead', text: 'No passage selected.' }));
      return;
    }
    mount(passageHost, buildPassage(passage));
  };

  panel.append(
    el('p', { class: 'section-lead', text: 'Read the passage carefully, then answer the comprehension questions. Feedback and a short explanation follow each answer.' }),
    nav,
    passageHost,
  );
  drawPassage();
  return panel;
}

/** Build one passage: the reading text + a start-quiz control + quiz host. @internal */
function buildPassage(passage: ReadingPassage): HTMLElement {
  const quizHost = el('div', { class: 'eng-quiz-host' });

  const paras: Child[] = passage.text.split('\n\n').map((t) => el('p', { text: t }));
  const startBtn = button({
    label: `Answer ${passage.questions.length} questions`,
    variant: 'primary',
    iconName: 'arrow-right',
    onClick: () => startQuiz(quizHost, passage.questions, 'questions'),
  });

  return el('div', { class: 'eng-passage' }, [
    card({ class: 'eng-passage-card' }, [
      el('h3', { class: 'card-title', text: passage.title }),
      el('div', { class: 'eng-passage-text reading' }, paras),
      el('div', { class: 'eng-passage-actions' }, [startBtn]),
    ]),
    quizHost,
  ]);
}
