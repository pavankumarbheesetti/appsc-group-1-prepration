/**
 * Subtopic "Learn" workspace — the focused, single-subtopic study surface.
 *
 * Route: `#/learn/<subtopicId>` (the id is a hash param read via
 * {@link routeParam}). One subtopic is presented with in-page TABS:
 *   - Notes       — the subtopic's NoteItems, rendered with the SAME article
 *                   builder as the Notes view ({@link buildNoteArticle}).
 *   - Flashcards  — a deck built from this subtopic's notes+MCQs via
 *                   {@link buildFlashcards}, run through the shared Revise runner.
 *   - Drill       — a focus drill scoped to this subtopic (engine `subtopicId`
 *                   filter), handed to the shared {@link mountQuiz} runner.
 *   - Mains       — this subtopic's Mains questions + model answers.
 *
 * A header shows the subtopic name, its band, coverage, status, and a
 * "Back to Syllabus" link. Search can deep-link here (a specific tab / note)
 * via {@link openLearn}.
 */
import { getCards, getCaUpdatedThrough, getMindmap, getSubtopic, getSubtopicCoverage, type SubtopicView } from '../content/loader';
import { buildSession } from '../engine/drill';
import type { SessionScore } from '../engine/drill';
import { navigate, routeParam } from '../router/router';
import { loadState } from '../state/store';
import { nextTabIndex } from '../lib/tabs';
import {
  subtopicMasteryPct,
  statusFromMastery,
} from '../lib/metrics';
import { el, mount, renderMarkdown, type Child } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';
import { icon } from './components/icon';
import { progressBar } from './components/progress';
import { bandBadge, statusChip } from './components/badges';
import { buildAtAGlance } from './components/atglance';
import { buildNoteArticle, buildMainsNotesSection } from './notes';
import { isMainsNote } from '../engine/flashcards';
import { buildCuratedDeck, mountFlashcards } from './revise';
import { mountQuiz } from './quiz';
import { openMock } from './mock';
import { openMains, openMainsQuestion } from './mains';

/** The in-page tabs of the Learn workspace: Notes / Practice (drill) / Mains. */
export type LearnTab = 'notes' | 'drill' | 'mains';

/**
 * The tabs that actually have content for this subtopic, in display order.
 * A tab is only offered when there is something to show — so a content-less
 * subtopic yields `[]` (→ full empty state). Flashcards are reached from Revise
 * or the "Flashcards for this topic" button in Notes; the one-screen mind map
 * ("Topic at a glance") lives at the TOP of Notes — neither is a tab. @internal
 */
function availableTabs(sub: SubtopicView): LearnTab[] {
  const tabs: LearnTab[] = [];
  if (sub.notes.length > 0 || getMindmap(sub.meta.id) !== undefined) tabs.push('notes');
  if (sub.mcqs.length > 0) tabs.push('drill');
  if (sub.mains.length > 0) tabs.push('mains');
  return tabs;
}

/** A deep-link focus request set by {@link openLearn} before navigating. */
interface PendingFocus {
  tab?: LearnTab;
  noteId?: string;
}
let pending: PendingFocus = {};

/**
 * Navigate to a subtopic's Learn workspace, optionally focusing a tab and/or
 * scrolling to a specific note. Used by the Syllabus tracker and global search.
 */
export function openLearn(subtopicId: string, focus?: PendingFocus): void {
  pending = focus ?? {};
  navigate(`/learn/${subtopicId}`);
}

/** Render the Learn workspace into `root`. */
export function render(root: HTMLElement): void {
  const id = routeParam('/learn/:id', 'id');
  const sub = id === undefined ? undefined : getSubtopic(id);
  if (!sub) {
    mount(
      root,
      card({ title: 'Subtopic not found' }, [
        el('p', { class: 'section-lead', text: 'That subtopic is not in the taxonomy.' }),
        button({ label: 'Back to Syllabus', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/syllabus') }),
      ]),
    );
    return;
  }

  // Consume any deep-link focus request (one-shot).
  const focus = pending;
  pending = {};

  // A content-less subtopic (planned, not yet authored) gets a friendly whole-
  // page empty state rather than a row of broken, empty tabs.
  const tabs = availableTabs(sub);
  if (tabs.length === 0) {
    mount(root, el('div', { class: 'learn' }, [buildHeader(sub), buildEmptyWorkspace(sub)]));
    return;
  }

  // Default to the requested tab when it exists for this subtopic, else the
  // first available tab (so a notes-only subtopic opens on Notes, etc.).
  let activeTab: LearnTab = focus.tab && tabs.includes(focus.tab) ? focus.tab : tabs[0]!;

  const draw = (): void => {
    mount(root, el('div', { class: 'learn' }, [buildHeader(sub), buildTabs(sub, tabs, activeTab, select), buildPanel(sub, activeTab, root, draw)]));
    // Scroll to a requested note once the Notes panel is in the DOM.
    if (activeTab === 'notes' && focus.noteId) {
      const target = document.getElementById(`learn-note-${focus.noteId}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      focus.noteId = undefined; // one-shot
    }
  };

  const select = (tab: LearnTab): void => {
    activeTab = tab;
    draw();
  };

  draw();
}

/** Build the subtopic header: name, band, status, progress, counts, back link. @internal */
function buildHeader(sub: SubtopicView): HTMLElement {
  const state = loadState();
  const mcqIds = sub.mcqs.map((m) => m.id);
  const mastery = subtopicMasteryPct(state.progress, mcqIds);
  const status = statusFromMastery(mastery);

  const badges = el('div', { class: 'learn-badges' }, [
    sub.meta.band ? bandBadge(sub.meta.band) : null,
    statusChip(status),
  ]);

  const counts = el('div', { class: 'learn-counts' }, [
    countChip('notes', `${sub.notes.length} Notes`),
    countChip('drill', `${sub.mcqs.length} MCQ`),
    countChip('notebook', `${sub.mains.length} Mains`),
  ]);

  return el('header', { class: 'learn-header card' }, [
    el('button', {
      class: 'learn-back',
      type: 'button',
      onClick: () => navigate('/syllabus'),
    }, [icon('chevron', 16), el('span', { text: 'Back to Syllabus' })]),
    el('h2', { class: 'learn-title', text: sub.meta.name }),
    badges,
    progressBar({ value: mastery / 100, label: 'Progress', caption: `${mastery}%`, success: mastery >= 100 }),
    counts,
    buildExamPointCoverage(sub),
  ]);
}

/**
 * The exam-point COVERAGE block for a subtopic that declares an `examPoints`
 * checklist: a "Coverage X% · c/t exam points" line plus a covered-vs-missing
 * list. Returns `null` for subtopics without a checklist (the coverage model
 * falls back to the band-target estimate elsewhere and nothing is shown here).
 * @internal
 */
function buildExamPointCoverage(sub: SubtopicView): HTMLElement | null {
  const cov = getSubtopicCoverage(sub.meta.id);
  const ep = cov?.examPoints;
  if (!ep || ep.total === 0) return null;
  const points = [
    ...ep.covered.map((p) => examPointItem(p, true)),
    ...ep.missing.map((p) => examPointItem(p, false)),
  ];
  return el('div', { class: 'learn-coverage' }, [
    el('p', { class: 'learn-coverage-line' }, [
      icon('target', 15),
      el('span', { class: 'tnum', text: `Coverage ${ep.pct}%` }),
      el('span', { class: 'learn-coverage-frac tnum', text: `${ep.covered.length}/${ep.total} exam points` }),
    ]),
    el('ul', { class: 'exam-points' }, points),
  ]);
}

/** A single exam-point list item, marked covered or still missing. @internal */
function examPointItem(text: string, covered: boolean): HTMLElement {
  return el('li', { class: covered ? 'exam-point is-covered' : 'exam-point is-missing' }, [
    el('span', { class: 'exam-point-mark', attrs: { 'aria-hidden': 'true' } }, [icon(covered ? 'check' : 'circle', 14)]),
    el('span', { class: 'exam-point-text', text }),
  ]);
}

/** A small icon+text count chip. @internal */
function countChip(iconName: Parameters<typeof icon>[0], text: string): HTMLElement {
  return el('span', { class: 'learn-count' }, [icon(iconName, 15), el('span', { text })]);
}

/**
 * Format an ISO `YYYY-MM-DD` CA freshness date as a short, human label like
 * `9 Oct 2026`. Falls back to the raw string if it is not a parseable date.
 * @internal
 */
function formatCaDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = Number(m[3]);
  const mon = months[Number(m[2]) - 1] ?? m[2];
  return `${day} ${mon} ${m[1]}`;
}

/** The stable id of the single (swapped) Learn tabpanel. @internal */
const LEARN_PANEL_ID = 'learn-tabpanel';

/** The DOM id of a tab button for a given LearnTab. @internal */
function tabId(tab: LearnTab): string {
  return `learn-tab-${tab}`;
}

/**
 * Build the tab bar (only the tabs that have content) as an accessible WAI-ARIA
 * tablist: each tab has an id + `aria-controls` pointing at the shared tabpanel,
 * `aria-selected`, and a ROVING tabindex (active = 0, others = -1). Left/Right/
 * Home/End move AND activate the tab (automatic activation), keeping focus on
 * the newly-selected tab. Click-to-switch is preserved. @internal
 */
function buildTabs(sub: SubtopicView, available: readonly LearnTab[], active: LearnTab, select: (t: LearnTab) => void): HTMLElement {
  const COUNTS: Record<LearnTab, number> = {
    notes: sub.notes.length,
    drill: sub.mcqs.length,
    mains: sub.mains.length,
  };
  const LABELS: Record<LearnTab, string> = {
    notes: 'Notes',
    drill: 'Practice',
    mains: 'Mains',
  };
  return el('div', { class: 'learn-tabs', attrs: { role: 'tablist', 'aria-label': 'Study modes' } },
    available.map((id, i) => {
      const isActive = active === id;
      const btn = el('button', {
        class: isActive ? 'learn-tab is-active' : 'learn-tab',
        type: 'button',
        attrs: {
          role: 'tab',
          id: tabId(id),
          'aria-selected': String(isActive),
          'aria-controls': LEARN_PANEL_ID,
          tabindex: isActive ? '0' : '-1',
        },
        onClick: () => select(id),
      }, [el('span', { text: LABELS[id] }), el('span', { class: 'learn-tab-count tnum', text: String(COUNTS[id]) })]);
      btn.addEventListener('keydown', (e) => {
        const ni = nextTabIndex(e.key, i, available.length);
        if (ni === null) return;
        e.preventDefault();
        const target = available[ni]!;
        // Re-render on the new tab, then move focus to it (draw() is synchronous).
        select(target);
        document.getElementById(tabId(target))?.focus();
      });
      return btn;
    }),
  );
}

/**
 * The whole-page empty state for a subtopic with no authored material yet.
 * Reassures the learner it is planned and coming, and offers a way back.
 * @internal
 */
function buildEmptyWorkspace(sub: SubtopicView): HTMLElement {
  return el('div', { class: 'learn-panel', attrs: { role: 'tabpanel' } }, [
    el('div', { class: 'empty-state' }, [
      el('span', { class: 'empty-icon' }, [icon('sparkles', 26)]),
      el('h3', { text: 'Study material coming soon' }),
      el('p', { text: `Study material for ${sub.meta.name} hasn\u2019t been added yet — it\u2019s in the plan and coming soon.` }),
      button({ label: 'Back to Syllabus', variant: 'primary', iconName: 'arrow-right', onClick: () => navigate('/syllabus') }),
    ]),
  ]);
}

/** Build the active tab's panel. @internal */
function buildPanel(sub: SubtopicView, active: LearnTab, root: HTMLElement, back: () => void): HTMLElement {
  const panel = el('div', {
    class: 'learn-panel',
    attrs: {
      role: 'tabpanel',
      id: LEARN_PANEL_ID,
      'aria-labelledby': tabId(active),
      tabindex: '0',
    },
  });
  switch (active) {
    case 'notes':
      panel.append(notesPanel(sub, root));
      break;
    case 'drill':
      panel.append(drillPanel(sub, root, back));
      break;
    case 'mains':
      panel.append(mainsPanel(sub));
      break;
  }
  return panel;
}

/**
 * Notes tab: the curated "Topic at a glance" map (when authored) at the top, a
 * "Flashcards for this topic" entry (when curated cards exist), then the notes.
 * @internal
 */
function notesPanel(sub: SubtopicView, root: HTMLElement): HTMLElement {
  const map = getMindmap(sub.meta.id);
  const cards = getCards(sub.meta.id);
  const kids: Child[] = [];
  // Current-Affairs subtopics show how fresh the bank is (STANDARDS: CA is
  // dated). The marker is read from content/current-affairs/meta.json.
  if (sub.meta.subjectCode === 'CA') {
    kids.push(el('p', { class: 'section-lead learn-ca-freshness' }, [
      icon('timer', 15),
      el('span', { text: `Current affairs updated through ${formatCaDate(getCaUpdatedThrough())}` }),
    ]));
  }
  if (map) kids.push(buildAtAGlance(map));
  if (cards.length > 0) {
    kids.push(el('div', { class: 'learn-flashcards-cta' }, [
      el('p', { class: 'section-lead' }, [
        icon('revise', 15),
        el('span', { text: `${cards.length} curated flashcard${cards.length === 1 ? '' : 's'} for this topic — recall the answers, don\u2019t re-read.` }),
      ]),
      button({
        label: 'Flashcards for this topic',
        variant: 'secondary',
        iconName: 'revise',
        onClick: () => mountFlashcards(root, buildCuratedDeck(cards), () => openLearn(sub.meta.id)),
      }),
    ]));
  }
  if (sub.notes.length === 0 && kids.length === 0) {
    return emptyPanel('book-open', 'No notes yet', 'Notes for this subtopic will appear here once authored.');
  }
  // Prelims notes render in reading order; the For-Mains angle note(s) go LAST
  // in a collapsed "For Mains" section, never mixed into the Prelims order and
  // never drilled as cards (STANDARDS §8a).
  const prelimsNotes = sub.notes.filter((n) => !isMainsNote(n));
  const mainsNotes = sub.notes.filter((n) => isMainsNote(n));
  if (prelimsNotes.length > 0) {
    kids.push(...prelimsNotes.map((n) => buildNoteArticle(n, `learn-note-${n.id}`)));
  }
  const mainsSection = buildMainsNotesSection(mainsNotes, 'learn-note-mains');
  if (mainsSection) kids.push(mainsSection);
  return el('div', { class: 'reading' }, kids);
}

/** Drill tab: an intro + start button that runs a subtopic-scoped focus drill. @internal */
function drillPanel(sub: SubtopicView, root: HTMLElement, back: () => void): HTMLElement {
  if (sub.mcqs.length === 0) return emptyPanel('drill', 'No questions yet', 'MCQs for this subtopic will appear here once authored.');
  const start = (): void => {
    const items = buildSession({ subtopicId: sub.meta.id, order: 'ladder' }).items;
    mountQuiz(root, items, (score) => drillResults(root, sub, score, back), { allowEndSession: true });
  };
  const practice = startPanel(
    'drill',
    `${sub.mcqs.length} question${sub.mcqs.length === 1 ? '' : 's'} in scope`,
    'A focus drill scoped to this subtopic — stop anytime.',
    'Start drill',
    start,
  );
  // A timed-mock entry point scoped to just this subtopic (no per-question
  // feedback, -1/3 negative marking) — routes to the Mock setup pre-scoped here.
  const mockRow = el('div', { class: 'learn-mock-cta' }, [
    el('p', { class: 'section-lead' }, [icon('timer', 15), el('span', { text: 'Prefer exam conditions? Sit a timed mock on this subtopic — negative marking, no feedback until you submit.' })]),
    button({
      label: 'Mock this subtopic',
      variant: 'secondary',
      iconName: 'timer',
      onClick: () => openMock({ scopeKind: 'subtopic', subtopicId: sub.meta.id }),
    }),
  ]);
  return el('div', { class: 'learn-drill' }, [practice, mockRow]);
}

/** End-of-drill results for the subtopic-scoped drill. @internal */
function drillResults(root: HTMLElement, sub: SubtopicView, score: SessionScore, back: () => void): void {
  const line = score.total === 0 ? 'No questions answered.' : `${score.correct}/${score.total} correct.`;
  mount(
    root,
    el('div', { class: 'results' }, [
      card({ title: 'Drill complete' }, [
        el('p', { class: 'section-lead', text: `${sub.meta.name} — ${line}` }),
        el('div', { class: 'focus-advance', attrs: { style: 'justify-content:center;flex-wrap:wrap' } }, [
          button({ label: 'Back to subtopic', variant: 'primary', onClick: () => back() }),
          button({ label: 'Syllabus', variant: 'ghost', onClick: () => navigate('/syllabus') }),
        ]),
      ]),
    ]),
  );
}

/** Mains tab: questions with optional model answers + key points. @internal */
function mainsPanel(sub: SubtopicView): HTMLElement {
  if (sub.mains.length === 0) return emptyPanel('notebook', 'No Mains questions yet', 'Descriptive practice for this subtopic will appear here.');
  // CTA into the dedicated Mains writing trainer, pre-filtered to this subtopic.
  const cta = el('div', { class: 'learn-mock-cta' }, [
    el('p', { class: 'section-lead' }, [icon('notes', 15), el('span', { text: 'Learn how to WRITE these answers — frameworks, an annotated model, a practice pad and a self-eval rubric.' })]),
    button({
      label: 'Practice mains',
      variant: 'secondary',
      iconName: 'arrow-right',
      onClick: () => openMains(sub.meta.id),
    }),
  ]);
  const articles = sub.mains.map((m) => {
    const kids: Child[] = [
      el('div', { class: 'mains-q-head' }, [
        chip({ text: m.paper.replace('mains-', 'Mains ').replace('-', ' '), tone: 'accent' }),
        m.marks ? chip({ text: `${m.marks} marks`, tone: 'muted' }) : null,
      ]),
      el('p', { class: 'mains-q', text: m.question }),
    ];
    if (m.modelAnswer) {
      kids.push(el('details', { class: 'mains-answer' }, [
        el('summary', { text: 'Model answer' }),
        el('div', { class: 'note-body' }, renderMarkdown(m.modelAnswer)),
      ]));
    }
    if (m.keyPoints && m.keyPoints.length > 0) {
      kids.push(el('aside', { class: 'note-keypoints', attrs: { 'aria-label': 'Key points' } }, [
        el('p', { class: 'note-keypoints-title' }, [icon('target', 16), el('span', { text: 'Key points' })]),
        el('ul', { class: 'keypoint-list' }, m.keyPoints.map((p) => el('li', { text: p }))),
      ]));
    }
    kids.push(button({
      label: 'Write this answer',
      variant: 'ghost',
      iconName: 'arrow-right',
      onClick: () => openMainsQuestion(m.id),
    }));
    return el('article', { class: 'mains-item card' }, kids);
  });
  return el('div', { class: 'reading' }, [cta, ...articles]);
}

/** A reusable "start" panel (icon + summary + CTA). @internal */
function startPanel(
  iconName: Parameters<typeof icon>[0],
  heading: string,
  body: string,
  cta: string,
  onStart: () => void,
): HTMLElement {
  return el('div', { class: 'learn-start card' }, [
    el('span', { class: 'empty-icon' }, [icon(iconName, 26)]),
    el('h3', { text: heading }),
    el('p', { class: 'section-lead', text: body }),
    button({ label: cta, variant: 'primary', iconName: 'arrow-right', onClick: onStart }),
  ]);
}

/** A friendly per-panel empty state. @internal */
function emptyPanel(iconName: Parameters<typeof icon>[0], heading: string, body: string): HTMLElement {
  return el('div', { class: 'empty-state' }, [
    el('span', { class: 'empty-icon' }, [icon(iconName, 26)]),
    el('h3', { text: heading }),
    el('p', { text: body }),
  ]);
}
