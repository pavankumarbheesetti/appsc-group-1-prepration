/**
 * Mains writing-skill TRAINER — the pillar that teaches learners how to WRITE
 * descriptive answers, not just what to memorise.
 *
 * Route `#/mains` is a hub with two tabs:
 *   - "How to write"    — the static {@link MAINS_GUIDE} pedagogy (paper
 *                         overview, directive frameworks, structure,
 *                         presentation & budgeting, do's & don'ts) rendered as
 *                         scannable accordion sections.
 *   - "Question library"— every Mains question across all subtopics (from the
 *                         loader), filterable by subtopic and by paper; each
 *                         row opens the per-question WRITING WORKSPACE.
 *
 * Route `#/mains/:id` is the WRITING WORKSPACE for one question: it shows the
 * detected directive + its demand, a buildFramework() Intro/Body/Conclusion
 * scaffold, an annotated model answer, a persisted practice textarea with a
 * live word count + stopwatch, and a persisted self-eval rubric (scoreRubric).
 *
 * All writing helpers are the PURE functions in `src/lib/mains.ts`; persistence
 * goes through the store's Mains accessors. Everything renders with the shared
 * DOM helpers/components so it stays offline-safe and visually consistent.
 */
import { getBanks, getSubtopics } from '../content/loader';
import type { MainsItem, Paper } from '../content/types';
import {
  MAINS_OVERVIEW,
  DIRECTIVES,
  STRUCTURE_GUIDE,
  PRESENTATION_GUIDE,
  DOS_DONTS,
  RUBRIC,
} from '../content/mains-guide';
import { detectDirective, buildFramework, scoreRubric, countWords } from '../lib/mains';
import { navigate, routeParam } from '../router/router';
import {
  getMainsEntry,
  saveMainsDraft,
  saveMainsRubric,
  clearMains,
} from '../state/store';
import { el, mount, renderMarkdown, type Child } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';
import { icon } from './components/icon';
import { showToast } from './components/toast';

/* -------------------------------------------------------------------------- */
/* Shared data helpers                                                         */
/* -------------------------------------------------------------------------- */

/** A Mains question paired with its resolved subtopic label. */
interface LibraryEntry {
  item: MainsItem;
  subtopicId: string | undefined;
  subtopicName: string;
}

/** Map each `Paper` id to its short official code (e.g. `mains-2` → `Paper-II`). */
const PAPER_CODE: Partial<Record<Paper, string>> = (() => {
  const map: Partial<Record<Paper, string>> = {};
  for (const p of MAINS_OVERVIEW.papers) {
    if (!(p.paper in map)) map[p.paper] = p.code;
  }
  return map;
})();

/** A short, human paper label for chips/filters. */
function paperLabel(paper: Paper): string {
  return PAPER_CODE[paper] ?? paper.replace('mains-', 'Paper ');
}

/**
 * Collect EVERY Mains question across all banks (via the loader), resolving each
 * item's `subtopicId` to a taxonomy name. Deterministic order = bank discovery
 * order. Items without a subtopic are bucketed under "Ungrouped".
 */
function collectLibrary(): LibraryEntry[] {
  const nameById = new Map(getSubtopics().map((s) => [s.id, s.name] as const));
  const out: LibraryEntry[] = [];
  for (const loaded of getBanks('mains')) {
    if (loaded.bank.kind !== 'mains') continue; // narrow the union
    for (const item of loaded.bank.items) {
      const sid = item.subtopicId;
      out.push({
        item,
        subtopicId: sid,
        subtopicName: sid ? (nameById.get(sid) ?? sid) : 'Ungrouped',
      });
    }
  }
  return out;
}

/** Find one library entry by question id. */
function findEntry(id: string): LibraryEntry | undefined {
  return collectLibrary().find((e) => e.item.id === id);
}

/** The presentation budget row best matching a question's marks. @internal */
function budgetFor(marks: number | undefined): (typeof PRESENTATION_GUIDE.budget)[number] | undefined {
  if (marks === undefined) return undefined;
  const rows = PRESENTATION_GUIDE.budget;
  // Exact match, else the closest row by absolute mark distance.
  return (
    rows.find((r) => r.marks === marks) ??
    [...rows].sort((a, b) => Math.abs(a.marks - marks) - Math.abs(b.marks - marks))[0]
  );
}

/* -------------------------------------------------------------------------- */
/* Navigation helpers (used by this view and the Learn workspace)              */
/* -------------------------------------------------------------------------- */

/** A pending subtopic filter for the hub, set by {@link openMains}. @internal */
let pendingSubtopic: string | undefined;

/**
 * Open the Mains hub, optionally pre-filtering the Question library to one
 * subtopic. Used by the Learn workspace's "Practice mains" link.
 */
export function openMains(subtopicId?: string): void {
  pendingSubtopic = subtopicId;
  navigate('/mains');
}

/** Open the writing workspace for a specific Mains question. */
export function openMainsQuestion(id: string): void {
  navigate(`/mains/${id}`);
}

/* -------------------------------------------------------------------------- */
/* Hub view (#/mains)                                                          */
/* -------------------------------------------------------------------------- */

/** The hub's two top-level tabs. */
type HubTab = 'guide' | 'library';

/** Render the Mains hub into `root`. */
export function render(root: HTMLElement): void {
  // Consume any pending subtopic filter (one-shot) and, if present, jump
  // straight to the library tab so the learner lands on the filtered list.
  const initialSubtopic = pendingSubtopic;
  pendingSubtopic = undefined;
  let activeTab: HubTab = initialSubtopic ? 'library' : 'guide';

  const draw = (): void => {
    mount(
      root,
      el('div', { class: 'mains-hub' }, [
        buildHubIntro(),
        buildHubTabs(activeTab, (t) => {
          activeTab = t;
          draw();
        }),
        activeTab === 'guide'
          ? buildGuide()
          : buildLibrary(initialSubtopic),
      ]),
    );
  };
  draw();
}

/** The hub header/intro. @internal */
function buildHubIntro(): HTMLElement {
  return el('header', { class: 'mains-intro card' }, [
    el('span', { class: 'empty-icon' }, [icon('notes', 26)]),
    el('div', {}, [
      el('h2', { class: 'card-title', text: 'Mains answer writing' }),
      el('p', {
        class: 'section-lead',
        text: 'Learn HOW to write descriptive answers — decode the directive, build a structure, add substance, then practise on real questions and self-score against a rubric.',
      }),
    ]),
  ]);
}

/** The hub tab bar (reuses the Learn tab styling). @internal */
function buildHubTabs(active: HubTab, select: (t: HubTab) => void): HTMLElement {
  const tabs: Array<{ id: HubTab; label: string }> = [
    { id: 'guide', label: 'How to write' },
    { id: 'library', label: 'Question library' },
  ];
  return el(
    'div',
    { class: 'learn-tabs', attrs: { role: 'tablist', 'aria-label': 'Mains sections' } },
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
/* Part A — the "How to write" guide                                           */
/* -------------------------------------------------------------------------- */

/** Build the full guide as scannable accordion sections. @internal */
function buildGuide(): HTMLElement {
  return el('div', { class: 'mains-guide learn-panel', attrs: { role: 'tabpanel' } }, [
    accordion('Exam structure — the five papers', true, guideOverview()),
    accordion('Directive words — decode the command', false, guideDirectives()),
    accordion('Structure — intro, body, conclusion', false, guideStructure()),
    accordion('Presentation & time/word budget', false, guidePresentation()),
    accordion("Do's & don'ts", false, guideDosDonts()),
    accordion('Self-evaluation rubric', false, guideRubric()),
  ]);
}

/** A single `<details>` accordion section. @internal */
function accordion(title: string, open: boolean, body: Child): HTMLElement {
  const details = el('details', { class: 'mains-acc' }, [
    el('summary', { class: 'mains-acc-summary' }, [
      icon('chevron', 16),
      el('span', { text: title }),
    ]),
    el('div', { class: 'mains-acc-body' }, [body]),
  ]) as HTMLDetailsElement;
  if (open) details.open = true;
  return details;
}

/** Overview: the paper cards + scheme notes. @internal */
function guideOverview(): HTMLElement {
  const papers = el('div', { class: 'mains-papers' }, MAINS_OVERVIEW.papers.map((p) =>
    el('div', { class: 'mains-paper' }, [
      el('div', { class: 'mains-paper-head' }, [
        chip({ text: p.code, tone: p.qualifying ? 'muted' : 'accent' }),
        el('span', { class: 'mains-paper-marks tnum', text: `${p.marks} marks · ${p.durationMin} min` }),
      ]),
      el('h4', { class: 'mains-paper-title', text: p.title }),
      el('p', { class: 'mains-paper-scope', text: p.scope }),
    ]),
  ));
  const stat = (label: string, value: string): HTMLElement =>
    el('span', { class: 'mains-stat' }, [
      el('strong', { class: 'tnum', text: value }),
      el('span', { text: label }),
    ]);
  const stats = el('div', { class: 'mains-stats' }, [
    stat('total marks', String(MAINS_OVERVIEW.totalMarks)),
    stat('merit marks', String(MAINS_OVERVIEW.meritMarks)),
    stat('interview', String(MAINS_OVERVIEW.interviewMarks)),
  ]);
  const notes = el('ul', { class: 'mains-notes' }, MAINS_OVERVIEW.notes.map((n) => el('li', { text: n })));
  return el('div', {}, [stats, papers, notes]);
}

/** Directive-word frameworks. @internal */
function guideDirectives(): HTMLElement {
  return el('div', { class: 'mains-directives' }, DIRECTIVES.map((d) =>
    el('div', { class: 'mains-directive' }, [
      el('div', { class: 'mains-directive-head' }, [
        chip({ text: d.keyword, tone: 'accent' }),
      ]),
      el('p', { class: 'mains-directive-demand', text: d.whatItDemands }),
      el('dl', { class: 'mains-skeleton' }, [
        el('dt', { text: 'Intro' }), el('dd', { text: d.skeleton.intro }),
        el('dt', { text: 'Body' }), el('dd', { text: d.skeleton.body }),
        el('dt', { text: 'Conclusion' }), el('dd', { text: d.skeleton.conclusion }),
      ]),
    ]),
  ));
}

/** Structure guide — intro/body/conclusion technique menus. @internal */
function guideStructure(): HTMLElement {
  const techList = (title: string, techs: { name: string; how: string }[]): HTMLElement =>
    el('div', { class: 'mains-tech-group' }, [
      el('h4', { text: title }),
      el('ul', { class: 'mains-tech-list' }, techs.map((t) =>
        el('li', {}, [el('strong', { text: `${t.name}: ` }), el('span', { text: t.how })]),
      )),
    ]);
  const lenses = el('div', { class: 'mains-tech-group' }, [
    el('h4', { text: 'Multi-dimensional lenses' }),
    el('div', { class: 'mains-lenses' }, STRUCTURE_GUIDE.body.lenses.map((l) => chip({ text: l, tone: 'muted' }))),
  ]);
  return el('div', {}, [
    techList('Introduction techniques', STRUCTURE_GUIDE.introduction),
    techList('Body approaches', STRUCTURE_GUIDE.body.approaches),
    lenses,
    techList('Add substance', STRUCTURE_GUIDE.body.substance),
    techList('Conclusion techniques', STRUCTURE_GUIDE.conclusion),
  ]);
}

/** Presentation techniques + the marks→words/minutes budget table. @internal */
function guidePresentation(): HTMLElement {
  const techs = el('ul', { class: 'mains-tech-list' }, PRESENTATION_GUIDE.techniques.map((t) =>
    el('li', {}, [el('strong', { text: `${t.name}: ` }), el('span', { text: t.how })]),
  ));
  const table = el('table', { class: 'mains-budget' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Marks' }),
        el('th', { text: 'Minutes' }),
        el('th', { text: 'Words' }),
      ]),
    ]),
    el('tbody', {}, PRESENTATION_GUIDE.budget.map((r) =>
      el('tr', {}, [
        el('td', { class: 'tnum', text: String(r.marks) }),
        el('td', { class: 'tnum', text: `~${r.minMinutes}` }),
        el('td', { class: 'tnum', text: `${r.minWords}–${r.maxWords}` }),
      ]),
    )),
  ]);
  return el('div', {}, [
    techs,
    el('p', { class: 'mains-budget-rule', text: PRESENTATION_GUIDE.budgetRule }),
    table,
  ]);
}

/** Do's & don'ts checklists. @internal */
function guideDosDonts(): HTMLElement {
  const col = (title: string, tone: 'ok' | 'danger', tips: { text: string; why: string }[]): HTMLElement =>
    el('div', { class: 'mains-dd-col' }, [
      el('h4', {}, [chip({ text: title, tone })]),
      el('ul', { class: 'mains-tech-list' }, tips.map((t) =>
        el('li', {}, [el('strong', { text: t.text }), el('span', { class: 'mains-dd-why', text: ` — ${t.why}` })]),
      )),
    ]);
  return el('div', { class: 'mains-dd' }, [
    col("Do", 'ok', DOS_DONTS.dos),
    col("Don't", 'danger', DOS_DONTS.donts),
  ]);
}

/** The self-eval rubric criteria + bands (reference copy in the guide). @internal */
function guideRubric(): HTMLElement {
  const crit = el('ul', { class: 'mains-tech-list' }, RUBRIC.criteria.map((c) =>
    el('li', {}, [el('strong', { text: `${c.name} (0–${c.max}): ` }), el('span', { text: c.tip })]),
  ));
  const bands = el('ul', { class: 'mains-tech-list' }, RUBRIC.bands.map((b) =>
    el('li', {}, [el('strong', { text: `${b.label} (≥${b.min}/${RUBRIC.maxTotal}): ` }), el('span', { text: b.note })]),
  ));
  return el('div', {}, [
    el('h4', { text: `Five criteria × 0–2 = /${RUBRIC.maxTotal}` }),
    crit,
    el('h4', { text: 'Score bands' }),
    bands,
  ]);
}

/* -------------------------------------------------------------------------- */
/* Part B — the Question library                                               */
/* -------------------------------------------------------------------------- */

/** Build the filterable question library. @internal */
function buildLibrary(initialSubtopic?: string): HTMLElement {
  const entries = collectLibrary();
  const panel = el('div', { class: 'mains-library learn-panel', attrs: { role: 'tabpanel' } });

  if (entries.length === 0) {
    panel.append(
      el('div', { class: 'empty-state' }, [
        el('span', { class: 'empty-icon' }, [icon('notes', 26)]),
        el('h3', { text: 'No Mains questions yet' }),
        el('p', { text: 'Descriptive questions will appear here once authored.' }),
      ]),
    );
    return panel;
  }

  // Distinct filter options (sorted for stable UI).
  const subtopics = [...new Map(entries.map((e) => [e.subtopicId ?? '', e.subtopicName])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const papers = [...new Set(entries.map((e) => e.item.paper))].sort();

  let subtopicFilter = initialSubtopic ?? '';
  let paperFilter = '';

  const listWrap = el('div', { class: 'mains-list' });

  const drawList = (): void => {
    const filtered = entries.filter(
      (e) =>
        (subtopicFilter === '' || (e.subtopicId ?? '') === subtopicFilter) &&
        (paperFilter === '' || e.item.paper === paperFilter),
    );
    const rows: Child[] = filtered.map((e) => libraryRow(e));
    const count = el('p', { class: 'mains-list-count', text: `${filtered.length} question${filtered.length === 1 ? '' : 's'}` });
    mount(listWrap, count, ...(rows.length > 0
      ? rows
      : [el('p', { class: 'section-lead', text: 'No questions match these filters.' })]));
  };

  const subtopicSel = el('select', { ariaLabel: 'Filter by subtopic' }, [
    el('option', { value: '', text: 'All subtopics' }),
    ...subtopics.map((s) => el('option', { value: s.id, text: s.name })),
  ]) as HTMLSelectElement;
  subtopicSel.value = subtopicFilter;
  subtopicSel.addEventListener('change', () => {
    subtopicFilter = subtopicSel.value;
    drawList();
  });

  const paperSel = el('select', { ariaLabel: 'Filter by paper' }, [
    el('option', { value: '', text: 'All papers' }),
    ...papers.map((p) => el('option', { value: p, text: paperLabel(p) })),
  ]) as HTMLSelectElement;
  paperSel.value = paperFilter;
  paperSel.addEventListener('change', () => {
    paperFilter = paperSel.value;
    drawList();
  });

  const filters = el('div', { class: 'filter-bar' }, [
    labelledControl('Subtopic', subtopicSel),
    labelledControl('Paper', paperSel),
  ]);

  panel.append(filters, listWrap);
  drawList();
  return panel;
}

/** A single question row in the library, opening the workspace. @internal */
function libraryRow(e: LibraryEntry): HTMLElement {
  const { item } = e;
  const directive = detectDirective(item.question);
  const meta = el('div', { class: 'mains-row-meta' }, [
    chip({ text: paperLabel(item.paper), tone: 'accent' }),
    item.marks ? chip({ text: `${item.marks} marks`, tone: 'muted' }) : null,
    directive ? chip({ text: directive, tone: 'default' }) : null,
    el('span', { class: 'mains-row-subtopic', text: e.subtopicName }),
  ]);
  return el('button', {
    class: 'mains-row',
    type: 'button',
    ariaLabel: `Open writing workspace: ${item.question}`,
    onClick: () => openMainsQuestion(item.id),
  }, [
    meta,
    el('p', { class: 'mains-row-q', text: item.question }),
    el('span', { class: 'mains-row-cta' }, [el('span', { text: 'Write answer' }), icon('arrow-right', 16)]),
  ]);
}

/** A labelled inline control for the filter bar. @internal */
function labelledControl(label: string, control: HTMLElement): HTMLElement {
  return el('label', { class: 'field field-row' }, [
    el('span', { class: 'filter-label', text: label }),
    control,
  ]);
}

/* -------------------------------------------------------------------------- */
/* Writing workspace (#/mains/:id)                                             */
/* -------------------------------------------------------------------------- */

/** Render the per-question writing workspace into `root`. */
export function renderWorkspace(root: HTMLElement): void {
  const id = routeParam('/mains/:id', 'id');
  const entry = id === undefined ? undefined : findEntry(id);
  if (!entry) {
    mount(
      root,
      card({ title: 'Question not found' }, [
        el('p', { class: 'section-lead', text: 'That Mains question is not in the library.' }),
        button({ label: 'Back to Mains', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/mains') }),
      ]),
    );
    return;
  }

  const { item } = entry;
  mount(
    root,
    el('div', { class: 'mains-ws' }, [
      workspaceHeader(entry),
      workspaceFramework(item),
      workspaceModel(item),
      workspacePractice(item),
      workspaceRubric(item),
      workspaceActions(item),
    ]),
  );
}

/** Header: question, paper/marks, detected directive + demand. @internal */
function workspaceHeader(e: LibraryEntry): HTMLElement {
  const { item } = e;
  const directive = detectDirective(item.question);
  const framework = DIRECTIVES.find((d) => d.keyword === directive);

  const kids: Child[] = [
    el('button', {
      class: 'learn-back',
      type: 'button',
      onClick: () => navigate('/mains'),
    }, [icon('chevron', 16), el('span', { text: 'Back to library' })]),
    el('div', { class: 'mains-row-meta' }, [
      chip({ text: paperLabel(item.paper), tone: 'accent' }),
      item.marks ? chip({ text: `${item.marks} marks`, tone: 'muted' }) : null,
      el('span', { class: 'mains-row-subtopic', text: e.subtopicName }),
    ]),
    el('p', { class: 'mains-ws-q', text: item.question }),
  ];

  if (framework) {
    kids.push(
      el('div', { class: 'mains-directive-callout' }, [
        el('p', { class: 'mains-directive-title' }, [
          icon('target', 16),
          el('span', {}, [el('strong', { text: 'Directive: ' }), el('span', { text: framework.keyword })]),
        ]),
        el('p', { class: 'mains-directive-demand', text: framework.whatItDemands }),
      ]),
    );
  } else {
    kids.push(el('p', { class: 'section-lead', text: 'No standard directive word detected — plan around the core demand of the question.' }));
  }

  return el('header', { class: 'mains-ws-header card' }, kids);
}

/** Framework scaffold from buildFramework(item). @internal */
function workspaceFramework(item: MainsItem): HTMLElement {
  const fw = buildFramework(item);
  const block = (title: string, points: string[]): HTMLElement =>
    el('div', { class: 'mains-fw-block' }, [
      el('h4', { text: title }),
      el('ul', { class: 'mains-tech-list' }, points.map((p) => el('li', { text: p }))),
    ]);
  return card({ title: 'Framework — a scaffold to write against', class: 'mains-fw' }, [
    el('p', { class: 'section-lead', text: 'Plan your answer against this skeleton before you write.' }),
    block('Introduction', fw.intro),
    block('Body — main points', fw.body),
    block('Conclusion', fw.conclusion),
  ]);
}

/** Annotated model answer (or a key-point model skeleton). @internal */
function workspaceModel(item: MainsItem): HTMLElement {
  const directive = detectDirective(item.question);
  const framework = DIRECTIVES.find((d) => d.keyword === directive);

  // Technique annotations, tied to the detected directive where available.
  const anno: Array<{ label: string; text: string }> = framework
    ? [
        { label: 'Intro', text: framework.skeleton.intro },
        { label: 'Body', text: framework.skeleton.body },
        { label: 'Conclusion', text: framework.skeleton.conclusion },
      ]
    : [
        { label: 'Intro', text: 'Define the term(s) and state the line your answer takes.' },
        { label: 'Body', text: 'Develop each main point across multiple lenses, backed by examples/facts.' },
        { label: 'Conclusion', text: 'Close with a balanced judgement and a concrete way-forward.' },
      ];
  // Add a substance reminder from the structure guide.
  const substance = STRUCTURE_GUIDE.body.substance.map((s) => s.name).join(', ');

  const annotations = el('aside', { class: 'mains-annos', attrs: { 'aria-label': 'Technique annotations' } }, [
    el('p', { class: 'note-keypoints-title' }, [icon('target', 15), el('span', { text: 'Technique notes' })]),
    el('dl', { class: 'mains-skeleton' }, anno.flatMap((a) => [
      el('dt', { text: a.label }),
      el('dd', { text: a.text }),
    ])),
    el('p', { class: 'mains-anno-substance' }, [el('strong', { text: 'Add substance: ' }), el('span', { text: substance })]),
  ]);

  let body: HTMLElement;
  if (item.modelAnswer) {
    body = el('div', { class: 'mains-model-body note-body' }, renderMarkdown(item.modelAnswer));
  } else if (item.keyPoints && item.keyPoints.length > 0) {
    body = el('div', { class: 'mains-model-body' }, [
      el('p', { class: 'section-lead', text: 'No full model answer — use these key points as a model skeleton to expand into prose:' }),
      el('ul', { class: 'keypoint-list' }, item.keyPoints.map((p) => el('li', { text: p }))),
    ]);
  } else {
    body = el('div', { class: 'mains-model-body' }, [
      el('p', { class: 'section-lead', text: 'No model answer or key points authored for this question yet — write against the framework above.' }),
    ]);
  }

  return card({ title: 'Annotated model', class: 'mains-model' }, [
    el('div', { class: 'mains-model-grid' }, [body, annotations]),
  ]);
}

/** Practice textarea with live word count + stopwatch (persisted draft). @internal */
function workspacePractice(item: MainsItem): HTMLElement {
  const saved = getMainsEntry(item.id);
  const budget = budgetFor(item.marks);

  const textarea = el('textarea', {
    class: 'mains-textarea',
    ariaLabel: 'Write your answer',
    attrs: { rows: '12', placeholder: 'Write your answer here…' },
  }) as HTMLTextAreaElement;
  textarea.value = saved?.draft ?? '';

  const budgetText = budget
    ? `Target ~${budget.minWords}–${budget.maxWords} words in ~${budget.minMinutes} min`
    : 'Aim for a complete intro, body and conclusion';
  const countEl = el('span', { class: 'tnum', text: `${countWords(textarea.value)} words` });
  const status = el('span', { class: 'mains-save-status', attrs: { role: 'status', 'aria-live': 'polite' } });

  const wordRow = el('div', { class: 'mains-word-row' }, [
    countEl,
    el('span', { class: 'mains-budget-hint', text: budgetText }),
  ]);

  // Autosave the draft on input (offline localStorage) and update the count.
  textarea.addEventListener('input', () => {
    countEl.textContent = `${countWords(textarea.value)} words`;
    saveMainsDraft(item.id, textarea.value);
    status.textContent = '';
  });

  // Stopwatch (ephemeral — not persisted).
  const timer = buildTimer(budget?.minMinutes);

  const saveBtn = button({
    label: 'Save draft',
    variant: 'primary',
    onClick: () => {
      saveMainsDraft(item.id, textarea.value);
      status.textContent = 'Saved ✓';
      showToast('Draft saved', { tone: 'success' });
    },
  });
  const clearBtn = button({
    label: 'Clear',
    variant: 'ghost',
    onClick: () => {
      textarea.value = '';
      countEl.textContent = '0 words';
      clearMains(item.id);
      status.textContent = 'Cleared';
      // Reset the rubric UI too, since clearMains removes its scores.
      resetRubricUI(item.id);
    },
  });

  return card({ title: 'Practice — write your answer', class: 'mains-practice' }, [
    timer,
    textarea,
    wordRow,
    el('div', { class: 'mains-practice-actions' }, [saveBtn, clearBtn, status]),
  ]);
}

/** A small start/pause/reset stopwatch with an optional target minutes hint. @internal */
function buildTimer(targetMin?: number): HTMLElement {
  let elapsed = 0; // seconds
  let handle: ReturnType<typeof setInterval> | null = null;

  const fmt = (s: number): string => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };
  const display = el('span', { class: 'mains-timer-display tnum', text: fmt(0) });

  const tick = (): void => {
    elapsed += 1;
    display.textContent = fmt(elapsed);
    if (targetMin && elapsed >= targetMin * 60) display.classList.add('is-over');
  };
  const startBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Start' });
  const resetBtn = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Reset' });

  startBtn.addEventListener('click', () => {
    if (handle) {
      clearInterval(handle);
      handle = null;
      startBtn.textContent = 'Start';
    } else {
      handle = setInterval(tick, 1000);
      startBtn.textContent = 'Pause';
    }
  });
  resetBtn.addEventListener('click', () => {
    if (handle) {
      clearInterval(handle);
      handle = null;
    }
    elapsed = 0;
    display.textContent = fmt(0);
    display.classList.remove('is-over');
    startBtn.textContent = 'Start';
  });

  return el('div', { class: 'mains-timer' }, [
    icon('timer', 16),
    display,
    targetMin ? el('span', { class: 'mains-timer-target', text: `target ~${targetMin} min` }) : null,
    startBtn,
    resetBtn,
  ]);
}

/* -------------------------------------------------------------------------- */
/* Self-eval rubric                                                            */
/* -------------------------------------------------------------------------- */

/** The live rubric result element, re-targeted per render for {@link resetRubricUI}. */
let rubricResultEl: HTMLElement | null = null;
/** The rubric score buttons, grouped by criterion index. */
let rubricButtons: HTMLButtonElement[][] = [];
/** The current per-criterion scores (criterion order). */
let rubricScores: number[] = [];

/** Build the self-eval rubric with 0–2 scoring per criterion (persisted). @internal */
function workspaceRubric(item: MainsItem): HTMLElement {
  const saved = getMainsEntry(item.id);
  // Seed scores from saved (only if the length matches the current rubric),
  // else default every criterion to 0.
  rubricScores =
    saved && saved.rubric.length === RUBRIC.criteria.length ? [...saved.rubric] : RUBRIC.criteria.map(() => 0);
  rubricButtons = [];

  const result = el('div', { class: 'mains-rubric-result' });
  rubricResultEl = result;

  const rows = RUBRIC.criteria.map((c, i) => {
    const btns: HTMLButtonElement[] = [];
    const scoreGroup = el('div', {
      class: 'mains-score-group',
      attrs: { role: 'radiogroup', 'aria-label': `${c.name} score` },
    }, [0, 1, 2].map((n) => {
      const b = el('button', {
        class: rubricScores[i] === n ? 'mains-score is-active' : 'mains-score',
        type: 'button',
        text: String(n),
        attrs: { role: 'radio', 'aria-checked': String(rubricScores[i] === n), 'aria-label': `${n} of ${c.max}` },
        onClick: () => setScore(item.id, i, n),
      }) as HTMLButtonElement;
      btns.push(b);
      return b;
    }));
    rubricButtons.push(btns);
    return el('div', { class: 'mains-rubric-row' }, [
      el('div', { class: 'mains-rubric-crit' }, [
        el('span', { class: 'mains-rubric-name', text: c.name }),
        el('span', { class: 'mains-rubric-tip', text: c.tip }),
      ]),
      scoreGroup,
    ]);
  });

  paintRubricResult();

  return card({ title: 'Self-evaluation — score your answer', class: 'mains-rubric' }, [
    el('p', { class: 'section-lead', text: 'Rate each criterion 0–2 against the model and the rubric tips. Your scores are saved automatically.' }),
    el('div', { class: 'mains-rubric-rows' }, rows),
    result,
  ]);
}

/** Set one criterion's score, repaint the button group + total, and persist. @internal */
function setScore(id: string, index: number, value: number): void {
  rubricScores[index] = value;
  const group = rubricButtons[index];
  if (group) {
    group.forEach((b, n) => {
      const active = n === value;
      b.className = active ? 'mains-score is-active' : 'mains-score';
      b.setAttribute('aria-checked', String(active));
    });
  }
  paintRubricResult();
  saveMainsRubric(id, rubricScores);
}

/** Repaint the /10 total + band + band note. @internal */
function paintRubricResult(): void {
  if (!rubricResultEl) return;
  const { total, band } = scoreRubric(rubricScores);
  const bandDef = RUBRIC.bands.find((b) => b.label === band);
  const tone = band === 'Strong' ? 'ok' : band === 'Developing' ? 'warn' : 'danger';
  mount(
    rubricResultEl,
    el('div', { class: 'mains-rubric-total' }, [
      el('span', { class: 'mains-rubric-score tnum', text: `${total}/${RUBRIC.maxTotal}` }),
      chip({ text: band, tone }),
    ]),
    bandDef ? el('p', { class: 'mains-rubric-note', text: bandDef.note }) : null,
  );
}

/** Reset the rubric UI to all-zero after a Clear. @internal */
function resetRubricUI(id: string): void {
  RUBRIC.criteria.forEach((_, i) => {
    rubricScores[i] = 0;
    const group = rubricButtons[i];
    if (group) {
      group.forEach((b, n) => {
        const active = n === 0;
        b.className = active ? 'mains-score is-active' : 'mains-score';
        b.setAttribute('aria-checked', String(active));
      });
    }
  });
  paintRubricResult();
  // clearMains already removed the entry; keep state clean (no rubric persisted).
  void id;
}

/* -------------------------------------------------------------------------- */
/* Footer actions                                                              */
/* -------------------------------------------------------------------------- */

/** Bottom navigation: back to the library. @internal */
function workspaceActions(item: MainsItem): HTMLElement {
  void item;
  return el('div', { class: 'mains-ws-actions' }, [
    button({ label: 'Back to list', variant: 'secondary', onClick: () => navigate('/mains') }),
  ]);
}
