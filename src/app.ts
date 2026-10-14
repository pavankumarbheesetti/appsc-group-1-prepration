/**
 * App composition root — builds the persistent "focus workspace" shell and
 * wires the routed views into it (NAV spec §3).
 *
 * Destinations: SIX primary (Today · Plan — Study: Topics · Practice · Revise ·
 * Progress) plus a "Tracks" group (Mains · Languages) and a Settings gear. The
 * shell is a LEFT SIDEBAR on desktop (≥1200px), an icon RAIL at 600–1199px,
 * and a BOTTOM TAB BAR of five (Today · Topics · Practice · Revise · More) on
 * mobile, whose More sheet lists ONLY what is not already a tab. One
 * route-change hook keeps the active highlight, `aria-current`, the top-bar
 * title and `document.title` in sync; the router handles scroll + focus.
 *
 * Theme and text size live in Settings › Appearance, plus ONE top-bar `Aa`
 * popover. A "Skip to content" link is the first focusable element.
 */
import { getBanks, getSyllabus } from './content/loader';
import { navigate, registerRedirect, registerRoute, setDocumentTitle, start } from './router/router';
import { loadState, updateState } from './state/store';
import type { AppState } from './state/store';
import { el } from './views/dom';
import { icon, type IconName } from './views/components/icon';
import { PATHS, registerTopbar } from './views/shell';
import * as today from './views/today';
import * as planner from './views/planner';
import * as startGuide from './views/start';
import * as drill from './views/drill';
import * as mock from './views/mock';
import * as notebook from './views/notebook';
import * as syllabus from './views/syllabus';
import * as notes from './views/notes';
import * as revise from './views/revise';
import * as learn from './views/learn';
import * as mains from './views/mains';
import * as progress from './views/progress';
import * as telugu from './views/telugu';
import * as english from './views/english';
import * as settings from './views/settings';
import * as formulaSheet from './views/formula-sheet';
import { openSearch } from './views/search';
import { openDialog, type DialogController } from './views/dialog';

/**
 * Build the "Loaded N banks across M subjects; syllabus: … verified=…" summary.
 * Retained (kept unit-testable independently of the DOM).
 */
export function contentSummary(): string {
  const banks = getBanks();
  const subjects = new Set(banks.map((b) => b.bank.subjectCode));
  const { meta } = getSyllabus();
  return `Loaded ${banks.length} banks across ${subjects.size} subjects; syllabus: ${meta.notificationNo} verified=${meta.verified}`;
}

/** Font-scale bounds and step for the A-/A+ controls. */
const FONT_MIN = 0.8;
const FONT_MAX = 1.6;
const FONT_STEP = 0.1;

/** Apply persisted theme + font scale to the document root. */
export function applySettings(state: AppState): void {
  const doc = document.documentElement;
  doc.dataset.theme = state.settings.theme;
  doc.style.setProperty('--font-scale', String(state.settings.fontScale));
}

/** A navigation destination: label, hash path, icon, and the paths it owns. */
interface NavItem {
  label: string;
  path: string;
  iconName: IconName;
  /** Path prefixes (beyond `path`) that keep this item highlighted. */
  owns?: readonly string[];
}

/** A group of nav items; an empty eyebrow renders no label. */
interface NavSection {
  eyebrow: string;
  items: NavItem[];
}

const TODAY: NavItem = { label: 'Today', path: PATHS.today, iconName: 'dashboard', owns: ['/today', '/start'] };
const PLAN: NavItem = { label: 'Plan', path: PATHS.plan, iconName: 'calendar' };
const TOPICS: NavItem = { label: 'Topics', path: PATHS.topics, iconName: 'syllabus', owns: ['/learn/', '/notes'] };
const PRACTICE: NavItem = { label: 'Practice', path: PATHS.practice, iconName: 'drill', owns: ['/q/'] };
const REVISE: NavItem = { label: 'Revise', path: PATHS.revise, iconName: 'revise', owns: ['/formula-sheet'] };
const PROGRESS: NavItem = { label: 'Progress', path: PATHS.progress, iconName: 'notebook' };
const MAINS: NavItem = { label: 'Mains', path: PATHS.mains, iconName: 'notes' };
const LANGUAGES: NavItem = { label: 'Languages', path: PATHS.languages, iconName: 'globe', owns: ['/telugu', '/english'] };

/**
 * The single source of nav truth: (no eyebrow) Today · Plan — Study: Topics ·
 * Practice · Revise · Progress — Tracks: Mains · Languages. Settings is the
 * footer gear.
 */
export const NAV_SECTIONS: ReadonlyArray<NavSection> = [
  { eyebrow: '', items: [TODAY, PLAN] },
  { eyebrow: 'Study', items: [TOPICS, PRACTICE, REVISE, PROGRESS] },
  { eyebrow: 'Tracks', items: [MAINS, LANGUAGES] },
];

/** The utility/settings destination — a bottom "gear" item, outside the groups. */
const SETTINGS_ITEM: NavItem = { label: 'Settings', path: PATHS.settings, iconName: 'gear' };

/** Every nav destination flattened (groups + settings), for active lookup. */
const ALL_ITEMS: ReadonlyArray<NavItem> = [...NAV_SECTIONS.flatMap((s) => s.items), SETTINGS_ITEM];

/** The four destinations with their own MOBILE tab (the fifth tab is More). */
export const MOBILE_TABS: ReadonlyArray<NavItem> = [TODAY, TOPICS, PRACTICE, REVISE];

/** The More sheet: everything NOT already a tab. */
export const MORE_ITEMS: ReadonlyArray<NavItem> = [PLAN, PROGRESS, MAINS, LANGUAGES, SETTINGS_ITEM];

/** The nav item that owns `path` (e.g. `/learn/x/notes` → Topics). */
export function navItemFor(path: string): NavItem | undefined {
  const p = path.split('?')[0] ?? path;
  // Longest matching prefix wins so `/practice/mock` stays under Practice.
  let best: NavItem | undefined;
  let bestLen = -1;
  for (const item of ALL_ITEMS) {
    const prefixes = [item.path, ...(item.owns ?? [])];
    for (const pre of prefixes) {
      const hit = pre === '/' ? p === '/' : p === pre || p.startsWith(pre.endsWith('/') ? pre : `${pre}/`);
      if (hit && pre.length > bestLen) {
        best = item;
        bestLen = pre.length;
      }
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Shell state — references updated on every route change.                     */
/* -------------------------------------------------------------------------- */

/** Every rendered nav link with the item it points at. */
const navLinks: Array<{ item: NavItem; node: HTMLElement }> = [];
/** The mobile "More" tab button (highlighted when a non-tab route is active). */
let moreTabBtn: HTMLElement | null = null;
/** The mobile "More" drawer element (toggled open/closed). */
let moreDrawer: HTMLElement | null = null;
/** The active "More" sheet dialog controller (focus-trap + ESC + return-focus). */
let moreDialog: DialogController | null = null;
/** The top-bar title slot (an h1, or a div when the view owns the h1). */
let titleEl: HTMLElement | null = null;
/** The top-bar mobile back link. */
let backEl: HTMLButtonElement | null = null;
/** The `Aa` display popover + its trigger. */
let aaBtn: HTMLButtonElement | null = null;
let aaPop: HTMLElement | null = null;

/** Whether the global listeners (⌘K, outside-click) have been attached. */
let globalsBound = false;

/** Set/remove `aria-current="page"` on a nav node. @internal */
function toggleCurrent(node: HTMLElement, active: boolean): void {
  if (active) node.setAttribute('aria-current', 'page');
  else node.removeAttribute('aria-current');
}

/** Highlight the nav item owning `path` on every surface. @internal */
function setActive(path: string): void {
  const owner = navItemFor(path);
  for (const { item, node } of navLinks) toggleCurrent(node, item === owner);
  if (moreTabBtn) toggleCurrent(moreTabBtn, owner !== undefined && !MOBILE_TABS.includes(owner));
  closeMoreDrawer();
  closeAa();
}

/** Replace the top-bar title slot (h1 by default; a div when the view has the h1). @internal */
function setTitle(text: string, opts: { heading?: boolean } = {}): void {
  if (!titleEl) return;
  const tag = opts.heading === false ? 'div' : 'h1';
  if (titleEl.tagName.toLowerCase() !== tag) {
    const next = el(tag, { class: 'topbar-title' });
    titleEl.replaceWith(next);
    titleEl = next;
  }
  titleEl.textContent = text;
  titleEl.setAttribute('title', text);
}

/** Show/hide the mobile `‹ Label` back link. @internal */
function setBack(back: { label: string; onClick: () => void } | null): void {
  if (!backEl) return;
  if (!back) {
    backEl.hidden = true;
    backEl.onclick = null;
    return;
  }
  backEl.hidden = false;
  backEl.replaceChildren(el('span', { class: 'topbar-back-chev', attrs: { 'aria-hidden': 'true' }, text: '\u2039' }), el('span', { text: back.label }));
  backEl.setAttribute('aria-label', `Back to ${back.label}`);
  backEl.onclick = () => back.onClick();
}

/* -------------------------------------------------------------------------- */
/* Controls: search field + the single `Aa` display popover                    */
/* -------------------------------------------------------------------------- */

/** A visible search FIELD (opens the ⌘K overlay). @internal */
function buildSearchField(extraClass = ''): HTMLElement {
  return el('button', {
    class: `search-field ${extraClass}`.trim(),
    type: 'button',
    ariaLabel: 'Search topics, notes, questions (Cmd/Ctrl-K)',
    onClick: () => {
      closeMoreDrawer();
      openSearch();
    },
  }, [
    icon('search', 18),
    el('span', { class: 'search-field-text', text: 'Search topics, notes, questions\u2026' }),
    el('kbd', { class: 'search-field-kbd', text: '\u2318K' }),
  ]);
}

/** The mobile top-bar search icon. @internal */
function buildSearchButton(): HTMLButtonElement {
  return el('button', {
    class: 'icon-btn topbar-search',
    type: 'button',
    ariaLabel: 'Search (Cmd/Ctrl-K)',
    attrs: { title: 'Search  \u2318K' },
    onClick: () => openSearch(),
  }, [icon('search', 20)]) as HTMLButtonElement;
}

/** Persist a theme and apply it. @internal */
function setTheme(theme: 'light' | 'dark'): void {
  applySettings(updateState((s) => {
    s.settings.theme = theme;
  }));
}

/** Persist a font-scale bump (clamped, rounded) and apply it. @internal */
function bumpFont(delta: number): void {
  applySettings(updateState((s) => {
    const raw = s.settings.fontScale + delta;
    s.settings.fontScale = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(raw * 10) / 10));
  }));
}

/** (Re)build the popover body from the live state. @internal */
function paintAa(): void {
  if (!aaPop) return;
  const { theme, fontScale } = loadState().settings;
  const themeBtn = (t: 'light' | 'dark', label: string, ic: IconName): HTMLElement =>
    el('button', {
      type: 'button',
      class: theme === t ? 'seg-btn is-active' : 'seg-btn',
      ariaLabel: `Use ${t} theme`,
      attrs: { 'aria-pressed': String(theme === t) },
      onClick: () => {
        setTheme(t);
        paintAa();
      },
    }, [icon(ic, 16), el('span', { text: label })]);
  aaPop.replaceChildren(
    el('p', { class: 'aa-pop-title', text: 'Display' }),
    el('div', { class: 'aa-row' }, [
      el('span', { class: 'control-label', text: 'Theme' }),
      el('div', { class: 'seg', attrs: { role: 'group', 'aria-label': 'Theme' } }, [themeBtn('light', 'Light', 'sun'), themeBtn('dark', 'Dark', 'moon')]),
    ]),
    el('div', { class: 'aa-row' }, [
      el('span', { class: 'control-label', text: 'Text size' }),
      el('div', { class: 'seg', attrs: { role: 'group', 'aria-label': 'Text size' } }, [
        el('button', { type: 'button', text: 'A\u2212', ariaLabel: 'Decrease text size', onClick: () => { bumpFont(-FONT_STEP); paintAa(); } }),
        el('span', { class: 'seg-value tnum', text: `${Math.round(fontScale * 100)}%` }),
        el('button', { type: 'button', text: 'A+', ariaLabel: 'Increase text size', onClick: () => { bumpFont(FONT_STEP); paintAa(); } }),
      ]),
    ]),
    el('button', {
      class: 'link-btn aa-more',
      type: 'button',
      text: 'More in Settings',
      onClick: () => {
        closeAa();
        navigate(PATHS.settings);
      },
    }),
  );
}

/** Open the `Aa` popover. @internal */
function openAa(): void {
  if (!aaPop || !aaBtn) return;
  paintAa();
  aaPop.hidden = false;
  aaBtn.setAttribute('aria-expanded', 'true');
  aaPop.querySelector<HTMLElement>('button')?.focus();
}

/** Close the `Aa` popover (returning focus when asked). @internal */
function closeAa(returnFocus = false): void {
  if (!aaPop || !aaBtn || aaPop.hidden) return;
  aaPop.hidden = true;
  aaBtn.setAttribute('aria-expanded', 'false');
  if (returnFocus) aaBtn.focus();
}

/** Build the `Aa` trigger + popover (theme + text size, once). @internal */
function buildAa(): HTMLElement {
  aaBtn = el('button', {
    class: 'icon-btn aa-btn',
    type: 'button',
    ariaLabel: 'Display: theme and text size',
    attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'aa-pop' },
    onClick: () => (aaPop?.hidden ? openAa() : closeAa()),
  }, [el('span', { class: 'aa-glyph', attrs: { 'aria-hidden': 'true' }, text: 'Aa' })]) as HTMLButtonElement;
  aaPop = el('div', { class: 'aa-pop', attrs: { id: 'aa-pop', role: 'dialog', 'aria-label': 'Display settings', hidden: 'true' } });
  aaPop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeAa(true);
    }
  });
  return el('div', { class: 'aa-wrap' }, [aaBtn, aaPop]);
}

/* -------------------------------------------------------------------------- */
/* Shell construction                                                          */
/* -------------------------------------------------------------------------- */

/** Build one nav link (`variant` picks the sidebar/tab/sheet styling). @internal */
function buildLink(item: NavItem, variant: 'side' | 'tab' | 'more'): HTMLElement {
  const node = el('a', {
    class: variant === 'tab' ? 'tab-item' : 'nav-item',
    href: `#${item.path}`,
    onClick: (e) => {
      e.preventDefault();
      navigate(item.path);
    },
  }, [icon(item.iconName, variant === 'tab' ? 22 : 20), el('span', { class: 'nav-label', text: item.label })]);
  navLinks.push({ item, node });
  return node;
}

/** Grouped nav sections (eyebrow + items). @internal */
function buildNavGroups(): HTMLElement[] {
  return NAV_SECTIONS.map((section) =>
    el('div', { class: 'nav-group' }, [
      section.eyebrow ? el('span', { class: 'nav-eyebrow', text: section.eyebrow }) : null,
      ...section.items.map((i) => buildLink(i, 'side')),
    ]),
  );
}

/** Build the persistent left sidebar (desktop / rail). @internal */
function buildSidebar(): HTMLElement {
  const brand = el('a', {
    class: 'sidebar-brand',
    href: '#/',
    ariaLabel: 'APPSC Focus — Today',
    onClick: (e) => {
      e.preventDefault();
      navigate('/');
    },
  }, [
    el('span', { class: 'brand-mark' }, [icon('sparkles', 22)]),
    el('div', { class: 'brand-text' }, [
      el('span', { class: 'brand-name', text: 'APPSC Focus' }),
      el('span', { class: 'brand-sub', text: 'Group-1 workspace' }),
    ]),
  ]);
  const nav = el('nav', { class: 'nav', ariaLabel: 'Primary' }, buildNavGroups());
  const footer = el('div', { class: 'sidebar-footer' }, [buildLink(SETTINGS_ITEM, 'side')]);
  return el('aside', { class: 'sidebar' }, [brand, buildSearchField('sidebar-search'), nav, footer]);
}

/** Build the slim top bar: back (mobile, Learn) + title + search icon + `Aa`. @internal */
function buildTopbar(): HTMLElement {
  titleEl = el('h1', { class: 'topbar-title', text: 'Today' });
  backEl = el('button', { class: 'topbar-back', type: 'button', attrs: { hidden: 'true' } }) as HTMLButtonElement;
  return el('header', { class: 'topbar' }, [
    el('span', { class: 'topbar-mark', attrs: { 'aria-hidden': 'true' } }, [icon('sparkles', 18)]),
    backEl,
    titleEl,
    el('div', { class: 'topbar-actions' }, [buildSearchButton(), buildAa()]),
  ]);
}

/** Build the fixed bottom tab bar (mobile): 4 tabs + More. @internal */
function buildTabbar(): HTMLElement {
  moreTabBtn = el('button', {
    class: 'tab-item',
    type: 'button',
    ariaLabel: 'More',
    attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
    onClick: () => toggleMoreDrawer(),
  }, [icon('menu', 22), el('span', { class: 'nav-label', text: 'More' })]);
  return el('nav', { class: 'tabbar', ariaLabel: 'Tabs' }, [...MOBILE_TABS.map((i) => buildLink(i, 'tab')), moreTabBtn]);
}

/** Build the mobile More sheet: search field + the non-tab destinations. @internal */
function buildMoreDrawer(): HTMLElement {
  const panel = el('div', { class: 'more-panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'More' } }, [
    el('div', { class: 'more-panel-head' }, [
      el('span', { class: 'more-panel-title', text: 'More' }),
      el('button', { class: 'icon-btn', type: 'button', ariaLabel: 'Close menu', onClick: () => closeMoreDrawer() }, [icon('x', 20)]),
    ]),
    buildSearchField('more-search'),
    el('nav', { class: 'nav more-nav', ariaLabel: 'More destinations' }, MORE_ITEMS.map((i) => buildLink(i, 'more'))),
  ]);
  const scrim = el('div', { class: 'more-scrim' });
  moreDrawer = el('div', { class: 'more-drawer', attrs: { hidden: 'true' } }, [scrim, panel]);
  return moreDrawer;
}

/** Open/close the mobile "More" drawer. @internal */
function toggleMoreDrawer(): void {
  if (!moreDrawer) return;
  if (moreDrawer.hasAttribute('hidden')) openMoreDrawer();
  else closeMoreDrawer();
}

/** Open the mobile "More" drawer as a modal SHEET: focus-trap + ESC + return-focus. @internal */
function openMoreDrawer(): void {
  if (!moreDrawer || moreDialog) return;
  moreDrawer.removeAttribute('hidden');
  moreDrawer.classList.add('is-open');
  moreTabBtn?.setAttribute('aria-expanded', 'true');
  const panel = moreDrawer.querySelector<HTMLElement>('.more-panel');
  const scrim = moreDrawer.querySelector<HTMLElement>('.more-scrim');
  if (!panel) return;
  moreDialog = openDialog({
    panel,
    scrim,
    returnFocus: moreTabBtn,
    onClose: () => {
      moreDrawer?.setAttribute('hidden', 'true');
      moreDrawer?.classList.remove('is-open');
      moreTabBtn?.setAttribute('aria-expanded', 'false');
      moreDialog = null;
    },
  });
}

/** Close the mobile "More" drawer (safe to call when already closed). @internal */
function closeMoreDrawer(): void {
  if (moreDialog) {
    moreDialog.close();
    return;
  }
  if (!moreDrawer) return;
  moreDrawer.setAttribute('hidden', 'true');
  moreDrawer.classList.remove('is-open');
  moreTabBtn?.setAttribute('aria-expanded', 'false');
}

/**
 * Render the full app into `root`: the persistent shell + routed view mount.
 */
export function renderApp(root: HTMLElement): void {
  const state = loadState();
  applySettings(state);

  // Reset shell references (renderApp may run more than once in tests).
  navLinks.length = 0;
  moreTabBtn = null;
  moreDrawer = null;
  moreDialog = null;

  const view = el('main', { class: 'app-main', attrs: { id: 'view', tabindex: '-1' } });
  const skip = el('a', {
    class: 'skip-link',
    href: '#view',
    text: 'Skip to content',
    onClick: (e) => {
      e.preventDefault();
      (view.querySelector<HTMLElement>('h1') ?? view).focus();
    },
  });
  const sidebar = buildSidebar();
  const topbar = buildTopbar();
  const tabbar = buildTabbar();
  const drawer = buildMoreDrawer();

  const content = el('div', { class: 'app-content' }, [topbar, view]);
  const shell = el('div', { class: 'app-shell' }, [skip, sidebar, content, tabbar, drawer]);
  root.replaceChildren(shell);
  registerTopbar({ setTitle, setBack });

  /**
   * Register a page: highlight its nav owner, title the top bar + document,
   * clear any Learn back link, then render. `docTitle` defaults to `title`.
   */
  const page = (path: string, title: string, render: (r: HTMLElement) => void, docTitle: string[] = [title]): void => {
    registerRoute(path, (r) => {
      setActive(path);
      setBack(null);
      setTitle(title);
      setDocumentTitle(...docTitle);
      render(r);
    });
  };

  page(PATHS.today, 'Today', today.render);
  page(PATHS.plan, 'Plan', planner.render);
  page('/start', 'How this app works', startGuide.render);
  page(PATHS.topics, 'Topics', syllabus.render);
  page('/notes', 'All notes', notes.render, ['All notes', 'Topics']);
  page(PATHS.practice, 'Practice', drill.render, ['Quick practice', 'Practice']);
  page(PATHS.mock, 'Practice', mock.render, ['Timed mock', 'Practice']);
  page('/practice/mock/results/:attemptId', 'Mock results', mock.renderResultsRoute, ['Mock results', 'Practice']);
  page('/q/:id', 'Question', drill.renderSingleQuestion, ['Question', 'Practice']);
  page(PATHS.revise, 'Revise', revise.render);
  page(PATHS.flashcards, 'Flashcards', revise.renderFlashcards, ['Flashcards', 'Revise']);
  page(PATHS.mistakes, 'My mistakes', notebook.render, ['My mistakes', 'Revise']);
  page('/formula-sheet', 'Formula sheet', formulaSheet.render, ['Formula sheet', 'Revise']);
  page(PATHS.progress, 'Progress', progress.render);
  page(PATHS.mains, 'Mains', mains.render);
  page('/mains/:id', 'Mains', mains.renderWorkspace, ['Answer writing', 'Mains']);
  page(PATHS.languages, 'Languages', telugu.renderLanguagesHub);
  page('/telugu', 'Telugu', telugu.render, ['Telugu', 'Languages']);
  page('/english', 'English', english.render, ['English', 'Languages']);
  page(PATHS.settings, 'Settings', settings.render);
  // Learn: the view owns the h1 (topic name), the breadcrumb and the back link.
  const learnPage = (path: string): void => {
    registerRoute(path, (r) => {
      setActive('/learn/');
      learn.render(r);
    });
  };
  learnPage('/learn/:id/:tab');
  learnPage('/learn/:id/practice/results');

  // Old routes keep working as redirects (the address bar is corrected).
  registerRedirect('/today', PATHS.today);
  registerRedirect('/planner', PATHS.plan);
  registerRedirect('/syllabus', PATHS.topics);
  registerRedirect('/drill', PATHS.practice);
  registerRedirect('/mock', PATHS.mock);
  registerRedirect('/notebook', PATHS.mistakes);
  registerRedirect('/learn/:id', (p) => learn.defaultLearnPath(p.id ?? ''));

  if (!globalsBound) {
    // Global Cmd/Ctrl-K opens the search overlay.
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearch();
      }
    });
    // Clicking outside the `Aa` popover closes it.
    document.addEventListener('click', (e) => {
      const t = e.target as Node | null;
      // A detached target is a control the popover just re-rendered.
      if (!aaPop || aaPop.hidden || !t || !t.isConnected) return;
      if (aaPop.contains(t) || aaBtn?.contains(t)) return;
      closeAa();
    });
    globalsBound = true;
  }

  start(view);
}
