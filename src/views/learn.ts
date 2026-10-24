/**
 * Subtopic "Learn" workspace — the focused, single-topic study surface.
 *
 * Routes (every state you would want to undo has its own URL — NAV spec §3.4):
 *   `#/learn/<id>/notes` · `#/learn/<id>/practice` · `#/learn/<id>/mains`
 *   `#/learn/<id>/practice/results`
 * plus an optional query: `from` (the origin — today / plan / topics / …, which
 * drives the `‹ Today` / `‹ Plan` / `‹ Topics` back link) and `note` (a deep
 * link that scrolls to one note). `#/learn/<id>` redirects to the first tab.
 *
 * Layout: a compact header (breadcrumb `Topics › Subject › Chapter › Topic`,
 * the page h1, one status chip, one progress bar, a COLLAPSED exam-point
 * checklist), a STICKY tab bar, and the panel. Notes get an "On this page"
 * table of contents (a right-hand sticky list ≥1100px; a `Contents · 4/14`
 * chip + sheet below that), a `Next: … ↓` link after each note and the
 * "Next up" footer after the last one.
 */
import { ACCURACY_LABEL, accuracyCaption, formatAccuracy, topicAccuracy } from '../lib/accuracy';
import { getCards, getCaUpdatedThrough, getMindmap, getSubjects, getSubtopic, getSubtopicCoverage, getTaxonomy, type SubtopicView } from '../content/loader';
import type { NoteItem } from '../content/types';
import { buildSession } from '../engine/drill';
import type { SessionScore } from '../engine/drill';
import { navigate, pushUrl, routeQuery, setDocumentTitle } from '../router/router';
import { loadState, noteTopicOpened } from '../state/store';
import { markTopicStudied, topicStudy, lowAccuracyNote, AUTO_STUDIED_ANSWERS, AUTO_STUDIED_MIN_ACCURACY } from '../lib/study-status';
import { nextTabIndex } from '../lib/tabs';
import { el, mount, renderMarkdown, type Child } from './dom';
import { card } from './components/card';
import { button } from './components/button';
import { chip } from './components/chip';
import { icon } from './components/icon';
import { progressBar } from './components/progress';
import { bandBadge, studyStatusChip } from './components/badges';
import { buildAtAGlance } from './components/atglance';
import { buildNoteArticle, buildMainsNotesSection, noteSections, type NoteSection } from './notes';
import { isMainsNote } from '../engine/flashcards';
import { buildCuratedDeck, mountFlashcards } from './revise';
import { mountQuiz, type QuizSessionOpts } from './quiz';
import { clearDrillSession, resumeText, withResume } from '../lib/drill-session';
import { pausedDrill, resumeItems, resumeRequested } from './drill-resume';
import { openMock } from './mock';
import { openMains, openMainsQuestion } from './mains';
import { openScopedReview } from './notebook';
import { ORIGINS, isOrigin, nextUpFooter, originFromHash, setTopbarBack, setTopbarTitle, PATHS, type Origin } from './shell';
import { nextStep } from './next-topic';

/** The in-page tabs of the Learn workspace. */
export type LearnTab = 'notes' | 'practice' | 'mains';

/** Accepts the legacy `drill` name for the Practice tab. */
type TabRequest = LearnTab | 'drill';

/** Tab labels (spec §3.8). */
const LABELS: Record<LearnTab, string> = { notes: 'Notes', practice: 'Practice', mains: 'Mains' };

/**
 * The tabs that actually have content for this subtopic, in display order.
 * A content-less subtopic yields `[]` (→ full empty state). @internal
 */
function availableTabs(sub: SubtopicView): LearnTab[] {
  const tabs: LearnTab[] = [];
  if (sub.notes.length > 0 || getMindmap(sub.meta.id) !== undefined) tabs.push('notes');
  if (sub.mcqs.length > 0) tabs.push('practice');
  if (sub.mains.length > 0) tabs.push('mains');
  return tabs;
}

/** Map a requested tab name (incl. legacy `drill`) to a LearnTab. @internal */
function toTab(t: string | undefined): LearnTab | undefined {
  if (t === 'drill') return 'practice';
  return t === 'notes' || t === 'practice' || t === 'mains' ? t : undefined;
}

/** Build a Learn path: `/learn/<id>/<tab>[/results][?from=…&note=…]`. */
export function learnPath(id: string, tab: LearnTab, opts: { from?: Origin; note?: string; results?: boolean } = {}): string {
  const q = new URLSearchParams();
  if (opts.from) q.set('from', opts.from);
  if (opts.note) q.set('note', opts.note);
  const qs = q.toString();
  return `/learn/${encodeURIComponent(id)}/${tab}${opts.results ? '/results' : ''}${qs ? `?${qs}` : ''}`;
}

/** The canonical path for `#/learn/<id>` (its first available tab). */
export function defaultLearnPath(id: string): string {
  const sub = getSubtopic(id);
  const first = sub ? availableTabs(sub)[0] : undefined;
  return learnPath(id, first ?? 'notes');
}

/**
 * Navigate to a subtopic's Learn workspace, optionally on a tab and/or a note.
 * The origin (`from`) defaults to the page we are leaving, so the back link
 * reads `‹ Today` from Today, `‹ Plan` from the planner, etc.; moving from one
 * topic to the next keeps the original origin.
 */
export function openLearn(subtopicId: string, focus: { tab?: TabRequest; noteId?: string; from?: Origin } = {}): void {
  const from = focus.from ?? originFromHash();
  const sub = getSubtopic(subtopicId);
  const tabs = sub ? availableTabs(sub) : [];
  const want = toTab(focus.tab);
  const tab = want && tabs.includes(want) ? want : tabs[0] ?? 'notes';
  navigate(learnPath(subtopicId, tab, { from, note: focus.noteId }));
}

/** The parsed Learn hash. @internal */
interface LearnRoute {
  id: string | undefined;
  tab: string | undefined;
  results: boolean;
  from: Origin;
  note: string | undefined;
}

/** Parse the live hash into the Learn route parts. @internal */
function parseRoute(): LearnRoute {
  const path = (location.hash || '#/').split('?')[0] ?? '';
  const segs = path.replace(/^#\/?/, '').split('/');
  const id = segs[0] === 'learn' && segs[1] ? decodeURIComponent(segs[1]) : undefined;
  const from = routeQuery('from');
  return {
    id,
    tab: segs[2],
    results: segs[3] === 'results',
    from: isOrigin(from) ? from : 'topics',
    note: routeQuery('note'),
  };
}

/** Results of the last practice session per subtopic (for the results URL). @internal */
const resultsCache = new Map<string, { score: SessionScore; wrongIds: string[] }>();

/** Incremented on every render (lets a tab switch detect a missing router). @internal */
let renderCount = 0;

/** Set when a tab switch should keep the tab bar in view after re-render. @internal */
let scrollToTabsAfterRender = false;

/** The origin's back target; Topics goes back to the subtopic's chapter. @internal */
function originTarget(from: Origin, sub?: SubtopicView): { label: string; path: string } {
  const o = ORIGINS[from];
  if (from === 'topics' && sub) return { label: o.label, path: topicsPath(sub) };
  return o;
}

/** `#/topics?s=<subject>&c=<chapter>` — the list filtered + scrolled to this topic. @internal */
function topicsPath(sub: SubtopicView, chapterOnly = true): string {
  const q = new URLSearchParams({ s: sub.meta.subjectCode });
  if (chapterOnly) q.set('c', sub.meta.chapterId);
  return `${PATHS.topics}?${q.toString()}`;
}

/** Render the Learn workspace into `root`. */
export function render(root: HTMLElement): void {
  renderCount += 1;
  const route = parseRoute();
  const sub = route.id === undefined ? undefined : getSubtopic(route.id);
  const back = originTarget(route.from, sub);
  const goBack = (): void => navigate(back.path);
  setTopbarBack({ label: back.label, onClick: goBack });
  if (!sub) {
    setTopbarTitle('Topic not found', { heading: false });
    setDocumentTitle('Topic not found', 'Topics');
    mount(
      root,
      card({}, [
        el('h1', { class: 'learn-title', text: 'Subtopic not found' }),
        el('p', { class: 'section-lead', text: 'That subtopic is not in the taxonomy.' }),
        button({ label: `\u2039 Back to ${back.label}`, variant: 'primary', onClick: goBack }),
      ]),
    );
    return;
  }

  setTopbarTitle(sub.meta.name, { heading: false });
  const tabs = availableTabs(sub);

  // A content-less subtopic gets a friendly whole-page empty state.
  if (tabs.length === 0) {
    setDocumentTitle(sub.meta.name, 'Topics');
    mount(root, el('div', { class: 'learn' }, [buildHeader(sub, route, back, goBack), buildEmptyWorkspace(back, goBack)]));
    return;
  }

  const requested = toTab(route.tab);
  const active: LearnTab = requested && tabs.includes(requested) ? requested : tabs[0]!;
  // Correct a missing / unknown tab in the address bar (no extra history entry).
  if (route.id && requested !== active && location.hash.startsWith('#/learn/')) {
    try {
      history.replaceState(history.state, '', `#${learnPath(sub.meta.id, active, { from: route.from, note: route.note })}`);
    } catch {
      /* ignore */
    }
  }

  // Practice results have their own URL; without the in-memory results (a
  // reload) fall back to the Practice tab.
  if (route.results && active === 'practice') {
    const res = resultsCache.get(sub.meta.id);
    if (res) {
      setDocumentTitle(`${sub.meta.name} \u2014 Practice complete`, 'Topics');
      drawResults(root, sub, route, back, goBack, res.score, res.wrongIds);
      return;
    }
  }

  setDocumentTitle(active === 'notes' ? sub.meta.name : `${sub.meta.name} \u2014 ${LABELS[active]}`, 'Topics');
  if (active === 'notes') noteTopicOpened(sub.meta.id);

  const select = (tab: LearnTab): void => {
    if (tab === active) return;
    const before = renderCount;
    scrollToTabsAfterRender = true;
    navigate(learnPath(sub.meta.id, tab, { from: route.from }), { keepScroll: true, keepFocus: true });
    if (renderCount === before) {
      // No router mounted (unit tests): update the hash and re-render here.
      try {
        history.replaceState(history.state, '', `#${learnPath(sub.meta.id, tab, { from: route.from })}`);
      } catch {
        /* ignore */
      }
      render(root);
    }
  };

  const toc = active === 'notes' ? tocEntries(sub) : [];
  const contents = toc.length > 1 ? buildContentsChip(toc) : null;
  const panel = buildPanel(sub, active, root, route, toc);
  mount(
    root,
    el('div', { class: 'learn' }, [
      buildHeader(sub, route, back, goBack, active === 'notes' ? toc : []),
      el('div', { class: 'learn-tabbar' }, [buildTabs(sub, tabs, active, select), contents?.chip ?? null, contents?.sheet ?? null]),
      panel,
    ]),
  );
  if (toc.length > 1) wireTocTracking(sub.meta.id, toc, root, contents);

  // `?resume=<key>` (a Resume entry, or a reload mid-practice) reopens the
  // paused practice run straight away.
  if (active === 'practice' && !route.results && resumeRequested(learnDrillKey(sub.meta.id)) && pausedDrill(learnDrillKey(sub.meta.id))) {
    beginPractice(sub, root, route, 'resume');
    return;
  }

  // A tab switch keeps the tab bar in view (rule 4: top of the tablist, not
  // the page top). A note deep link scrolls to that note.
  if (scrollToTabsAfterRender) {
    scrollToTabsAfterRender = false;
    const bar = root.querySelector<HTMLElement>('.learn-tabbar');
    if (bar && typeof window.scrollTo === 'function' && !navigator.userAgent.includes('jsdom')) {
      const top = bar.getBoundingClientRect().top + window.scrollY - topbarHeight();
      if (window.scrollY > top) window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
    }
  }
  if (active === 'notes' && route.note) {
    const target = document.getElementById(`learn-note-${route.note}`);
    if (target) setTimeout(() => scrollToEl(target), 0);
  }
}

/** The fixed top bar's height (sticky offset). @internal */
function topbarHeight(): number {
  return document.querySelector<HTMLElement>('.topbar')?.offsetHeight ?? 0;
}

/** Scroll so `node` sits just under the sticky top bar + tab bar. @internal */
function scrollToEl(node: HTMLElement): void {
  if (navigator.userAgent.includes('jsdom')) return;
  const bar = document.querySelector<HTMLElement>('.learn-tabbar');
  const offset = topbarHeight() + (bar?.offsetHeight ?? 0) + 8;
  const top = node.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: 'instant' as ScrollBehavior });
}

/* -------------------------------------------------------------------------- */
/* Header: breadcrumb, h1, status, progress, collapsed checklist               */
/* -------------------------------------------------------------------------- */

/** One TOC entry: a prelims note, its anchor id and its body sections. @internal */
interface TocEntry {
  anchor: string;
  title: string;
  noteId: string;
  sections: NoteSection[];
}

/** The notes' "On this page" entries (Prelims notes, reading order). @internal */
function tocEntries(sub: SubtopicView): TocEntry[] {
  return sub.notes.filter((n) => !isMainsNote(n)).map((n) => {
    const anchor = `learn-note-${n.id}`;
    return { anchor, title: n.title, noteId: n.id, sections: noteSections(n, anchor) };
  });
}

/** localStorage key of the last section read per topic. @internal */
function lastSectionKey(id: string): string {
  return `appsc.lastSection.${id}`;
}

/** The last section read in a topic (a note id), if remembered. */
export function lastSection(id: string): string | undefined {
  try {
    return localStorage.getItem(lastSectionKey(id)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Remember the last section read in a topic. @internal */
function rememberSection(id: string, noteId: string): void {
  try {
    localStorage.setItem(lastSectionKey(id), noteId);
  } catch {
    /* storage unavailable */
  }
}

/** The `Continue at <section> →` hint for a topic (or null). */
export function continueHint(sub: SubtopicView): { title: string; noteId: string } | null {
  const id = lastSection(sub.meta.id);
  if (!id) return null;
  const notes = sub.notes.filter((n) => !isMainsNote(n));
  const idx = notes.findIndex((n) => n.id === id);
  if (idx <= 0) return null; // the first section = nothing to continue
  return { title: notes[idx]!.title, noteId: id };
}

/** Subject + chapter names of a subtopic. @internal */
function trailOf(sub: SubtopicView): { subject: string; chapter: string } {
  const subject = getSubjects().find((s) => s.code === sub.meta.subjectCode)?.name ?? sub.meta.subjectCode;
  const chapter = getTaxonomy().chapters.find((c) => c.id === sub.meta.chapterId)?.name ?? '';
  return { subject, chapter };
}

/** An in-app link (`<a href>` + router navigate). @internal */
function link(cls: string, path: string, children: Child[], label?: string): HTMLElement {
  return el('a', {
    class: cls,
    href: `#${path}`,
    ariaLabel: label,
    onClick: (e) => {
      e.preventDefault();
      navigate(path);
    },
  }, children);
}

/** Build the subtopic header. @internal */
function buildHeader(
  sub: SubtopicView,
  route: LearnRoute,
  back: { label: string; path: string },
  goBack: () => void,
  toc: readonly TocEntry[] = [],
): HTMLElement {
  const state = loadState();
  const acc = topicAccuracy(state.progress, sub.mcqs.map((m) => m.id));
  const study = topicStudy(sub.meta.id);
  const { subject, chapter } = trailOf(sub);

  const crumbs = el('nav', { class: 'breadcrumb', ariaLabel: 'Breadcrumb' }, [
    el('ol', {}, [
      el('li', {}, [link('crumb', PATHS.topics, ['Topics'])]),
      el('li', {}, [link('crumb', topicsPath(sub, false), [subject])]),
      chapter ? el('li', {}, [link('crumb', topicsPath(sub), [chapter])]) : null,
      el('li', {}, [el('span', { class: 'crumb is-current', attrs: { 'aria-current': 'page' }, text: sub.meta.name })]),
    ]),
  ]);
  // On a phone the trail collapses to its parent (`‹ Ancient India I`).
  const up = chapter ? link('crumb-up', topicsPath(sub), [`\u2039 ${chapter}`], `Up to ${chapter}`) : null;

  const cont = route.tab === undefined || toTab(route.tab) === 'notes' ? continueHint(sub) : null;
  const continueLink = cont && toc.length > 0
    ? el('button', {
        class: 'link-btn learn-continue',
        type: 'button',
        text: `Continue at ${cont.title} \u2192`,
        onClick: () => {
          const node = document.getElementById(`learn-note-${cont.noteId}`);
          if (node) scrollToEl(node);
        },
      })
    : null;

  return el('header', { class: 'learn-header card' }, [
    el('div', { class: 'learn-header-nav' }, [
      el('button', { class: 'learn-back', type: 'button', ariaLabel: `Back to ${back.label}`, onClick: goBack }, [
        el('span', { attrs: { 'aria-hidden': 'true' }, text: '\u2039' }),
        el('span', { text: back.label }),
      ]),
      crumbs,
      up,
    ]),
    el('h1', { class: 'learn-title', attrs: { tabindex: '-1' }, text: sub.meta.name }),
    el('p', { class: 'learn-trail', text: chapter ? `${subject} \u203a ${chapter}` : subject }),
    el('div', { class: 'learn-badges' }, [sub.meta.band ? bandBadge(sub.meta.band) : null, studyChip(study.status)]),
    progressBar({ value: (acc.pct ?? 0) / 100, label: ACCURACY_LABEL, caption: accuracyCaption(acc), success: acc.pct === 100 }),
    continueLink,
    buildExamPointCoverage(sub),
  ]);
}

/**
 * The exam-point checklist, COLLAPSED: `Coverage X% · c/t exam points ▸`
 * opens the covered-vs-missing list. Null when the subtopic has no checklist.
 * @internal
 */
function buildExamPointCoverage(sub: SubtopicView): HTMLElement | null {
  const ep = getSubtopicCoverage(sub.meta.id)?.examPoints;
  if (!ep || ep.total === 0) return null;
  const points = [...ep.covered.map((p) => examPointItem(p, true)), ...ep.missing.map((p) => examPointItem(p, false))];
  return el('details', { class: 'learn-coverage' }, [
    el('summary', { class: 'learn-coverage-line' }, [
      icon('target', 15),
      el('span', { class: 'tnum', text: `Coverage ${ep.pct}%` }),
      el('span', { class: 'learn-coverage-frac tnum', text: `${ep.covered.length}/${ep.total} exam points` }),
    ]),
    el('ul', { class: 'exam-points' }, points),
  ]);
}

/** A single exam-point list item. @internal */
function examPointItem(text: string, covered: boolean): HTMLElement {
  return el('li', { class: covered ? 'exam-point is-covered' : 'exam-point is-missing' }, [
    el('span', { class: 'exam-point-mark', attrs: { 'aria-hidden': 'true' } }, [icon(covered ? 'check' : 'circle', 14)]),
    el('span', { class: 'exam-point-text', text }),
  ]);
}

/** `9 Oct 2026` from an ISO date (raw string when unparseable). @internal */
function formatCaDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                         */
/* -------------------------------------------------------------------------- */

/** The stable id of the single Learn tabpanel. @internal */
const LEARN_PANEL_ID = 'learn-tabpanel';

/** The DOM id of a tab button. @internal */
function tabId(tab: LearnTab): string {
  return `learn-tab-${tab}`;
}

/**
 * The accessible WAI-ARIA tablist (`Notes 14 · Practice 22 · Mains 3`): roving
 * tabindex, Left/Right/Home/End move AND activate. Each tab is its own URL.
 * @internal
 */
function buildTabs(sub: SubtopicView, available: readonly LearnTab[], active: LearnTab, select: (t: LearnTab) => void): HTMLElement {
  const COUNTS: Record<LearnTab, number> = { notes: sub.notes.length, practice: sub.mcqs.length, mains: sub.mains.length };
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
        select(target);
        document.getElementById(tabId(target))?.focus();
      });
      return btn;
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Table of contents                                                           */
/* -------------------------------------------------------------------------- */

/** The <1100px `Contents · 4/14 ▾` chip and its sheet. @internal */
interface ContentsChip {
  chip: HTMLButtonElement;
  sheet: HTMLElement;
  setCurrent(idx: number): void;
}

/**
 * Build the NESTED TOC (shared by the side list and the chip sheet): one group
 * per note (`a.toc-link`, the note title) with its body sections indented
 * beneath (`a.toc-sublink`). The current note's sections are expanded. @internal
 */
function tocLinks(toc: readonly TocEntry[], onPick?: () => void): HTMLElement {
  const jump = (anchor: string) => (e: MouseEvent): void => {
    e.preventDefault();
    onPick?.();
    const node = document.getElementById(anchor);
    if (node) scrollToEl(node);
  };
  return el('ol', { class: 'toc-list' }, toc.map((t, i) =>
    el('li', { class: 'toc-group', attrs: { 'data-toc-group': String(i) } }, [
      el('a', {
        class: 'toc-link',
        href: `#${t.anchor}`,
        attrs: { 'data-toc-idx': String(i) },
        onClick: jump(t.anchor),
      }, [el('span', { class: 'toc-mark', attrs: { 'aria-hidden': 'true' } }), el('span', { class: 'toc-text', text: t.title })]),
      t.sections.length > 0
        ? el('ol', { class: 'toc-sub' }, t.sections.map((s, k) =>
            el('li', {}, [
              el('a', {
                class: 'toc-sublink',
                href: `#${s.anchor}`,
                attrs: { 'data-toc-idx': String(i), 'data-toc-sub': String(k) },
                onClick: jump(s.anchor),
              }, [s.title]),
            ]),
          ))
        : null,
    ]),
  ));
}

/** Build the contents chip + sheet. @internal */
function buildContentsChip(toc: readonly TocEntry[]): ContentsChip {
  const label = el('span', { text: `Contents \u00b7 1/${toc.length}` });
  const chipBtn = el('button', {
    class: 'contents-chip',
    type: 'button',
    attrs: { 'aria-expanded': 'false', 'aria-controls': 'learn-contents-sheet' },
  }, [label, el('span', { attrs: { 'aria-hidden': 'true' }, text: ' \u25be' })]) as HTMLButtonElement;
  const close = (): void => {
    sheet.hidden = true;
    chipBtn.setAttribute('aria-expanded', 'false');
  };
  const sheet = el('nav', { class: 'contents-sheet toc', ariaLabel: 'Contents', attrs: { id: 'learn-contents-sheet', hidden: 'true' } }, [
    el('span', { class: 'toc-eyebrow', text: 'On this page' }),
    tocLinks(toc, close),
  ]);
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
      chipBtn.focus();
    }
  });
  chipBtn.addEventListener('click', () => {
    const open = sheet.hidden;
    sheet.hidden = !open;
    chipBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      // Land on (and reveal) the section being read, not the first entry.
      const cur = sheet.querySelector<HTMLElement>('.toc-sublink.is-current') ?? sheet.querySelector<HTMLElement>('.toc-link.is-current') ?? sheet.querySelector<HTMLElement>('.toc-link');
      cur?.focus();
      cur?.scrollIntoView?.({ block: 'nearest' });
    }
  });
  return {
    chip: chipBtn,
    sheet,
    setCurrent: (idx) => {
      label.textContent = `Contents \u00b7 ${idx + 1}/${toc.length}`;
    },
  };
}

/** The live contents tracker's setter (note index, section index or -1). @internal */
let tocSetCurrent: ((idx: number, sub: number) => void) | null = null;

/**
 * Track the section being read on BOTH levels: the note (highlighted, its
 * sections expanded, earlier notes ticked, chip count updated, remembered for
 * "Continue at …") and the body section within it. The reading line sits 35%
 * down the viewport; the current item is the last one whose top has crossed
 * it. Scroll-driven (rAF-throttled, passive); detaches once the view is gone.
 * @internal
 */
function wireTocTracking(id: string, toc: readonly TocEntry[], root: HTMLElement, chipCtl: ContentsChip | null): void {
  let cur = -1;
  let curSub = -2;
  const setCurrent = (idx: number, sub: number): void => {
    if (idx === cur && sub === curSub) return;
    const noteChanged = idx !== cur;
    cur = idx;
    curSub = sub;
    for (const g of root.querySelectorAll<HTMLElement>('.toc-group[data-toc-group]')) {
      g.classList.toggle('is-current', Number(g.dataset.tocGroup) === idx);
    }
    for (const a of root.querySelectorAll<HTMLElement>('.toc-link[data-toc-idx]')) {
      const i = Number(a.dataset.tocIdx);
      a.classList.toggle('is-current', i === idx);
      a.classList.toggle('is-read', i < idx);
      if (i === idx && sub < 0) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
    for (const a of root.querySelectorAll<HTMLElement>('.toc-sublink[data-toc-sub]')) {
      const on = Number(a.dataset.tocIdx) === idx && Number(a.dataset.tocSub) === sub;
      a.classList.toggle('is-current', on);
      if (on) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
    if (!noteChanged) return;
    chipCtl?.setCurrent(idx);
    const entry = toc[idx];
    if (entry) rememberSection(id, entry.noteId);
  };
  setCurrent(0, -1);
  tocSetCurrent = setCurrent;
  if (navigator.userAgent.includes('jsdom')) return;
  const groups = toc.map((t) => ({
    node: document.getElementById(t.anchor),
    subs: t.sections.map((s) => document.getElementById(s.anchor)),
  }));
  /** Index of the last node whose top is above the reading line (or -1). */
  const lastAbove = (nodes: readonly (HTMLElement | null)[], line: number): number => {
    let found = -1;
    nodes.forEach((n, i) => {
      if (n && n.getBoundingClientRect().top <= line) found = i;
    });
    return found;
  };
  let queued = false;
  const update = (): void => {
    queued = false;
    if (!root.isConnected || !groups[0]?.node?.isConnected) {
      window.removeEventListener('scroll', onScroll);
      return;
    }
    const line = window.innerHeight * 0.35;
    const idx = Math.max(0, lastAbove(groups.map((g) => g.node), line));
    setCurrent(idx, lastAbove(groups[idx]?.subs ?? [], line));
  };
  const onScroll = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  requestAnimationFrame(update);
}


/** Test hook: drive the contents tracker as a scroll would. @internal */
export function __setTocCurrentForTests(idx: number, sub: number): void {
  tocSetCurrent?.(idx, sub);
}

/* -------------------------------------------------------------------------- */
/* Panels                                                                      */
/* -------------------------------------------------------------------------- */

/** Notes for this topic are coming soon — the whole-page empty state. @internal */
function buildEmptyWorkspace(back: { label: string }, goBack: () => void): HTMLElement {
  return el('div', { class: 'learn-panel', attrs: { role: 'region', 'aria-label': 'Study material' } }, [
    el('div', { class: 'empty-state' }, [
      el('span', { class: 'empty-icon' }, [icon('sparkles', 26)]),
      el('h2', { text: 'Study material coming soon' }),
      el('p', { text: 'Notes for this topic are coming soon.' }),
      button({ label: `\u2039 Back to ${back.label}`, variant: 'primary', onClick: goBack }),
    ]),
  ]);
}

/** Build the active tab's panel. @internal */
function buildPanel(sub: SubtopicView, active: LearnTab, root: HTMLElement, route: LearnRoute, toc: readonly TocEntry[]): HTMLElement {
  const panel = el('div', {
    class: 'learn-panel',
    attrs: { role: 'tabpanel', id: LEARN_PANEL_ID, 'aria-labelledby': tabId(active), tabindex: '0' },
  });
  if (active === 'notes') panel.append(notesPanel(sub, root, route, toc));
  else if (active === 'practice') panel.append(practicePanel(sub, root, route));
  else panel.append(mainsPanel(sub));
  return panel;
}

/** Go to a Learn tab (a new URL, origin kept). @internal */
function goTab(sub: SubtopicView, tab: LearnTab, route: LearnRoute): void {
  navigate(learnPath(sub.meta.id, tab, { from: route.from }));
}

/** Mark the topic studied, then go to the next step from today's plan. @internal */
function markAndNext(sub: SubtopicView): void {
  markTopicStudied(sub.meta.id, true);
  nextStep(sub.meta.id).go();
}

/**
 * Notes tab: CA freshness, "Topic at a glance", the curated-flashcards entry,
 * the notes (each ending in `Next: … ↓`), the collapsed For-Mains section and
 * the Next-up footer. Wide screens add the "On this page" list. @internal
 */
function notesPanel(sub: SubtopicView, root: HTMLElement, route: LearnRoute, toc: readonly TocEntry[]): HTMLElement {
  const map = getMindmap(sub.meta.id);
  const cards = getCards(sub.meta.id);
  const kids: Child[] = [];
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
        el('span', { text: `${cards.length} curated flashcard${cards.length === 1 ? '' : 's'} for this topic \u2014 recall the answers, don\u2019t re-read.` }),
      ]),
      button({
        label: 'Flashcards for this topic',
        variant: 'secondary',
        iconName: 'revise',
        onClick: () => mountFlashcards(root, buildCuratedDeck(cards), () => openLearn(sub.meta.id, { tab: 'notes', from: route.from })),
      }),
    ]));
  }
  if (sub.notes.length === 0 && kids.length === 0) {
    return emptyPanel('book-open', 'No notes yet', 'Notes for this topic are coming soon.');
  }
  const prelims: NoteItem[] = sub.notes.filter((n) => !isMainsNote(n));
  const mainsNotes = sub.notes.filter((n) => isMainsNote(n));
  prelims.forEach((n, i) => {
    const article = buildNoteArticle(n, `learn-note-${n.id}`, { index: i + 1, total: prelims.length, titleTag: 'h2' });
    const next = prelims[i + 1];
    if (next) {
      article.append(el('a', {
        class: 'note-next',
        href: `#learn-note-${next.id}`,
        onClick: (e) => {
          e.preventDefault();
          const node = document.getElementById(`learn-note-${next.id}`);
          if (node) scrollToEl(node);
        },
      }, [`Next: ${next.title} \u2193`]));
    }
    kids.push(article);
  });
  const mainsSection = buildMainsNotesSection(mainsNotes, 'learn-note-mains');
  if (mainsSection) kids.push(mainsSection);
  kids.push(notesFooter(sub, route));

  const reading = el('div', { class: 'reading' }, kids);
  if (toc.length <= 1) return reading;
  const side = el('nav', { class: 'toc learn-toc', ariaLabel: 'On this page' }, [
    el('span', { class: 'toc-eyebrow', text: 'On this page' }),
    tocLinks(toc),
  ]);
  return el('div', { class: 'learn-notes-layout' }, [reading, side]);
}

/** The Notes "Next up" footer (spec §3.5 row 1). @internal */
function notesFooter(sub: SubtopicView, route: LearnRoute): HTMLElement {
  const studied = topicStudy(sub.meta.id).status === 'studied';
  const q = sub.mcqs.length;
  if (q > 0) {
    const next = studied ? nextStep(sub.meta.id) : null;
    return nextUpFooter({
      eyebrow: 'Finished reading?',
      primary: { label: `Practice ${q} question${q === 1 ? '' : 's'}`, onClick: () => goTab(sub, 'practice', route) },
      secondary: next
        ? [{ label: next.label, onClick: next.go }]
        : [{ label: 'Mark studied & skip practice', ariaLabel: `Mark ${sub.meta.name} studied and skip practice`, onClick: () => markAndNext(sub) }],
    });
  }
  const next = nextStep(sub.meta.id);
  return nextUpFooter({
    eyebrow: 'Finished reading?',
    primary: studied
      ? { label: next.label, onClick: next.go }
      : { label: 'Mark studied & go to next topic', onClick: () => markAndNext(sub) },
  });
}

/** The paused-drill key of a topic's practice run. */
export function learnDrillKey(subtopicId: string): string {
  return `learn:${subtopicId}`;
}

/** Resumability settings of a topic's practice run. @internal */
function practiceSession(sub: SubtopicView, route: LearnRoute): QuizSessionOpts {
  const key = learnDrillKey(sub.meta.id);
  return {
    key,
    label: `${sub.meta.name} \u00b7 Practice`,
    route: withResume(learnPath(sub.meta.id, 'practice', { from: route.from }), key),
    backPath: originTarget(route.from, sub).path,
  };
}

/**
 * Run the topic's practice: a FRESH run (any paused one is dropped), or RESUME
 * the paused run (its saved questions — when the topic's questions changed it
 * is discarded with a toast and a fresh run starts). @internal
 */
function beginPractice(sub: SubtopicView, root: HTMLElement, route: LearnRoute, mode: 'fresh' | 'resume'): void {
  const fresh = buildSession({ subtopicId: sub.meta.id, order: 'ladder' }).items;
  const session = practiceSession(sub, route);
  let items = fresh;
  if (mode === 'fresh') clearDrillSession(session.key);
  else items = resumeItems(session.key, fresh.map((i) => i.id)) ?? fresh;
  mountQuiz(root, items, (score, wrongItems) => {
    resultsCache.set(sub.meta.id, { score, wrongIds: wrongItems.map((w) => w.id) });
    pushUrl(learnPath(sub.meta.id, 'practice', { from: route.from, results: true }));
    setDocumentTitle(`${sub.meta.name} \u2014 Practice complete`, 'Topics');
    const back = originTarget(route.from, sub);
    drawResults(root, sub, { ...route, results: true, tab: 'practice' }, back, () => navigate(back.path), score, wrongItems.map((w) => w.id));
    if (!navigator.userAgent.includes('jsdom')) window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    root.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, { allowEndSession: true, session });
}

/** Practice tab: start (or resume) a topic practice session, or sit a timed mock on it. @internal */
function practicePanel(sub: SubtopicView, root: HTMLElement, route: LearnRoute): HTMLElement {
  if (sub.mcqs.length === 0) return emptyPanel('drill', 'No questions yet', 'Practice questions for this topic are coming soon.');
  const n = sub.mcqs.length;
  const paused = pausedDrill(learnDrillKey(sub.meta.id));
  const actions: Child[] = paused
    ? [
        button({ label: resumeText(paused), variant: 'primary', iconName: 'arrow-right', onClick: () => beginPractice(sub, root, route, 'resume') }),
        button({ label: 'Start again', variant: 'secondary', ariaLabel: `Start ${sub.meta.name} practice again from question 1`, onClick: () => beginPractice(sub, root, route, 'fresh') }),
      ]
    : [button({ label: 'Start practice', variant: 'primary', iconName: 'arrow-right', onClick: () => beginPractice(sub, root, route, 'fresh') })];
  const start = el('div', { class: 'learn-start card', attrs: paused ? { 'data-state': 'paused' } : {} }, [
    el('span', { class: 'empty-icon' }, [icon('drill', 26)]),
    el('h2', { text: `${n} question${n === 1 ? '' : 's'} on ${sub.meta.name}` }),
    el('p', { class: 'section-lead', text: paused ? 'You paused this practice \u2014 pick up where you left off, or start again from question 1.' : 'Quick practice \u2014 untimed, instant feedback, stop anytime.' }),
    el('div', { class: 'hero-actions learn-start-actions' }, actions),
  ]);
  const mockRow = el('div', { class: 'learn-mock-cta' }, [
    el('p', { class: 'section-lead' }, [icon('timer', 15), el('span', { text: 'Prefer exam conditions? A timed mock on this topic \u2014 negative marking, no feedback until you submit.' })]),
    button({
      label: 'Timed mock on this topic',
      variant: 'secondary',
      iconName: 'timer',
      onClick: () => openMock({ scopeKind: 'subtopic', subtopicId: sub.meta.id }),
    }),
  ]);
  return el('div', { class: 'learn-drill' }, [start, mockRow, studyMarkBar(sub)]);
}

/** The practice results page (its own URL) with the Next-up footer. @internal */
function drawResults(
  root: HTMLElement,
  sub: SubtopicView,
  route: LearnRoute,
  back: { label: string; path: string },
  goBack: () => void,
  score: SessionScore,
  wrongIds: readonly string[],
): void {
  const line = score.total === 0 ? 'No questions answered' : `${score.correct}/${score.total} correct`;
  const studied = topicStudy(sub.meta.id).status === 'studied';
  const next = nextStep(sub.meta.id);
  const secondary = [
    wrongIds.length > 0
      ? {
          label: `Review ${wrongIds.length} mistake${wrongIds.length === 1 ? '' : 's'}`,
          onClick: () => openScopedReview(wrongIds, `${sub.meta.name} \u2014 mistakes`, 'The questions you got wrong in this practice session.'),
        }
      : null,
    { label: 'Back to notes', onClick: () => goTab(sub, 'notes', route) },
  ].filter((x): x is { label: string; onClick: () => void } => x !== null);
  const footer = nextUpFooter({
    // N12: the score is stated ONCE (in the card); the footer is just next-up.
    eyebrow: studied ? 'Studied \u2713 \u2014 next up' : 'Next up',
    primary: studied
      ? { label: next.label, onClick: next.go }
      : { label: 'Mark studied & go to next topic', ariaLabel: `Mark ${sub.meta.name} studied and go to the next topic`, onClick: () => markAndNext(sub) },
    secondary,
  });
  mount(
    root,
    el('div', { class: 'learn results' }, [
      buildHeader(sub, route, back, goBack),
      card({ title: 'Practice complete' }, [el('p', { class: 'section-lead', text: `${sub.meta.name} \u2014 ${line}.` })]),
      footer,
    ]),
  );
}

/** Mains tab: questions with optional model answers + key points. @internal */
function mainsPanel(sub: SubtopicView): HTMLElement {
  if (sub.mains.length === 0) return emptyPanel('notebook', 'No Mains questions yet', 'Descriptive practice for this subtopic will appear here.');
  const cta = el('div', { class: 'learn-mock-cta' }, [
    el('p', { class: 'section-lead' }, [icon('notes', 15), el('span', { text: 'Learn how to WRITE these answers \u2014 frameworks, an annotated model, a practice pad and a self-eval rubric.' })]),
    button({ label: 'Practice mains', variant: 'secondary', iconName: 'arrow-right', onClick: () => openMains(sub.meta.id) }),
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
    kids.push(button({ label: 'Write this answer', variant: 'ghost', iconName: 'arrow-right', onClick: () => openMainsQuestion(m.id) }));
    return el('article', { class: 'mains-item card' }, kids);
  });
  return el('div', { class: 'reading' }, [cta, ...articles]);
}

/** A friendly per-panel empty state. @internal */
function emptyPanel(iconName: Parameters<typeof icon>[0], heading: string, body: string): HTMLElement {
  return el('div', { class: 'empty-state' }, [
    el('span', { class: 'empty-icon' }, [icon(iconName, 26)]),
    el('h2', { text: heading }),
    el('p', { text: body }),
  ]);
}

/**
 * The "Mark as studied" bar on the Practice tab. Toggles "Mark as studied" ↔
 * "Mark as not studied"; answering {@link AUTO_STUDIED_ANSWERS} practice
 * questions marks it studied automatically. Re-renders in place. Once studied
 * it offers the next step from today's plan. Exported for tests.
 */
export function studyMarkBar(sub: SubtopicView): HTMLElement {
  const info = topicStudy(sub.meta.id);
  const studied = info.status === 'studied';
  const auto = Math.min(AUTO_STUDIED_ANSWERS, info.bankSize);
  const lead = studied
    ? `Studied \u2713 \u2014 ${sub.meta.name} counts as covered in your plan.`
    : info.bankSize > 0
      ? info.answered >= auto
        ? `Done with ${sub.meta.name}? It counts as studied automatically at ${AUTO_STUDIED_MIN_ACCURACY}% accuracy (you're at ${formatAccuracy(info.accuracy)}) \u2014 or mark it studied yourself.`
        : `Done with ${sub.meta.name}? Mark it studied (or answer ${auto} practice questions with ${AUTO_STUDIED_MIN_ACCURACY}%+ accuracy \u2014 ${info.answered}/${auto} so far).`
      : `Done with ${sub.meta.name}? Mark it studied so your plan counts it.`;
  // D12: a hand-marked topic with low accuracy gets a gentle nudge (never a block).
  const note = studied ? lowAccuracyNote(info) : null;
  const next = studied ? nextStep(sub.meta.id) : null;
  const bar: HTMLElement = el('div', { class: studied ? 'learn-study-mark is-studied' : 'learn-study-mark', attrs: { 'data-study-status': info.status, role: 'group', 'aria-label': 'Study status' } }, [
    el('p', { class: 'section-lead' }, [icon(studied ? 'check' : 'target', 15), el('span', { text: lead })]),
    note ? el('p', { class: 'section-lead learn-study-note', attrs: { role: 'note' }, text: note }) : null,
    el('div', { class: 'learn-study-actions' }, [
      button({
        label: studied ? 'Mark as not studied' : 'Mark as studied',
        variant: studied ? 'ghost' : 'primary',
        iconName: studied ? undefined : 'check',
        ariaLabel: `${studied ? 'Mark as not studied' : 'Mark as studied'}: ${sub.meta.name}`,
        onClick: () => {
          markTopicStudied(sub.meta.id, !studied);
          const status = topicStudy(sub.meta.id).status;
          for (const c of document.querySelectorAll('.learn-study-chip')) c.replaceWith(studyChip(status));
          const fresh = studyMarkBar(sub);
          bar.replaceWith(fresh);
          fresh.querySelector<HTMLButtonElement>('button')?.focus();
        },
      }),
      next ? button({ label: next.label, variant: 'secondary', iconName: 'arrow-right', onClick: next.go }) : null,
    ]),
  ]);
  return bar;
}

/** The header's small study-status chip. @internal */
function studyChip(status: ReturnType<typeof topicStudy>['status']): HTMLElement {
  const c = studyStatusChip(status);
  c.classList.add('learn-study-chip');
  return c;
}
